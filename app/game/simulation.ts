import { gameData, type WeaponDefinition } from "./data";
import { MAP_SIZE, TILE_MILLI, tileKeyOf } from "./map";
import {
  findPath,
  nearestWalkable,
  translateSharedPath,
} from "./pathfinding";
import type {
  GridPoint,
  OrderKind,
  PlayerId,
  ProjectileSnapshot,
  SimCommand,
  SimulationSnapshot,
  UnitId,
  UnitKind,
  Vec2,
} from "./types";

export const TICKS_PER_SECOND = 20;
export const SIM_STEP_MS = 1_000 / TICKS_PER_SECOND;
export const DEFAULT_COMBAT_SEED = 0xa11e_1a;

const SEPARATION_MILLI = 420;
const SEPARATION_STEP = 24;
const CHASE_REPATH_TICKS = 8;

type UnitState = {
  id: UnitId;
  callsign: string;
  playerId: PlayerId;
  kind: UnitKind;
  formationId: number;
  position: { x: number; y: number };
  selected: boolean;
  order: OrderKind;
  path: GridPoint[];
  pathIndex: number;
  destination: GridPoint | null;
  attackMoveDestination: GridPoint | null;
  health: number;
  cooldownTicks: number;
  targetId: UnitId | null;
  forcedTarget: boolean;
};

type ProjectileState = {
  id: number;
  playerId: PlayerId;
  weapon: WeaponDefinition;
  position: { x: number; y: number };
  targetId: UnitId;
  willHit: boolean;
};

type StartingUnit = Readonly<{
  id: UnitId;
  callsign: string;
  playerId: PlayerId;
  kind: UnitKind;
  tile: GridPoint;
}>;

const UNIT_KINDS: readonly UnitKind[] = Object.freeze([
  "midasHarvester",
  "argusRifle",
  "cyclopsRocket",
  "hermesScout",
  "atlasTank",
  "gorgonWalker",
]);

const PLAYER_CALLSIGNS = Object.freeze([
  "Midas Gold",
  "Argus Gold",
  "Cyclops Gold",
  "Hermes Gold",
  "Atlas Gold",
  "Gorgon Gold",
]);

const ENEMY_CALLSIGNS = Object.freeze([
  "Midas Cyan",
  "Argus Cyan",
  "Cyclops Cyan",
  "Hermes Cyan",
  "Atlas Cyan",
  "Gorgon Cyan",
]);

