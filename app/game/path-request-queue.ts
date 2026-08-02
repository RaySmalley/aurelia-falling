import {
  createPathSearch,
  type IncrementalPathSearch,
  type PathOptions,
  type PathSearchStatus,
} from "./pathfinding";
import type { GridPoint } from "./types";

export const PATH_REQUEST_PRIORITIES = [
  "direct",
  "combat",
  "ai",
  "harvest",
  "background",
] as const;
export const PATH_REQUESTS_PER_PRIORITY_AGING_STEP = 4;

export type PathRequestPriority =
  (typeof PATH_REQUEST_PRIORITIES)[number];

export type PathRequest = Readonly<{
  key: string;
  start: GridPoint;
  goal: GridPoint;
  priority: PathRequestPriority;
  options?: PathOptions;
}>;

export type PathRequestResult = Readonly<{
  key: string;
  priority: PathRequestPriority;
  status: Exclude<PathSearchStatus, "planning">;
  path: readonly GridPoint[];
}>;

export type PathQueueAdvance = Readonly<{
  expansions: number;
  completed: readonly PathRequestResult[];
}>;

type QueuedRequest = {
  key: string;
  priority: PathRequestPriority;
  sequence: number;
  start: GridPoint;
  goal: GridPoint;
  options?: PathOptions;
  search: IncrementalPathSearch | null;
  started: boolean;
};

const priorityRank = (priority: PathRequestPriority) =>
  PATH_REQUEST_PRIORITIES.indexOf(priority);
const compareKeys = (left: string, right: string) =>
  left < right ? -1 : left > right ? 1 : 0;

export class DeterministicPathRequestQueue {
  private readonly requests = new Map<string, QueuedRequest>();
  private nextSequence = 0;

  get size() {
    return this.requests.size;
  }

  authoritativeState() {
    return {
      nextSequence: this.nextSequence,
      requests: [...this.requests.values()]
        .sort(
          (left, right) =>
            left.sequence - right.sequence ||
            compareKeys(left.key, right.key),
        )
        .map((request) => ({
          key: request.key,
          priority: request.priority,
          sequence: request.sequence,
          started: request.started,
          search:
            request.search?.authoritativeState() ?? {
              start: request.start,
              requestedGoal: request.goal,
              occupied: [...(request.options?.occupied ?? [])].sort(
                (left, right) => left - right,
              ),
              reserved: [...(request.options?.reserved ?? [])].sort(
                (left, right) => left - right,
              ),
              status: "queued",
            },
        })),
    };
  }

  enqueue(request: PathRequest) {
    this.requests.set(request.key, {
      key: request.key,
      priority: request.priority,
      sequence: this.nextSequence,
      start: { ...request.start },
      goal: { ...request.goal },
      options: request.options,
      search: null,
      started: false,
    });
    this.nextSequence += 1;
  }

  cancel(key: string) {
    return this.requests.delete(key);
  }

  has(key: string) {
    return this.requests.has(key);
  }

  clear() {
    this.requests.clear();
    this.nextSequence = 0;
  }

  stateOf(key: string): "queued" | "planning" | null {
    const request = this.requests.get(key);
    if (!request) return null;
    return request.started ? "planning" : "queued";
  }

  advance(expansionBudget: number): PathQueueAdvance {
    if (!Number.isSafeInteger(expansionBudget) || expansionBudget < 0) {
      throw new RangeError("expansionBudget must be a non-negative integer");
    }

    let expansions = 0;
    const completed: PathRequestResult[] = [];
    while (this.requests.size > 0) {
      const request = this.nextRequest()!;
      const remaining = expansionBudget - expansions;
      if (remaining === 0) break;

      request.search ??= createPathSearch(
        request.start,
        request.goal,
        request.options,
      );
      request.started = true;
      const result = request.search.advance(remaining);
      expansions += result.expansions;
      if (result.status === "planning") break;

      this.requests.delete(request.key);
      completed.push({
        key: request.key,
        priority: request.priority,
        status: result.status,
        path: result.path ?? [],
      });
    }

    return Object.freeze({
      expansions,
      completed: Object.freeze(completed),
    });
  }

  private nextRequest() {
    let selected: QueuedRequest | undefined;
    for (const request of this.requests.values()) {
      const comparison = selected
        ? this.effectivePriorityRank(request) -
            this.effectivePriorityRank(selected) ||
          request.sequence - selected.sequence ||
          compareKeys(request.key, selected.key)
        : -1;
      if (comparison < 0) {
        selected = request;
      }
    }
    return selected;
  }

  private effectivePriorityRank(request: QueuedRequest) {
    const laterRequestCount =
      this.nextSequence - request.sequence - 1;
    const agingSteps = Math.floor(
      laterRequestCount / PATH_REQUESTS_PER_PRIORITY_AGING_STEP,
    );
    return Math.max(0, priorityRank(request.priority) - agingSteps);
  }
}
