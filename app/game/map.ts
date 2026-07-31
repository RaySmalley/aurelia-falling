import type { GridPoint } from "./types";

export const MAP_SIZE = 64;
export const TILE_MILLI = 1_000;

const tileKey = (x: number, y: number) => y * MAP_SIZE + x;
const blocked = new Set<number>();

function block(x: number, y: number) {
  if (x >= 0 && y >= 0 && x < MAP_SIZE && y < MAP_SIZE) {
    blocked.add(tileKey(x, y));
  }
}

// The Golden Scar is data-only and deterministic. Gaps in each ridge create
// broad formation lanes plus narrow chokepoints for pathfinding tests.
for (let y = 5; y < 59; y += 1) {
  if ((y < 14 || y > 19) && (y < 31 || y > 36) && (y < 49 || y > 53)) {
    block(30, y);
    block(31, y);
  }
}

for (let x = 8; x < 25; x += 1) {
  if (x < 15 || x > 18) block(x, 25);
}

for (let x = 39; x < 56; x += 1) {
  if (x < 46 || x > 49) block(x, 39);
}

for (const [cx, cy] of [
  [16, 12],
  [47, 16],
  [17, 47],
  [48, 51],
] as const) {
  block(cx, cy);
  block(cx + 1, cy);
  block(cx - 1, cy);
  block(cx, cy + 1);
  block(cx, cy - 1);
  block(cx + 1, cy + 1);
}

export const BLOCKED_TILES: readonly GridPoint[] = Object.freeze(
  [...blocked]
    .sort((a, b) => a - b)
    .map((key) =>
      Object.freeze({ x: key % MAP_SIZE, y: Math.floor(key / MAP_SIZE) }),
    ),
);

export function isInsideMap(point: GridPoint) {
  return (
    point.x >= 0 &&
    point.y >= 0 &&
    point.x < MAP_SIZE &&
    point.y < MAP_SIZE
  );
}

export function isTerrainBlockedAt(x: number, y: number) {
  return (
    x < 0 ||
    y < 0 ||
    x >= MAP_SIZE ||
    y >= MAP_SIZE ||
    blocked.has(tileKey(x, y))
  );
}

export function isTerrainBlocked(point: GridPoint) {
  return isTerrainBlockedAt(point.x, point.y);
}

export function clampToMap(point: GridPoint): GridPoint {
  return {
    x: Math.max(0, Math.min(MAP_SIZE - 1, Math.floor(point.x))),
    y: Math.max(0, Math.min(MAP_SIZE - 1, Math.floor(point.y))),
  };
}

export function tileKeyOf(point: GridPoint) {
  return tileKey(point.x, point.y);
}
