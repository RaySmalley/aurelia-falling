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

export function findPath(
  startInput: GridPoint,
  goalInput: GridPoint,
  options: PathOptions = {},
): readonly GridPoint[] {
  const start = clampToMap(startInput);
  const goal = nearestWalkable(goalInput, options);
  if (!goal) return [];
  if (samePoint(start, goal)) return [start];

  const startKey = tileKeyOf(start);
  const goalKey = tileKeyOf(goal);
  const cameFrom = new Map<number, number>();
  const gScore = new Map<number, number>([[startKey, 0]]);
  const fScore = new Map<number, number>([[startKey, heuristic(start, goal)]]);
  const open = new DeterministicMinHeap<OpenNode>(
    (left, right) => left.score - right.score || left.key - right.key,
  );
  open.push({ key: startKey, score: fScore.get(startKey)! });

  while (open.size > 0) {
    const currentNode = open.pop()!;
    if (fScore.get(currentNode.key) !== currentNode.score) continue;
    const currentKey = currentNode.key;
    if (currentKey === goalKey) {
      const path: GridPoint[] = [];
      let cursor: number | undefined = currentKey;
      while (cursor !== undefined) {
        path.push({
          x: cursor % MAP_SIZE,
          y: Math.floor(cursor / MAP_SIZE),
        });
        cursor = cameFrom.get(cursor);
      }
      return path.reverse();
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
        (neighborKey !== goalKey &&
          (options.occupied?.has(neighborKey) ||
            options.reserved?.has(neighborKey)))
      ) {
        continue;
      }

      const tentative = (gScore.get(currentKey) ?? 0) + 1;
      if (tentative >= (gScore.get(neighborKey) ?? Number.MAX_SAFE_INTEGER)) {
        continue;
      }
      cameFrom.set(neighborKey, currentKey);
      gScore.set(neighborKey, tentative);
      const score = tentative + heuristic(neighbor, goal);
      fScore.set(neighborKey, score);
      open.push({ key: neighborKey, score });
    }
  }

  return [];
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
