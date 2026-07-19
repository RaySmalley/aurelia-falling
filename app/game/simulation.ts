import { MAP_SIZE, TILE_MILLI, tileKeyOf } from "./map";
import {
  findPath,
  nearestWalkable,
  translateSharedPath,
} from "./pathfinding";
import type {
  GridPoint,
  OrderKind,
  SimCommand,
  SimulationSnapshot,
  UnitId,
  Vec2,
} from "./types";

export const TICKS_PER_SECOND = 20;
export const SIM_STEP_MS = 1000 / TICKS_PER_SECOND;

const STEP_MILLI = 120;
const SEPARATION_MILLI = 420;
const SEPARATION_STEP = 24;

type UnitState = {
  id: UnitId;
  callsign: string;
  formationId: number;
  position: { x: number; y: number };
  selected: boolean;
  order: OrderKind;
  path: GridPoint[];
  pathIndex: number;
  destination: GridPoint | null;
};

const STARTING_UNITS: readonly Readonly<{
  id: UnitId;
  callsign: string;
  formationId: number;
  tile: GridPoint;
}>[] = Object.freeze([
  { id: 1, callsign: "Argus 1", formationId: 1, tile: { x: 7, y: 8 } },
  { id: 2, callsign: "Argus 2", formationId: 1, tile: { x: 8, y: 8 } },
  { id: 3, callsign: "Argus 3", formationId: 1, tile: { x: 9, y: 8 } },
  { id: 4, callsign: "Argus 4", formationId: 1, tile: { x: 7, y: 9 } },
  { id: 5, callsign: "Cyclops 1", formationId: 1, tile: { x: 8, y: 9 } },
  { id: 6, callsign: "Cyclops 2", formationId: 1, tile: { x: 9, y: 9 } },
  { id: 7, callsign: "Hermes 1", formationId: 2, tile: { x: 12, y: 15 } },
  { id: 8, callsign: "Hermes 2", formationId: 2, tile: { x: 13, y: 15 } },
  { id: 9, callsign: "Atlas 1", formationId: 2, tile: { x: 14, y: 15 } },
  { id: 10, callsign: "Atlas 2", formationId: 2, tile: { x: 12, y: 16 } },
  { id: 11, callsign: "Gorgon 1", formationId: 2, tile: { x: 13, y: 16 } },
  { id: 12, callsign: "Gorgon 2", formationId: 2, tile: { x: 14, y: 16 } },
]);

const toTile = (position: Vec2): GridPoint => ({
  x: Math.max(
    0,
    Math.min(MAP_SIZE - 1, Math.round(position.x / TILE_MILLI)),
  ),
  y: Math.max(
    0,
    Math.min(MAP_SIZE - 1, Math.round(position.y / TILE_MILLI)),
  ),
});

const tileCenter = (point: GridPoint): Vec2 => ({
  x: point.x * TILE_MILLI,
  y: point.y * TILE_MILLI,
});

function integerSqrt(value: number) {
  if (value <= 0) return 0;
  let x = value;
  let next = Math.floor((x + Math.floor(value / x)) / 2);
  while (next < x) {
    x = next;
    next = Math.floor((x + Math.floor(value / x)) / 2);
  }
  return x;
}

export class Simulation {
  private tick = 0;
  private readonly commands: SimCommand[] = [];
  private readonly units: UnitState[] = STARTING_UNITS.map((definition) => ({
    ...definition,
    position: tileCenter(definition.tile),
    selected: false,
    order: "idle",
    path: [],
    pathIndex: 0,
    destination: null,
  }));
  private readonly controlGroups = new Map<number, UnitId[]>();
  private readonly rallies = new Map<number, GridPoint>();

  enqueue(command: SimCommand) {
    this.commands.push(command);
  }

  step() {
    for (const command of this.commands.splice(0)) {
      this.applyCommand(command);
    }
    for (const unit of this.units) this.moveUnit(unit);
    this.applyLocalSeparation();
    this.tick += 1;
  }

  snapshot(): SimulationSnapshot {
    const units = this.units
      .slice()
      .sort((a, b) => a.id - b.id)
      .map((unit) => ({
        id: unit.id,
        callsign: unit.callsign,
        formationId: unit.formationId,
        position: { ...unit.position },
        destination: unit.destination ? { ...unit.destination } : null,
        selected: unit.selected,
        order: unit.order,
        path: unit.path.slice(unit.pathIndex).map((point) => ({ ...point })),
      }));
    return {
      tick: this.tick,
      units,
      selectedUnitIds: units
        .filter((unit) => unit.selected)
        .map((unit) => unit.id),
      rallies: [...this.rallies.entries()]
        .sort(([a], [b]) => a - b)
        .map(([formationId, target]) => ({
          formationId,
          target: { ...target },
        })),
    };
  }

