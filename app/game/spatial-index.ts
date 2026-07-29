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
    const key = cellKey(this.coordinateOf(position));
    this.addToCell(key, id);
    this.entityCells.set(id, key);
    this.positions.set(id, { ...position });
  }

  move(id: Id, position: Vec2) {
    const previousKey = this.entityCells.get(id);
    if (previousKey === undefined) {
      throw new Error(`Spatial index does not contain entity ${id}.`);
    }
    const nextKey = cellKey(this.coordinateOf(position));
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
    const origin = this.coordinateOf(position);
    let visited = 0;
    let bestId: Id | undefined;
    let bestDistanceSquared = Number.POSITIVE_INFINITY;

    for (let ring = 0; visited < this.positions.size; ring += 1) {
      const minimumX = origin.x - ring;
      const maximumX = origin.x + ring;
      const minimumY = origin.y - ring;
      const maximumY = origin.y + ring;

      const visitCell = (x: number, y: number) => {
        for (const id of this.cells.get(cellKey({ x, y })) ?? []) {
          visited += 1;
          if (!accept(id)) continue;
          const candidate = this.positions.get(id)!;
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
      };

      if (ring === 0) {
        visitCell(origin.x, origin.y);
      } else {
        for (let x = minimumX; x <= maximumX; x += 1) {
          visitCell(x, minimumY);
          visitCell(x, maximumY);
        }
        for (let y = minimumY + 1; y < maximumY; y += 1) {
          visitCell(minimumX, y);
          visitCell(maximumX, y);
        }
      }

      if (bestId !== undefined) {
        const leftBoundary = minimumX * this.cellSize;
        const rightBoundary = (maximumX + 1) * this.cellSize;
        const topBoundary = minimumY * this.cellSize;
        const bottomBoundary = (maximumY + 1) * this.cellSize;
        const distanceToUnvisitedCells = Math.min(
          position.x - leftBoundary,
          rightBoundary - position.x,
          position.y - topBoundary,
          bottomBoundary - position.y,
        );
        if (
          distanceToUnvisitedCells * distanceToUnvisitedCells >
          bestDistanceSquared
        ) {
          return bestId;
        }
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