const STARTING_UNITS: readonly StartingUnit[] = Object.freeze([
  ...UNIT_KINDS.map((kind, index) =>
    Object.freeze({
      id: index + 1,
      callsign: PLAYER_CALLSIGNS[index],
      playerId: 1 as const,
      kind,
      tile: Object.freeze({
        x: 21 + (index % 2),
        y: 30 + Math.floor(index / 2),
      }),
    }),
  ),
  ...UNIT_KINDS.map((kind, index) =>
    Object.freeze({
      id: index + 7,
      callsign: ENEMY_CALLSIGNS[index],
      playerId: 2 as const,
      kind,
      tile: Object.freeze({
        x: 42 - (index % 2),
        y: 30 + Math.floor(index / 2),
      }),
    }),
  ),
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

const distanceSquared = (left: Vec2, right: Vec2) => {
  const dx = right.x - left.x;
  const dy = right.y - left.y;
  return dx * dx + dy * dy;
};

export class DeterministicRng {
  private state: number;

  constructor(seed: number) {
    this.state = (seed >>> 0) || DEFAULT_COMBAT_SEED;
  }

  nextUint32() {
    let value = this.state;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.state = value >>> 0;
    return this.state;
  }

  nextBasisPoints() {
    return this.nextUint32() % 10_000;
  }
}

export class Simulation {
  private tick = 0;
  private seed: number;
  private rng: DeterministicRng;
  private readonly commands: SimCommand[] = [];
  private units: UnitState[] = [];
  private projectiles: ProjectileState[] = [];
  private nextProjectileId = 1;
  private readonly controlGroups = new Map<number, UnitId[]>();
  private readonly rallies = new Map<number, GridPoint>();
  private kills: Record<PlayerId, number> = { 1: 0, 2: 0 };
  private status: SimulationSnapshot["status"] = "active";
  private winner: PlayerId | null = null;

  constructor(seed = DEFAULT_COMBAT_SEED) {
    this.seed = seed >>> 0;
    this.rng = new DeterministicRng(this.seed);
    this.resetCombat(this.seed);
  }

  enqueue(command: SimCommand) {
    this.commands.push(command);
  }

  step() {
    for (const command of this.commands.splice(0)) {
      this.applyCommand(command);
    }
    if (this.status !== "active") {
      this.tick += 1;
      return;
    }

    for (const unit of this.sortedUnits()) {
      if (unit.cooldownTicks > 0) unit.cooldownTicks -= 1;
      this.updateCombatOrder(unit);
    }
    for (const unit of this.sortedUnits()) this.moveUnit(unit);
    this.applyLocalSeparation();
    this.updateProjectiles();
    this.removeDestroyedUnits();
    this.resolveMatch();
    this.tick += 1;
  }

  snapshot(): SimulationSnapshot {
    const units = this.sortedUnits().map((unit) => {
      const definition = gameData.units[unit.kind];
      return Object.freeze({
        id: unit.id,
        callsign: unit.callsign,
        playerId: unit.playerId,
        kind: unit.kind,
        displayName: definition.displayName,
        armor: definition.armor,
        formationId: unit.formationId,
        position: Object.freeze({ ...unit.position }),
        destination: unit.destination
          ? Object.freeze({ ...unit.destination })
          : null,
        selected: unit.selected,
        order: unit.order,
        path: Object.freeze(
          unit.path
            .slice(unit.pathIndex)
            .map((point) => Object.freeze({ ...point })),
        ),
        health: unit.health,
        maxHealth: definition.maxHealth,
        weaponId: definition.weaponId,
        targetId: unit.targetId,
        cooldownTicks: unit.cooldownTicks,
      });
    });
    const projectiles: readonly ProjectileSnapshot[] = Object.freeze(
      this.projectiles
        .slice()
        .sort((a, b) => a.id - b.id)
        .map((projectile) =>
          Object.freeze({
            id: projectile.id,
            playerId: projectile.playerId,
            weaponId: projectile.weapon.id,
            position: Object.freeze({ ...projectile.position }),
            targetId: projectile.targetId,
          }),
        ),
    );
    return Object.freeze({
      tick: this.tick,
      units: Object.freeze(units),
      projectiles,
      selectedUnitIds: Object.freeze(
        units.filter((unit) => unit.selected).map((unit) => unit.id),
      ),
      rallies: Object.freeze(
        [...this.rallies.entries()]
          .sort(([a], [b]) => a - b)
          .map(([formationId, target]) =>
            Object.freeze({
              formationId,
              target: Object.freeze({ ...target }),
            }),
          ),
      ),
      status: this.status,
      winner: this.winner,
      kills: Object.freeze({ ...this.kills }),
      seed: this.seed,
    });
  }

  private resetCombat(seed: number) {
    this.tick = 0;
    this.seed = seed >>> 0;
    this.rng = new DeterministicRng(this.seed);
    this.units = STARTING_UNITS.map((startingUnit) => {
      const definition = gameData.units[startingUnit.kind];
      return {
        ...startingUnit,
        formationId: startingUnit.playerId,
        position: { ...tileCenter(startingUnit.tile) },
        selected: false,
        order: startingUnit.playerId === 2 ? "attackMove" : "idle",
        path: [],
        pathIndex: 0,
        destination: null,
        attackMoveDestination:
          startingUnit.playerId === 2 ? { x: 21, y: 31 } : null,
        health: definition.maxHealth,
        cooldownTicks: 0,
        targetId: null,
        forcedTarget: false,
      };
    });
    this.projectiles = [];
    this.nextProjectileId = 1;
    this.controlGroups.clear();
    this.rallies.clear();
    this.kills = { 1: 0, 2: 0 };
    this.status = "active";
    this.winner = null;
    this.issueSideMove(2, { x: 21, y: 31 }, "attackMove");
  }

  private applyCommand(command: SimCommand) {
    if (command.kind === "restartCombat") {
      this.resetCombat(command.seed ?? this.seed);
      this.commands.length = 0;
      return;
    }

    if (this.status !== "active") return;

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
        this.clearPath(unit);
        unit.targetId = null;
        unit.forcedTarget = false;
        unit.attackMoveDestination = null;
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

    if (command.kind === "attackUnit") {
      const target = this.unitById(command.targetUnitId);
      if (!target) return;
      for (const unit of this.selectedUnits()) {
        if (unit.playerId === target.playerId) continue;
        unit.targetId = target.id;
        unit.forcedTarget = true;
        unit.attackMoveDestination = null;
        unit.order = "attack";
        this.planChase(unit, target);
      }
      return;
    }

    if (command.kind === "move") {
      this.issueFormationMove(command.target, command.mode);
    }
  }

  private sortedUnits() {
    return this.units.slice().sort((a, b) => a.id - b.id);
  }

  private unitById(id: UnitId) {
    return this.units.find((unit) => unit.id === id);
  }

  private selectedUnits() {
    return this.units
      .filter((unit) => unit.selected)
      .sort((a, b) => a.id - b.id);
  }

  private issueSideMove(
    playerId: PlayerId,
    target: GridPoint,
    mode: "move" | "attackMove",
  ) {
    const selectedIds = new Set(
      this.units
        .filter((unit) => unit.playerId === playerId)
        .map((unit) => unit.id),
    );
    this.issueFormationMoveFor(
      this.units.filter((unit) => selectedIds.has(unit.id)),
      target,
      mode,
    );
  }

  private issueFormationMove(
    target: GridPoint,
    mode: "move" | "attackMove",
  ) {
    this.issueFormationMoveFor(this.selectedUnits(), target, mode);
  }

  private issueFormationMoveFor(
    selectedInput: readonly UnitState[],
    requestedTarget: GridPoint,
    mode: "move" | "attackMove",
  ) {
    const selected = selectedInput.slice().sort((a, b) => a.id - b.id);
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
        path = [...findPath(start, destination, { occupied, reserved })];
      }
      if (path.length === 0) continue;

      unit.path = path.slice(1).map((point) => ({ ...point }));
      unit.pathIndex = 0;
      unit.destination = { ...destination };
      unit.attackMoveDestination =
        mode === "attackMove" ? { ...destination } : null;
      unit.targetId = null;
      unit.forcedTarget = false;
      unit.order = mode;
      reserved.add(tileKeyOf(destination));
    }
  }

  private updateCombatOrder(unit: UnitState) {
    const definition = gameData.units[unit.kind];
    const weapon = gameData.weapons[definition.weaponId];
    let target = unit.targetId === null ? undefined : this.unitById(unit.targetId);

    if (!target || target.playerId === unit.playerId || target.health <= 0) {
      const completedForcedAttack = unit.forcedTarget;
      unit.targetId = null;
      unit.forcedTarget = false;
      target = undefined;
      if (completedForcedAttack && unit.order === "attack") {
        unit.order = "idle";
        this.clearPath(unit);
      } else if (unit.order === "attackMove" && unit.attackMoveDestination) {
        this.planPath(unit, unit.attackMoveDestination);
      }
    }

    if (
      !target &&
      unit.order !== "move" &&
      unit.order !== "hold"
    ) {
      target = this.acquireTarget(unit, definition.visionMilli);
      if (target) unit.targetId = target.id;
    }

    if (!target && unit.playerId === 2 && unit.order === "idle") {
      unit.order = "attackMove";
      unit.attackMoveDestination = { x: 21, y: 31 };
      this.planPath(unit, unit.attackMoveDestination);
      return;
    }
    if (!target) return;

    const rangeSquared = weapon.rangeMilli * weapon.rangeMilli;
    if (distanceSquared(unit.position, target.position) <= rangeSquared) {
      this.clearPath(unit);
      if (unit.cooldownTicks === 0) this.fire(unit, target, weapon);
      return;
    }

    if (unit.order === "hold") {
      unit.targetId = null;
      unit.forcedTarget = false;
      return;
    }
    if (this.tick % CHASE_REPATH_TICKS === unit.id % CHASE_REPATH_TICKS) {
      this.planChase(unit, target);
    }
  }

  private acquireTarget(unit: UnitState, acquisitionRange: number) {
    const rangeSquared = acquisitionRange * acquisitionRange;
    return this.units
      .filter(
        (candidate) =>
          candidate.playerId !== unit.playerId &&
          candidate.health > 0 &&
          distanceSquared(unit.position, candidate.position) <= rangeSquared,
      )
      .map((candidate) => ({
        candidate,
        distance: distanceSquared(unit.position, candidate.position),
      }))
      .sort(
        (left, right) =>
          left.distance - right.distance ||
          left.candidate.id - right.candidate.id,
      )[0]?.candidate;
  }

  private fire(
    unit: UnitState,
    target: UnitState,
    weapon: WeaponDefinition,
  ) {
    unit.cooldownTicks = weapon.cooldownTicks;
    this.projectiles.push({
      id: this.nextProjectileId,
      playerId: unit.playerId,
      weapon,
      position: { ...unit.position },
      targetId: target.id,
      willHit: this.rng.nextBasisPoints() < weapon.accuracyBasisPoints,
    });
    this.nextProjectileId += 1;
  }

  private planChase(unit: UnitState, target: UnitState) {
    this.planPath(unit, toTile(target.position));
  }

  private planPath(unit: UnitState, requestedTarget: GridPoint) {
    const occupied = new Set(
      this.units
        .filter((candidate) => candidate.id !== unit.id)
        .map((candidate) => tileKeyOf(toTile(candidate.position))),
    );
    const destination = nearestWalkable(requestedTarget, { occupied });
    if (!destination) return;
    const path = findPath(toTile(unit.position), destination, { occupied });
    if (path.length === 0) return;
    unit.path = path.slice(1).map((point) => ({ ...point }));
    unit.pathIndex = 0;
    unit.destination = { ...destination };
  }

  private clearPath(unit: UnitState) {
    unit.path = [];
    unit.pathIndex = 0;
    unit.destination = null;
  }

  private moveUnit(unit: UnitState) {
    if (unit.pathIndex >= unit.path.length) return;
    const waypoint = tileCenter(unit.path[unit.pathIndex]);
    const dx = waypoint.x - unit.position.x;
    const dy = waypoint.y - unit.position.y;
    const distance = integerSqrt(dx * dx + dy * dy);
    const stepMilli = gameData.units[unit.kind].speedMilliPerTick;

    if (distance <= stepMilli) {
      unit.position = { ...waypoint };
      unit.pathIndex += 1;
      if (unit.pathIndex >= unit.path.length) {
        this.clearPath(unit);
        if (unit.order === "move") unit.order = "idle";
      }
      return;
    }

    unit.position.x += Math.trunc((dx * stepMilli) / distance);
    unit.position.y += Math.trunc((dy * stepMilli) / distance);
  }

  private updateProjectiles() {
    const remaining: ProjectileState[] = [];
    for (const projectile of this.projectiles
      .slice()
      .sort((a, b) => a.id - b.id)) {
      const target = this.unitById(projectile.targetId);
      if (!target || target.health <= 0) continue;
      const dx = target.position.x - projectile.position.x;
      const dy = target.position.y - projectile.position.y;
      const distance = integerSqrt(dx * dx + dy * dy);
      if (distance <= projectile.weapon.projectileSpeedMilli) {
        if (projectile.willHit) {
          const armor = gameData.units[target.kind].armor;
          const multiplier = projectile.weapon.armorMultipliers[armor];
          const damage = Math.max(
            1,
            Math.trunc((projectile.weapon.damage * multiplier) / 1_000),
          );
          target.health = Math.max(0, target.health - damage);
        }
        continue;
      }
      projectile.position.x += Math.trunc(
        (dx * projectile.weapon.projectileSpeedMilli) / distance,
      );
      projectile.position.y += Math.trunc(
        (dy * projectile.weapon.projectileSpeedMilli) / distance,
      );
      remaining.push(projectile);
    }
    this.projectiles = remaining;
  }

  private removeDestroyedUnits() {
    const destroyed = this.units
      .filter((unit) => unit.health <= 0)
      .sort((a, b) => a.id - b.id);
    for (const unit of destroyed) {
      const killer = unit.playerId === 1 ? 2 : 1;
      this.kills[killer] += 1;
      for (const group of this.controlGroups.values()) {
        const index = group.indexOf(unit.id);
        if (index >= 0) group.splice(index, 1);
      }
    }
    if (destroyed.length > 0) {
      const destroyedIds = new Set(destroyed.map((unit) => unit.id));
      this.units = this.units.filter((unit) => !destroyedIds.has(unit.id));
      this.projectiles = this.projectiles.filter(
        (projectile) => !destroyedIds.has(projectile.targetId),
      );
    }
  }

  private resolveMatch() {
    const playerAlive = this.units.some((unit) => unit.playerId === 1);
    const enemyAlive = this.units.some((unit) => unit.playerId === 2);
    if (playerAlive && enemyAlive) return;
    this.clearAllOrders();
    if (!playerAlive && !enemyAlive) {
      this.status = "draw";
      this.winner = null;
    } else if (playerAlive) {
      this.status = "victory";
      this.winner = 1;
    } else {
      this.status = "defeat";
      this.winner = 2;
    }
  }

  private clearAllOrders() {
    for (const unit of this.units) {
      this.clearPath(unit);
      unit.targetId = null;
      unit.forcedTarget = false;
      unit.order = "idle";
    }
  }

  private applyLocalSeparation() {
    const minimumSquared = SEPARATION_MILLI * SEPARATION_MILLI;
    const units = this.sortedUnits();
    for (let leftIndex = 0; leftIndex < units.length; leftIndex += 1) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < units.length;
        rightIndex += 1
      ) {
        const left = units[leftIndex];
        const right = units[rightIndex];
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