  private applyCommand(command: SimCommand) {
    if (command.kind === "selectUnits") {
      const requested = new Set(command.unitIds);
      for (const unit of this.units) {
        unit.selected = command.additive
          ? unit.selected || requested.has(unit.id)
          : requested.has(unit.id);
      }
      return;
    }

    if (command.kind === "assignControlGroup") {
      this.controlGroups.set(
        command.group,
        this.selectedUnits().map((unit) => unit.id),
      );
      return;
    }

    if (command.kind === "recallControlGroup") {
      const group = new Set(this.controlGroups.get(command.group) ?? []);
      for (const unit of this.units) unit.selected = group.has(unit.id);
      return;
    }

    if (command.kind === "stop" || command.kind === "hold") {
      for (const unit of this.selectedUnits()) {
        unit.path = [];
        unit.pathIndex = 0;
        unit.destination = null;
        unit.order = command.kind === "hold" ? "hold" : "idle";
      }
      return;
    }

    if (command.kind === "setRally") {
      const target = nearestWalkable(command.target);
      if (!target) return;
      for (const formationId of new Set(
        this.selectedUnits().map((unit) => unit.formationId),
      )) {
        this.rallies.set(formationId, target);
      }
      return;
    }

    if (command.kind === "move") {
      this.issueFormationMove(command.target, command.mode);
    }
  }

  private selectedUnits() {
    return this.units
      .filter((unit) => unit.selected)
      .sort((a, b) => a.id - b.id);
  }

  private issueFormationMove(
    requestedTarget: GridPoint,
    mode: "move" | "attackMove",
  ) {
    const selected = this.selectedUnits();
    if (selected.length === 0) return;

    const selectedIds = new Set(selected.map((unit) => unit.id));
    const occupied = new Set(
      this.units
        .filter((unit) => !selectedIds.has(unit.id))
        .map((unit) => tileKeyOf(toTile(unit.position))),
    );
    const anchorStart = {
      x: Math.floor(
        selected.reduce((total, unit) => total + toTile(unit.position).x, 0) /
          selected.length,
      ),
      y: Math.floor(
        selected.reduce((total, unit) => total + toTile(unit.position).y, 0) /
          selected.length,
      ),
    };
    const anchorTarget = nearestWalkable(requestedTarget, { occupied });
    if (!anchorTarget) return;
    const anchorPath = findPath(anchorStart, anchorTarget, { occupied });
    if (anchorPath.length === 0) return;

    const reserved = new Set<number>();
    for (const unit of selected) {
      const start = toTile(unit.position);
      const offset = {
        x: start.x - anchorStart.x,
        y: start.y - anchorStart.y,
      };
      let path = translateSharedPath(anchorPath, offset, {
        occupied,
        reserved,
      });
      const intendedDestination = {
        x: anchorTarget.x + offset.x,
        y: anchorTarget.y + offset.y,
      };
      const destination = nearestWalkable(intendedDestination, {
        occupied,
        reserved,
      });
      if (!destination) continue;
      if (
        path.length === 0 ||
        path[path.length - 1].x !== destination.x ||
        path[path.length - 1].y !== destination.y
      ) {
        path = findPath(start, destination, { occupied, reserved });
      }
      if (path.length === 0) continue;

      unit.path = path.slice(1).map((point) => ({ ...point }));
      unit.pathIndex = 0;
      unit.destination = { ...destination };
      unit.order = mode;
      reserved.add(tileKeyOf(destination));
    }
  }

  private moveUnit(unit: UnitState) {
    if (unit.pathIndex >= unit.path.length) return;
    const waypoint = tileCenter(unit.path[unit.pathIndex]);
    const dx = waypoint.x - unit.position.x;
    const dy = waypoint.y - unit.position.y;
    const distance = integerSqrt(dx * dx + dy * dy);

    if (distance <= STEP_MILLI) {
      unit.position = { ...waypoint };
      unit.pathIndex += 1;
      if (unit.pathIndex >= unit.path.length) {
        unit.path = [];
        unit.pathIndex = 0;
        unit.destination = null;
        unit.order = "idle";
      }
      return;
    }

    unit.position.x += Math.trunc((dx * STEP_MILLI) / distance);
    unit.position.y += Math.trunc((dy * STEP_MILLI) / distance);
  }

  private applyLocalSeparation() {
    const minimumSquared = SEPARATION_MILLI * SEPARATION_MILLI;
    for (let leftIndex = 0; leftIndex < this.units.length; leftIndex += 1) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < this.units.length;
        rightIndex += 1
      ) {
        const left = this.units[leftIndex];
        const right = this.units[rightIndex];
        const dx = right.position.x - left.position.x;
        const dy = right.position.y - left.position.y;
        if (dx * dx + dy * dy >= minimumSquared) continue;

        const pushX = Math.abs(dx) >= Math.abs(dy) ? SEPARATION_STEP : 0;
        const pushY = pushX === 0 ? SEPARATION_STEP : 0;
        const directionX = dx >= 0 ? 1 : -1;
        const directionY = dy >= 0 ? 1 : -1;
        left.position.x -= pushX * directionX;
        right.position.x += pushX * directionX;
        left.position.y -= pushY * directionY;
        right.position.y += pushY * directionY;
      }
    }
  }
}
