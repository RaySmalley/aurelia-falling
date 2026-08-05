import {
  createPathSearch,
  type IncrementalPathSearch,
  type PathOptions,
  type PathSearchStatus,
} from "./pathfinding";
import { MAP_TERRAIN_REVISION } from "./map";
import type { GridPoint } from "./types";

export const PATH_REQUEST_PRIORITIES = [
  "direct",
  "combat",
  "ai",
  "harvest",
  "background",
] as const;
export const PATH_REQUESTS_PER_PRIORITY_AGING_STEP = 4;
export const PATH_CACHE_CAPACITY = 128;

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
  cacheKey: string | null;
  cachedPath: CachedPath | null;
  cachedExpansionsRemaining: number;
  expansions: number;
  search: IncrementalPathSearch | null;
  started: boolean;
};

type CachedPath = Readonly<{
  path: readonly GridPoint[];
  expansions: number;
}>;

const priorityRank = (priority: PathRequestPriority) =>
  PATH_REQUEST_PRIORITIES.indexOf(priority);
const compareKeys = (left: string, right: string) =>
  left < right ? -1 : left > right ? 1 : 0;
const orderedTileKeys = (tiles: PathOptions["occupied"]) =>
  [...(tiles ?? [])].sort((left, right) => left - right);
const pathCacheKey = (
  start: GridPoint,
  goal: GridPoint,
  options?: PathOptions,
) => {
  if (options?.reserved || (options?.occupied && !options.occupied.revision)) {
    return null;
  }
  const occupancyRevision = options?.occupied?.revision ?? "open";
  return `${MAP_TERRAIN_REVISION}:${occupancyRevision}:${start.x},${start.y}:${goal.x},${goal.y}`;
};

export class DeterministicPathRequestQueue {
  private readonly requests = new Map<string, QueuedRequest>();
  private readonly pathCache = new Map<string, CachedPath>();
  private nextSequence = 0;
  private pathCacheHits = 0;
  private pathCacheMisses = 0;

  get size() {
    return this.requests.size;
  }

  cacheDiagnostics() {
    return Object.freeze({
      capacity: PATH_CACHE_CAPACITY,
      entries: this.pathCache.size,
      hits: this.pathCacheHits,
      misses: this.pathCacheMisses,
    });
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
            request.cachedPath && request.started
              ? {
                  start: request.start,
                  goal: request.goal,
                  occupied: orderedTileKeys(request.options?.occupied),
                  reserved: orderedTileKeys(request.options?.reserved),
                  totalExpansions:
                    request.cachedPath.expansions -
                    request.cachedExpansionsRemaining,
                  status: "planning",
                  path: null,
                  cached: true,
                }
              : request.search?.authoritativeState() ?? {
                  start: request.start,
                  requestedGoal: request.goal,
                  occupied: orderedTileKeys(request.options?.occupied),
                  reserved: orderedTileKeys(request.options?.reserved),
                  status: "queued",
                },
        })),
    };
  }

  enqueue(request: PathRequest) {
    const cacheKey = pathCacheKey(
      request.start,
      request.goal,
      request.options,
    );
    const cachedPath = cacheKey
      ? this.pathCache.get(cacheKey) ?? null
      : null;
    if (cachedPath) this.pathCacheHits += 1;
    else this.pathCacheMisses += 1;
    this.requests.set(request.key, {
      key: request.key,
      priority: request.priority,
      sequence: this.nextSequence,
      start: { ...request.start },
      goal: { ...request.goal },
      options: request.options,
      cacheKey,
      cachedPath,
      cachedExpansionsRemaining: cachedPath?.expansions ?? 0,
      expansions: 0,
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
    this.pathCache.clear();
    this.nextSequence = 0;
    this.pathCacheHits = 0;
    this.pathCacheMisses = 0;
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

      if (request.cachedPath) {
        request.started = true;
        const consumed = Math.min(
          remaining,
          request.cachedExpansionsRemaining,
        );
        request.cachedExpansionsRemaining -= consumed;
        request.expansions += consumed;
        expansions += consumed;
        if (request.cachedExpansionsRemaining > 0) break;

        this.requests.delete(request.key);
        completed.push({
          key: request.key,
          priority: request.priority,
          status: "resolved",
          path: request.cachedPath.path,
        });
        continue;
      }

      request.search ??= createPathSearch(
        request.start,
        request.goal,
        request.options,
      );
      request.started = true;
      const result = request.search.advance(remaining);
      request.expansions += result.expansions;
      expansions += result.expansions;
      if (result.status === "planning") break;

      this.requests.delete(request.key);
      if (result.status === "resolved" && result.path) {
        this.rememberPath(request, result.path);
      }
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

  private rememberPath(
    request: QueuedRequest,
    path: readonly GridPoint[],
  ) {
    if (!request.cacheKey || this.pathCache.has(request.cacheKey)) return;
    if (this.pathCache.size >= PATH_CACHE_CAPACITY) {
      const oldest = this.pathCache.keys().next().value;
      if (oldest !== undefined) this.pathCache.delete(oldest);
    }
    this.pathCache.set(request.cacheKey, {
      path: Object.freeze(
        path.map((point) => Object.freeze({ ...point })),
      ),
      expansions: request.expansions,
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
