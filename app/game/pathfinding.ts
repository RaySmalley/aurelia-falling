import {
  clampToMap,
  isTerrainBlockedAt,
  MAP_SIZE,
  tileKeyOf,
} from "./map";
import { DeterministicMinHeap } from "./min-heap";
import type { GridPoint } from "./types";

const NEIGHBOR_X = new Int8Array([0, 1, 0, -1]);
const NEIGHBOR_Y = new Int8Array([-1, 0, 1, 0]);

const samePoint = (a: GridPoint, b: GridPoint) =>
  a.x === b.x && a.y === b.y;

const heuristic = (a: GridPoint, b: GridPoint) =>
  Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

export type PathTileSet = Readonly<{
  revision?: string;
  has(value: number): boolean;
  [Symbol.iterator](): Iterator<number>;
}>;

export type PathOptions = Readonly<{
  occupied?: PathTileSet;
  reserved?: PathTileSet;
}>;

type OpenNode = Readonly<{
  key: number;
  score: number;
}>;

export type PathSearchStatus = "planning" | "resolved" | "failed";
export const MAX_PATH_EXPANSIONS = MAP_SIZE * MAP_SIZE * 4;

export type PathSearchAdvance = Readonly<{
  expansions: number;
  status: PathSearchStatus;
  path: readonly GridPoint[] | null;
}>;

const MAP_TILE_COUNT = MAP_SIZE * MAP_SIZE;

export function nearestWalkable(
  requested: GridPoint,
  options: PathOptions = {},
): GridPoint | null {
  const center = clampToMap(requested);
  const unavailable = (x: number, y: number) => {
    if (isTerrainBlockedAt(x, y)) return true;
    const key = y * MAP_SIZE + x;
    return (
      options.occupied?.has(key) ||
      options.reserved?.has(key)
    );
  };

  if (!unavailable(center.x, center.y)) return center;

  for (let radius = 1; radius < MAP_SIZE; radius += 1) {
    for (let y = center.y - radius; y <= center.y + radius; y += 1) {
      for (let x = center.x - radius; x <= center.x + radius; x += 1) {
        if (
          Math.max(Math.abs(x - center.x), Math.abs(y - center.y)) !== radius
        ) {
          continue;
        }
        if (!unavailable(x, y)) return { x, y };
      }
    }
  }

  return null;
}

export class IncrementalPathSearch {
  private readonly start: GridPoint;
  private readonly goal: GridPoint | null;
  private readonly goalKey: number | null;
  private readonly startKey: number;
  private readonly occupied: ReadonlySet<number>;
  private readonly reserved: ReadonlySet<number>;
  private readonly discovered = new Uint8Array(MAP_TILE_COUNT);
  private readonly cameFrom = new Uint16Array(MAP_TILE_COUNT);
  private readonly gScore = new Uint16Array(MAP_TILE_COUNT);
  private readonly fScore = new Uint16Array(MAP_TILE_COUNT);
  private readonly open = new DeterministicMinHeap<OpenNode>(
    (left, right) => left.score - right.score || left.key - right.key,
  );
  private currentStatus: PathSearchStatus;
  private currentPath: readonly GridPoint[] | null = null;
  private totalExpansions = 0;

  constructor(
    startInput: GridPoint,
    goalInput: GridPoint,
    options: PathOptions = {},
  ) {
    this.start = clampToMap(startInput);
    this.startKey = tileKeyOf(this.start);
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

    const score = heuristic(this.start, this.goal);
    this.discovered[this.startKey] = 1;
    this.gScore[this.startKey] = 0;
    this.fScore[this.startKey] = score;
    this.open.push({ key: this.startKey, score });
    this.currentStatus = "planning";
  }

  get status() {
    return this.currentStatus;
  }

  get path() {
    return this.currentPath;
  }

  authoritativeState() {
    const orderedEntries = (
      entries: Uint16Array,
      include: (key: number) => boolean = () => true,
    ) => {
      const result: [number, number][] = [];
      for (let key = 0; key < MAP_TILE_COUNT; key += 1) {
        if (this.discovered[key] === 1 && include(key)) {
          result.push([key, entries[key]]);
        }
      }
      return result;
    };
    return {
      start: this.start,
      goal: this.goal,
      occupied: [...this.occupied].sort((left, right) => left - right),
      reserved: [...this.reserved].sort((left, right) => left - right),
      cameFrom: orderedEntries(
        this.cameFrom,
        (key) => key !== this.startKey,
      ),
      gScore: orderedEntries(this.gScore),
      fScore: orderedEntries(this.fScore),
      open: this.open.authoritativeState(),
      totalExpansions: this.totalExpansions,
      status: this.currentStatus,
      path: this.currentPath,
    };
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

    const allowedExpansions = Math.min(
      expansionBudget,
      MAX_PATH_EXPANSIONS - this.totalExpansions,
    );
    let expansions = 0;
    while (this.open.size > 0 && expansions < allowedExpansions) {
      const currentNode = this.open.pop()!;
      expansions += 1;
      if (this.fScore[currentNode.key] !== currentNode.score) continue;
      const currentKey = currentNode.key;
      if (currentKey === this.goalKey) {
        this.currentPath = Object.freeze(this.reconstructPath(currentKey));
        this.currentStatus = "resolved";
        break;
      }

      const currentX = currentKey % MAP_SIZE;
      const currentY = Math.floor(currentKey / MAP_SIZE);
      for (let index = 0; index < NEIGHBOR_X.length; index += 1) {
        const neighborX = currentX + NEIGHBOR_X[index];
        const neighborY = currentY + NEIGHBOR_Y[index];
        if (isTerrainBlockedAt(neighborX, neighborY)) continue;
        const neighborKey = neighborY * MAP_SIZE + neighborX;
        if (
          neighborKey !== this.goalKey &&
            (this.occupied.has(neighborKey) ||
              this.reserved.has(neighborKey))
        ) {
          continue;
        }

        const tentative = this.gScore[currentKey] + 1;
        if (
          this.discovered[neighborKey] === 1 &&
          tentative >= this.gScore[neighborKey]
        ) {
          continue;
        }
        this.discovered[neighborKey] = 1;
        this.cameFrom[neighborKey] = currentKey;
        this.gScore[neighborKey] = tentative;
        const score =
          tentative +
          Math.abs(neighborX - this.goal!.x) +
          Math.abs(neighborY - this.goal!.y);
        this.fScore[neighborKey] = score;
        this.open.push({ key: neighborKey, score });
      }
    }
    this.totalExpansions += expansions;

    if (
      this.currentStatus === "planning" &&
      (this.open.size === 0 ||
        this.totalExpansions >= MAX_PATH_EXPANSIONS)
    ) {
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
    let cursor = goalKey;
    while (true) {
      path.push({
        x: cursor % MAP_SIZE,
        y: Math.floor(cursor / MAP_SIZE),
      });
      if (cursor === this.startKey) break;
      cursor = this.cameFrom[cursor];
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
  const translated: GridPoint[] = [];
  for (let index = 0; index < anchorPath.length; index += 1) {
    const x = anchorPath[index].x + offset.x;
    const y = anchorPath[index].y + offset.y;
    if (isTerrainBlockedAt(x, y)) return [];
    if (index < anchorPath.length - 1) {
      const key = y * MAP_SIZE + x;
      if (options.occupied?.has(key) || options.reserved?.has(key)) {
        return [];
      }
    }
    translated.push({ x, y });
  }
  return translated;
}
