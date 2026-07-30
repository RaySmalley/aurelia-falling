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
  search: IncrementalPathSearch;
  started: boolean;
};

const priorityRank = (priority: PathRequestPriority) =>
  PATH_REQUEST_PRIORITIES.indexOf(priority);

export class DeterministicPathRequestQueue {
  private readonly requests = new Map<string, QueuedRequest>();
  private nextSequence = 0;

  get size() {
    return this.requests.size;
  }

  enqueue(request: PathRequest) {
    this.requests.set(request.key, {
      key: request.key,
      priority: request.priority,
      sequence: this.nextSequence,
      search: createPathSearch(
        request.start,
        request.goal,
        request.options,
      ),
      started: false,
    });
    this.nextSequence += 1;
  }

  cancel(key: string) {
    return this.requests.delete(key);
  }

  clear() {
    this.requests.clear();
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
      if (remaining === 0 && request.search.status === "planning") break;

      request.started = true;
      const result = request.search.advance(remaining);
      expansions += result.expansions;
      if (result.status === "planning") break;

      this.requests.delete(request.key);
      completed.push({
        key: request.key,
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
    return [...this.requests.values()].sort(
      (left, right) =>
        priorityRank(left.priority) - priorityRank(right.priority) ||
        left.sequence - right.sequence ||
        left.key.localeCompare(right.key),
    )[0];
  }
}
