import type { Vec2 } from "./types";

type CellCoordinate = {
  x: number;
  y: number;
};

const cellKey = ({ x, y }: CellCoordinate) => `${x},${y}`;

export class DeterministicSpatialIndex<Id extends number> {
  private readonly cells = new Map<string, Set<Id>>();
  private readonly entityCells = new Map<Id, string>();
  private readonly positions = new Map<Id, Vec2>();

  constructor(private readonly cellSize: number) {
    if (!Number.isInteger(cellSize) || cellSize <= 0) {
      throw new Error("Spatial index cell size must be a positive integer.");
    }
  }

  clear() {
    this.cells.clear();
    this.entityCells.clear();
    this.positions.clear();
  }

  insert(id: Id, position: Vec2) {
    if (this.entityCells.has(id)) {
      throw new Error(`Spatial index already contains entity ${id}.`);
    }
    const coordinate = this.coordinateOf(position);
    const key = cellKey(coordinate);
    this.addToCell(key, id);
    this.entityCells.set(id, key);
    this.positions.set(id, { ...position });
  }

  move(id: Id, position: Vec2) {
    const previousKey = this.entityCells.get(id);
    if (previousKey === undefined) {
      throw new Error(`Spatial index does not contain entity ${id}.`);
    }
    const nextCoordinate = this.coordinateOf(position);
    const nextKey = cellKey(nextCoordinate);
    if (previousKey !== nextKey) {
      this.removeFromCell(previousKey, id);
      this.addToCell(nextKey, id);
      this.entityCells.set(id, nextKey);
    }
    this.positions.set(id, { ...position });
  }

  remove(id: Id) {
    const key = this.entityCells.get(id);
    if (key === undefined) return false;
    this.removeFromCell(key, id);
    this.entityCells.delete(id);
    this.positions.delete(id);
    return true;
  }

  query(position: Vec2, radius: number) {
    if (!Number.isInteger(radius) || radius < 0) {
      throw new Error("Spatial query radius must be a non-negative integer.");
    }
    const minimum = this.coordinateOf({
      x: position.x - radius,
      y: position.y - radius,
    });
    const maximum = this.coordinateOf({
      x: position.x + radius,
      y: position.y + radius,
    });
    const ids: Id[] = [];
    for (let y = minimum.y; y <= maximum.y; y += 1) {
      for (let x = minimum.x; x <= maximum.x; x += 1) {
        for (const id of this.cells.get(cellKey({ x, y })) ?? []) {
          ids.push(id);
        }
      }
    }
    const radiusSquared = radius * radius;
    return ids
      .filter((id) => {
        const candidate = this.positions.get(id)!;
        const dx = candidate.x - position.x;
        const dy = candidate.y - position.y;
        return dx * dx + dy * dy <= radiusSquared;
      })
      .sort((left, right) => left - right);
  }

  nearest(position: Vec2, accept: (id: Id) => boolean = () => true) {
    if (this.positions.size === 0) return undefined;
    let bestId: Id | undefined;
    let bestDistanceSquared = Number.POSITIVE_INFINITY;

    for (const [id, candidate] of this.positions) {
      if (!accept(id)) continue;
      const dx = candidate.x - position.x;
      const dy = candidate.y - position.y;
      const candidateDistanceSquared = dx * dx + dy * dy;
      if (
        candidateDistanceSquared < bestDistanceSquared ||
        (candidateDistanceSquared === bestDistanceSquared &&
          (bestId === undefined || id < bestId))
      ) {
        bestId = id;
        bestDistanceSquared = candidateDistanceSquared;
      }
    }

    return bestId;
  }

  private coordinateOf(position: Vec2): CellCoordinate {
    return {
      x: Math.floor(position.x / this.cellSize),
      y: Math.floor(position.y / this.cellSize),
    };
  }

  private addToCell(key: string, id: Id) {
    const occupants = this.cells.get(key);
    if (occupants) occupants.add(id);
    else this.cells.set(key, new Set([id]));
  }

  private removeFromCell(key: string, id: Id) {
    const occupants = this.cells.get(key);
    if (!occupants) return;
    occupants.delete(id);
    if (occupants.size === 0) this.cells.delete(key);
  }
}
