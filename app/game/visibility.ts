import { MAP_SIZE, TILE_MILLI, tileKeyOf } from "./map";
import type {
  GridPoint,
  VisibilityLevel,
  VisibilitySnapshot,
} from "./types";

export type VisibilitySource = Readonly<{
  id: number;
  kind: "unit" | "structure";
  tile: GridPoint;
  visionMilli: number;
}>;

export class VisibilityGrid {
  private readonly current = new Uint8Array(MAP_SIZE * MAP_SIZE);
  private readonly explored = new Uint8Array(MAP_SIZE * MAP_SIZE);
  private sourceSignature = "";
  private revision = 0;
  private cachedSnapshot: VisibilitySnapshot;

  constructor(private readonly enabled: boolean) {
    if (!enabled) {
      this.current.fill(1);
      this.explored.fill(1);
    }
    this.cachedSnapshot = this.createSnapshot();
  }

  update(sources: readonly VisibilitySource[], force = false) {
    if (!this.enabled) return false;
    const signature = sources
      .slice()
      .sort(
        (left, right) =>
          left.kind.localeCompare(right.kind) || left.id - right.id,
      )
      .map(
        (source) =>
          `${source.kind}:${source.id}:${source.tile.x}:${source.tile.y}:${source.visionMilli}`,
      )
      .join("|");
    if (!force && signature === this.sourceSignature) return false;

    this.sourceSignature = signature;
    this.current.fill(0);
    for (const source of sources) {
      const radiusTiles = Math.ceil(source.visionMilli / TILE_MILLI);
      for (
        let y = Math.max(0, source.tile.y - radiusTiles);
        y <= Math.min(MAP_SIZE - 1, source.tile.y + radiusTiles);
        y += 1
      ) {
        for (
          let x = Math.max(0, source.tile.x - radiusTiles);
          x <= Math.min(MAP_SIZE - 1, source.tile.x + radiusTiles);
          x += 1
        ) {
          const dxMilli = (x - source.tile.x) * TILE_MILLI;
          const dyMilli = (y - source.tile.y) * TILE_MILLI;
          if (
            dxMilli * dxMilli + dyMilli * dyMilli >
            source.visionMilli * source.visionMilli
          ) {
            continue;
          }
          const key = tileKeyOf({ x, y });
          this.current[key] = 1;
          this.explored[key] = 1;
        }
      }
    }
    this.revision += 1;
    this.cachedSnapshot = this.createSnapshot();
    return true;
  }

  isVisible(tile: GridPoint) {
    return this.current[tileKeyOf(tile)] === 1;
  }

  isExplored(tile: GridPoint) {
    return this.explored[tileKeyOf(tile)] === 1;
  }

  snapshot() {
    return this.cachedSnapshot;
  }

  private createSnapshot(): VisibilitySnapshot {
    const tiles = Array.from(
      { length: MAP_SIZE * MAP_SIZE },
      (_, key): VisibilityLevel =>
        this.current[key] === 1 ? 2 : this.explored[key] === 1 ? 1 : 0,
    );
    return Object.freeze({
      enabled: this.enabled,
      width: MAP_SIZE,
      height: MAP_SIZE,
      revision: this.revision,
      tiles: Object.freeze(tiles),
    });
  }
}
