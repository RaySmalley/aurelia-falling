import { clampToMap, isTerrainBlocked, MAP_SIZE, tileKeyOf } from "./map";
import { DeterministicMinHeap } from "./min-heap";
import type { GridPoint } from "./types";

const NEIGHBORS: readonly GridPoint[] = Object.freeze([
  Object.freeze({ x: 0, y: -1 }),
  Object.freeze({ x: 1, y: 0 }),
  Object.freeze({ x: 0, y: 1 }),
  Object.freeze({ x: -1, y: 0 }),
]);

const samePoint = (a: GridPoint, b: GridPoint) =>
  a.x === b.x && a.y === b.y;

const heuristic = (a: GridPoint, b: GridPoint) =>
  Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

export type PathOptions = Readonly<{
  occupied?: ReadonlySet<number>;
  reserved?: ReadonlySet<number>;
}>;

type OpenNode = Readonly<{
  key: number;
  score: number;
}>;

export type PathSearchStatus = "planning" | "resolved" | "failed";

export type PathSearchAdvance = Readonly<{
  expansions: number;
  status: PathSearchStatus;
  path: readonly GridPoint[] | null;
}>;

export function nearestWalkable(
  requested: GridPoint,
  options: PathOptions = {},
): GridPoint | null {
  const center = clampToMap(requested);
  const unavailable = (point: GridPoint) => {
    const key = tileKeyOf(point);
    return (
      isTerrainBlocked(point) ||
      options.occupied?.has(key) ||
      options.reserved?.has(key)
    );
  };

  if (!unavailable(center)) return center;

  for (let radius = 1; radius < MAP_SIZE; radius += 1) {
    for (let y = center.y - radius; y <= center.y + radius; y += 1) {
      for (let x = center.x - radius; x <= center.x + radius; x += 1) {
        if (
          Math.max(Math.abs(x - center.x), Math.abs(y - center.y)) !== radius
        ) {
          continue;
        }
        const candidate = { x, y };
        if (!unavailable(candidate)) return candidate;
      }
    }
  }

  return null;
}

export class IncrementalPathSearch {
  private readonly start: GridPoint;
  private readonly goal: GridPoint | null;
  private readonly goalKey: number | null;
  private readonly occupied: ReadonlySet<number>;
  private readonly reserved: ReadonlySet<number>;
  private readonly cameFrom = new Map<number, number>();
  private readonly gScore = new Map<number, number>();
  private readonly fScore = new Map<number, number>();
  private readonly open = new DeterministicMinHeap<OpenNode>(
    (left, right) => left.score - right.score || left.key - right.key,
  );
  private currentStatus: PathSearchStatus;
  private currentPath: readonly GridPoint[] | null = null;

  constructor(
    startInput: GridPoint,
    goalInput: GridPoint,
    options: PathOptions = {},
  ) {
    this.start = clampToMap(startInput);
    this.occupied = new Set(options.occupied);
    this.reserved = new Set(options.reserved);
    this.goal = nearestWalkable(goalInput, {
      occupied: this.occupied,
      reserved: this.reserved,
    });
    this.goalKey = this.goal ? tileKeyOf(this.goal) : null;

    if (!this.goal) {
      this.currentStatus = "failed";
      return;
    }
    if (samePoint(this.start, this.goal)) {
      this.currentStatus = "resolved";
      this.currentPath = Object.freeze([{ ...this.start }]);
      return;
    }

    const startKey = tileKeyOf(this.start);
    const score = heuristic(this.start, this.goal);
    this.gScore.set(startKey, 0);
    this.fScore.set(startKey, score);
    this.open.push({ key: startKey, score });
    this.currentStatus = "planning";
  }

  get status() {
    return this.currentStatus;
  }

  get path() {
    return this.currentPath;
  }

  advance(expansionBudget: number): PathSearchAdvance {
    if (!Number.isSafeInteger(expansionBudget) || expansionBudget < 0) {
      throw new RangeError("expansionBudget must be a non-negative integer");
    }
    if (this.currentStatus !== "planning" || expansionBudget === 0) {
      return {
        expansions: 0,
        status: this.currentStatus,
        path: this.currentPath,
      };
    }

    let expansions = 0;
    while (this.open.size > 0 && expansions < expansionBudget) {
      const currentNode = this.open.pop()!;
      expansions += 1;
      if (this.fScore.get(currentNode.key) !== currentNode.score) continue;
      const currentKey = currentNode.key;
      if (currentKey === this.goalKey) {
        this.currentPath = Object.freeze(this.reconstructPath(currentKey));
        this.currentStatus = "resolved";
        break;
      }

      const currentPoint = {
        x: currentKey % MAP_SIZE,
        y: Math.floor(currentKey / MAP_SIZE),
      };
      for (const offset of NEIGHBORS) {
        const neighbor = {
          x: currentPoint.x + offset.x,
          y: currentPoint.y + offset.y,
        };
        const neighborKey = tileKeyOf(neighbor);
        if (
          isTerrainBlocked(neighbor) ||
          (neighborKey !== this.goalKey &&
            (this.occupied.has(neighborKey) ||
              this.reserved.has(neighborKey)))
        ) {
          continue;
        }

        const tentative = (this.gScore.get(currentKey) ?? 0) + 1;
        if (
          tentative >=
          (this.gScore.get(neighborKey) ?? Number.MAX_SAFE_INTEGER)
        ) {
          continue;
        }
        this.cameFrom.set(neighborKey, currentKey);
        this.gScore.set(neighborKey, tentative);
        const score = tentative + heuristic(neighbor, this.goal!);
        this.fScore.set(neighborKey, score);
        this.open.push({ key: neighborKey, score });
      }
    }

    if (this.currentStatus === "planning" && this.open.size === 0) {
      this.currentStatus = "failed";
    }

    return {
      expansions,
      status: this.currentStatus,
      path: this.currentPath,
    };
  }

  private reconstructPath(goalKey: number) {
    const path: GridPoint[] = [];
    let cursor: number | undefined = goalKey;
    while (cursor !== undefined) {
      path.push({
        x: cursor % MAP_SIZE,
        y: Math.floor(cursor / MAP_SIZE),
      });
      cursor = this.cameFrom.get(cursor);
    }
    return path.reverse().map((point) => Object.freeze(point));
  }
}

export function createPathSearch(
  start: GridPoint,
  goal: GridPoint,
  options: PathOptions = {},
) {
  return new IncrementalPathSearch(start, goal, options);
}

export function findPath(
  startInput: GridPoint,
  goalInput: GridPoint,
  options: PathOptions = {},
): readonly GridPoint[] {
  const search = createPathSearch(startInput, goalInput, options);
  while (search.status === "planning") {
    search.advance(MAP_SIZE * MAP_SIZE);
  }
  return search.path ?? [];
}

export function translateSharedPath(
  anchorPath: readonly GridPoint[],
  offset: GridPoint,
  options: PathOptions = {},
): readonly GridPoint[] {
  const translated = anchorPath.map((point) => ({
    x: point.x + offset.x,
    y: point.y + offset.y,
  }));
  const valid = translated.every((point, index) => {
    if (isTerrainBlocked(point)) return false;
    if (index === translated.length - 1) return true;
    const key = tileKeyOf(point);
    return !options.occupied?.has(key) && !options.reserved?.has(key);
  });
  return valid ? translated : [];
}
