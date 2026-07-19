import {
  gameData,
  type WeaponDefinition,
} from "./data";
import {
  isTerrainBlocked,
  MAP_SIZE,
  TILE_MILLI,
  tileKeyOf,
} from "./map";
import {
  findPath,
  nearestWalkable,
  translateSharedPath,
} from "./pathfinding";
import type {
  AureliteFieldSnapshot,
  BuildingKind,
  GridPoint,
  OrderKind,
  PlacementFailure,
  PlayerId,
  PlayerSnapshot,
  ProductionItemSnapshot,
  ProjectileSnapshot,
  SimCommand,
  SimulationScenario,
  SimulationSnapshot,
  StructureId,
  StructureSnapshot,
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
const REGEN_DENOMINATOR = TICKS_PER_SECOND * 60;

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
  targetStructureId: StructureId | null;
  forcedTarget: boolean;
  cargo: number;
  harvestFieldId: number | null;
};

type ProductionItem = {
  unitKind: UnitKind;
  remainingTicks: number;
  totalTicks: number;
};

type StructureState = {
  id: StructureId;
  playerId: PlayerId;
  kind: BuildingKind;
  tile: GridPoint;
  selected: boolean;
  health: number;
  constructionRemainingTicks: number;
  constructionTotalTicks: number;
  powered: boolean;
  connected: boolean;
  repairing: boolean;
  cooldownTicks: number;
  queue: ProductionItem[];
};

type FieldState = {
  id: number;
  tile: GridPoint;
  amount: number;
  capacity: number;
  regenPerMinute: number;
  regenAccumulator: number;
  contested: boolean;
};

type PlayerState = {
  id: PlayerId;
  credits: number;
  powerGenerated: number;
  powerConsumed: number;
};

type ProjectileState = {
  id: number;
  playerId: PlayerId;
  weapon: WeaponDefinition;
  position: { x: number; y: number };
  targetType: "unit" | "structure";
  targetId: number;
  willHit: boolean;
};

type StartingUnit = Readonly<{
  id: UnitId;
  callsign: string;
  playerId: PlayerId;
  kind: UnitKind;
  tile: GridPoint;
}>;

type StartingStructure = Readonly<{
  id: StructureId;
  playerId: PlayerId;
  kind: BuildingKind;
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

const COMBAT_UNITS: readonly StartingUnit[] = Object.freeze([
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

const ECONOMY_STRUCTURE_DATA: readonly StartingStructure[] = [
  { id: 1, playerId: 1, kind: "citadel", tile: { x: 8, y: 9 } },
  { id: 2, playerId: 1, kind: "reactor", tile: { x: 12, y: 9 } },
  { id: 3, playerId: 1, kind: "refinery", tile: { x: 10, y: 14 } },
  { id: 4, playerId: 2, kind: "citadel", tile: { x: 55, y: 54 } },
  { id: 5, playerId: 2, kind: "reactor", tile: { x: 51, y: 54 } },
  { id: 6, playerId: 2, kind: "refinery", tile: { x: 53, y: 49 } },
] as const;

const ECONOMY_STRUCTURES: readonly StartingStructure[] = Object.freeze(
  ECONOMY_STRUCTURE_DATA.map((structure) =>
  Object.freeze({ ...structure, tile: Object.freeze(structure.tile) }),
  ),
);

const ECONOMY_FIELDS: readonly Omit<FieldState, "regenAccumulator">[] =
  Object.freeze([
    {
      id: 1,
      tile: { x: 17, y: 16 },
      amount: 12_000,
      capacity: 12_000,
      regenPerMinute: 50,
      contested: false,
    },
    {
      id: 2,
      tile: { x: 46, y: 47 },
      amount: 12_000,
      capacity: 12_000,
      regenPerMinute: 50,
      contested: false,
    },
    {
      id: 3,
      tile: { x: 28, y: 31 },
      amount: 18_000,
      capacity: 18_000,
      regenPerMinute: 300,
      contested: true,
    },
    {
      id: 4,
      tile: { x: 35, y: 32 },
      amount: 18_000,
      capacity: 18_000,
      regenPerMinute: 300,
      contested: true,
    },
  ].map((field) =>
    Object.freeze({ ...field, tile: Object.freeze(field.tile) }),
  ));

export const toTile = (position: Vec2): GridPoint => ({
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

const gridDistanceSquared = (left: GridPoint, right: GridPoint) => {
  const dx = right.x - left.x;
  const dy = right.y - left.y;
  return dx * dx + dy * dy;
};

export class DeterministicRng {
  private state: number;

  constructor(seed = DEFAULT_COMBAT_SEED) {
    this.state = seed >>> 0;
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
  private scenario: SimulationScenario;
  private controlledPlayer: PlayerId = 1;
  private units: UnitState[] = [];
  private structures: StructureState[] = [];
  private fields: FieldState[] = [];
  private players: Record<PlayerId, PlayerState> = {
    1: { id: 1, credits: 0, powerGenerated: 0, powerConsumed: 0 },
    2: { id: 2, credits: 0, powerGenerated: 0, powerConsumed: 0 },
  };
  private projectiles: ProjectileState[] = [];
  private nextUnitId = 100;
  private nextStructureId = 100;
  private nextProjectileId = 1;
  private readonly controlGroups = new Map<number, UnitId[]>();
  private readonly rallies = new Map<number, GridPoint>();
  private kills: Record<PlayerId, number> = { 1: 0, 2: 0 };
  private status: SimulationSnapshot["status"] = "active";
  private winner: PlayerId | null = null;
  private lastPlacementFailure: PlacementFailure | null = null;

  constructor(
    seed = DEFAULT_COMBAT_SEED,
    scenario: SimulationScenario = "combat",
  ) {
    this.seed = seed >>> 0;
    this.rng = new DeterministicRng(this.seed);
    this.scenario = scenario;
    if (scenario === "economy") this.resetEconomy(this.seed);
    else this.resetCombat(this.seed);
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

    if (this.scenario === "economy") {
      this.updateConstruction();
      this.updateConnectivityAndPower();
      this.updateRepairs();
      this.updateProduction();
      this.updateFields();
    }

    for (const unit of this.sortedUnits()) {
      if (unit.cooldownTicks > 0) unit.cooldownTicks -= 1;
      if (this.scenario === "economy" && unit.kind === "midasHarvester") {
        this.updateHarvester(unit);
      } else {
        this.updateCombatOrder(unit);
      }
    }
    if (this.scenario === "economy") this.updateTurrets();
    for (const unit of this.sortedUnits()) this.moveUnit(unit);
    this.applyLocalSeparation();
    this.updateProjectiles();
    this.removeDestroyedEntities();
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
        targetStructureId: unit.targetStructureId,
        cooldownTicks: unit.cooldownTicks,
        cargo: unit.cargo,
        cargoCapacity: definition.cargoCapacity,
      });
    });
    const structures: readonly StructureSnapshot[] = Object.freeze(
      this.sortedStructures().map((structure) => {
        const definition = gameData.buildings[structure.kind];
        const completed = structure.constructionRemainingTicks === 0;
        return Object.freeze({
          id: structure.id,
          playerId: structure.playerId,
          kind: structure.kind,
          displayName: definition.displayName,
          tile: Object.freeze({ ...structure.tile }),
          selected: structure.selected,
          health: structure.health,
          maxHealth: definition.maxHealth,
          constructionRemainingTicks: structure.constructionRemainingTicks,
          constructionTotalTicks: structure.constructionTotalTicks,
          completed,
          powered: structure.powered,
          connected: structure.connected,
          repairing: structure.repairing,
          powerGenerated: completed ? definition.powerGenerated : 0,
          powerConsumed: completed ? definition.powerConsumed : 0,
          buildRadius: definition.buildRadius,
          queue: Object.freeze(
            structure.queue.map((item) =>
              Object.freeze({
                unitKind: item.unitKind,
                remainingTicks: item.remainingTicks,
                totalTicks: item.totalTicks,
              } satisfies ProductionItemSnapshot),
            ),
          ),
        });
      }),
    );
    const fields: readonly AureliteFieldSnapshot[] = Object.freeze(
      this.fields
        .slice()
        .sort((a, b) => a.id - b.id)
        .map((field) =>
          Object.freeze({
            id: field.id,
            tile: Object.freeze({ ...field.tile }),
            amount: field.amount,
            capacity: field.capacity,
            contested: field.contested,
          }),
        ),
    );
    const players = Object.freeze({
      1: this.playerSnapshot(1),
      2: this.playerSnapshot(2),
    }) as Readonly<Record<PlayerId, PlayerSnapshot>>;
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
            targetType: projectile.targetType,
            targetId: projectile.targetId,
          }),
        ),
    );
    return Object.freeze({
      tick: this.tick,
      scenario: this.scenario,
      controlledPlayer: this.controlledPlayer,
      units: Object.freeze(units),
      structures,
      fields,
      players,
      projectiles,
      selectedUnitIds: Object.freeze(
        units.filter((unit) => unit.selected).map((unit) => unit.id),
      ),
      selectedStructureIds: Object.freeze(
        structures
          .filter((structure) => structure.selected)
          .map((structure) => structure.id),
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
      lastPlacementFailure: this.lastPlacementFailure,
    });
  }

  private playerSnapshot(playerId: PlayerId): PlayerSnapshot {
    const player = this.players[playerId];
    return Object.freeze({
      id: player.id,
      credits: player.credits,
      powerGenerated: player.powerGenerated,
      powerConsumed: player.powerConsumed,
      lowPower: player.powerConsumed > player.powerGenerated,
    });
  }

  private resetShared(seed: number, scenario: SimulationScenario) {
    this.tick = 0;
    this.seed = seed >>> 0;
    this.rng = new DeterministicRng(this.seed);
    this.scenario = scenario;
    this.controlledPlayer = 1;
    this.units = [];
    this.structures = [];
    this.fields = [];
    this.players = {
      1: { id: 1, credits: 0, powerGenerated: 0, powerConsumed: 0 },
      2: { id: 2, credits: 0, powerGenerated: 0, powerConsumed: 0 },
    };
    this.projectiles = [];
    this.nextUnitId = 100;
    this.nextStructureId = 100;
    this.nextProjectileId = 1;
    this.controlGroups.clear();
    this.rallies.clear();
    this.kills = { 1: 0, 2: 0 };
    this.status = "active";
    this.winner = null;
    this.lastPlacementFailure = null;
  }

  private resetCombat(seed: number) {
    this.resetShared(seed, "combat");
    this.units = COMBAT_UNITS.map((startingUnit) =>
      this.createUnitState(
        startingUnit.id,
        startingUnit.playerId,
        startingUnit.kind,
        startingUnit.tile,
        startingUnit.callsign,
      ),
    );
    this.nextUnitId = 13;
    for (const unit of this.units.filter((unit) => unit.playerId === 2)) {
      unit.order = "attackMove";
      unit.attackMoveDestination = { x: 21, y: 31 };
    }
    this.issueSideMove(2, { x: 21, y: 31 }, "attackMove");
  }

  private resetEconomy(seed: number) {
    this.resetShared(seed, "economy");
    this.players[1].credits = gameData.economy.startingCredits;
    this.players[2].credits = gameData.economy.startingCredits;
    this.structures = ECONOMY_STRUCTURES.map((starting) =>
      this.createStructureState(
        starting.id,
        starting.playerId,
        starting.kind,
        starting.tile,
        true,
      ),
    );
    this.fields = ECONOMY_FIELDS.map((field) => ({
      ...field,
      tile: { ...field.tile },
      regenAccumulator: 0,
    }));
    this.units = [
      this.createUnitState(
        1,
        1,
        "midasHarvester",
        { x: 14, y: 15 },
        "Midas Gold",
      ),
      this.createUnitState(
        2,
        2,
        "midasHarvester",
        { x: 49, y: 48 },
        "Midas Cyan",
      ),
    ];
    this.nextUnitId = 3;
    this.nextStructureId = 7;
    this.updateConnectivityAndPower();
  }

  private createUnitState(
    id: number,
    playerId: PlayerId,
    kind: UnitKind,
    tile: GridPoint,
    callsign = `${gameData.units[kind].displayName} ${id}`,
  ): UnitState {
    return {
      id,
      callsign,
      playerId,
      kind,
      formationId: playerId,
      position: { ...tileCenter(tile) },
      selected: false,
      order: "idle",
      path: [],
      pathIndex: 0,
      destination: null,
      attackMoveDestination: null,
      health: gameData.units[kind].maxHealth,
      cooldownTicks: 0,
      targetId: null,
      targetStructureId: null,
      forcedTarget: false,
      cargo: 0,
      harvestFieldId: null,
    };
  }

  private createStructureState(
    id: number,
    playerId: PlayerId,
    kind: BuildingKind,
    tile: GridPoint,
    completed: boolean,
  ): StructureState {
    const definition = gameData.buildings[kind];
    return {
      id,
      playerId,
      kind,
      tile: { ...tile },
      selected: false,
      health: definition.maxHealth,
      constructionRemainingTicks: completed ? 0 : definition.buildTicks,
      constructionTotalTicks: definition.buildTicks,
      powered: completed,
      connected: kind === "citadel",
      repairing: false,
      cooldownTicks: 0,
      queue: [],
    };
  }

  private applyCommand(command: SimCommand) {
    if (command.kind === "restartCombat") {
      this.resetCombat(command.seed ?? this.seed);
      this.commands.length = 0;
      return;
    }
    if (command.kind === "restartEconomy") {
      this.resetEconomy(command.seed ?? this.seed);
      this.commands.length = 0;
      return;
    }
    if (this.status !== "active") return;

    if (command.kind === "switchPlayer") {
      this.controlledPlayer = command.playerId;
      this.clearSelections();
      this.lastPlacementFailure = null;
      return;
    }
    if (command.kind === "selectUnits") {
      const requested = new Set(command.unitIds);
      if (!command.additive) this.clearSelections();
      for (const unit of this.units) {
        if (
          this.scenario === "economy" &&
          unit.playerId !== this.controlledPlayer
        ) {
          continue;
        }
        unit.selected = command.additive
          ? unit.selected || requested.has(unit.id)
          : requested.has(unit.id);
      }
      return;
    }
    if (command.kind === "selectStructures") {
      const requested = new Set(command.structureIds);
      if (!command.additive) this.clearSelections();
      for (const structure of this.structures) {
        if (
          this.scenario === "economy" &&
          structure.playerId !== this.controlledPlayer
        ) {
          continue;
        }
        structure.selected = command.additive
          ? structure.selected || requested.has(structure.id)
          : requested.has(structure.id);
      }
      return;
    }
    if (command.kind === "placeBuilding") {
      this.placeBuilding(
        this.controlledPlayer,
        command.buildingKind,
        command.tile,
      );
      return;
    }
    if (command.kind === "queueUnit") {
      this.queueUnit(command.structureId, command.unitKind);
      return;
    }
    if (command.kind === "cancelProduction") {
      this.cancelProduction(command.structureId, command.queueIndex);
      return;
    }
    if (command.kind === "setRepair") {
      const structure = this.structureById(command.structureId);
      if (
        structure &&
        structure.playerId === this.controlledPlayer &&
        structure.constructionRemainingTicks === 0
      ) {
        structure.repairing = command.enabled;
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
      this.clearSelections();
      for (const unit of this.units) {
        unit.selected =
          (this.scenario === "combat" ||
            unit.playerId === this.controlledPlayer) &&
          group.has(unit.id);
      }
      return;
    }
    if (command.kind === "stop" || command.kind === "hold") {
      for (const unit of this.selectedUnits()) {
        this.clearPath(unit);
        unit.targetId = null;
        unit.targetStructureId = null;
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
      if (!target || target.playerId === this.controlledPlayer) return;
      for (const unit of this.selectedUnits()) {
        unit.targetId = target.id;
        unit.targetStructureId = null;
        unit.forcedTarget = true;
        unit.attackMoveDestination = null;
        unit.order = "attack";
        this.planChase(unit, target.position);
      }
      return;
    }
    if (command.kind === "attackStructure") {
      const target = this.structureById(command.targetStructureId);
      if (!target || target.playerId === this.controlledPlayer) return;
      for (const unit of this.selectedUnits()) {
        unit.targetId = null;
        unit.targetStructureId = target.id;
        unit.forcedTarget = true;
        unit.attackMoveDestination = null;
        unit.order = "attack";
        this.planChase(unit, tileCenter(target.tile));
      }
      return;
    }
    if (command.kind === "move") {
      this.issueFormationMove(command.target, command.mode);
    }
  }

  private clearSelections() {
    for (const unit of this.units) unit.selected = false;
    for (const structure of this.structures) structure.selected = false;
  }

  private sortedUnits() {
    return this.units.slice().sort((a, b) => a.id - b.id);
  }

  private sortedStructures() {
    return this.structures.slice().sort((a, b) => a.id - b.id);
  }

  private unitById(id: UnitId) {
    return this.units.find((unit) => unit.id === id);
  }

  private structureById(id: StructureId) {
    return this.structures.find((structure) => structure.id === id);
  }

  private selectedUnits() {
    return this.units
      .filter(
        (unit) =>
          unit.selected &&
          (this.scenario === "combat" ||
            unit.playerId === this.controlledPlayer),
      )
      .sort((a, b) => a.id - b.id);
  }

  private issueSideMove(
    playerId: PlayerId,
    target: GridPoint,
    mode: "move" | "attackMove",
  ) {
    this.issueFormationMoveFor(
      this.units.filter((unit) => unit.playerId === playerId),
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

  private occupiedTiles(excludedUnitIds = new Set<number>()) {
    return new Set([
      ...this.units
        .filter((unit) => !excludedUnitIds.has(unit.id))
        .map((unit) => tileKeyOf(toTile(unit.position))),
      ...this.structures.map((structure) => tileKeyOf(structure.tile)),
      ...this.fields.map((field) => tileKeyOf(field.tile)),
    ]);
  }

  private issueFormationMoveFor(
    selectedInput: readonly UnitState[],
    requestedTarget: GridPoint,
    mode: "move" | "attackMove",
  ) {
    const selected = selectedInput.slice().sort((a, b) => a.id - b.id);
    if (selected.length === 0) return;
    const selectedIds = new Set(selected.map((unit) => unit.id));
    const occupied = this.occupiedTiles(selectedIds);
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
      const destination = nearestWalkable(
        { x: anchorTarget.x + offset.x, y: anchorTarget.y + offset.y },
        { occupied, reserved },
      );
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
      unit.targetStructureId = null;
      unit.harvestFieldId = null;
      unit.forcedTarget = false;
      unit.order = mode;
      reserved.add(tileKeyOf(destination));
    }
  }

  private updateCombatOrder(unit: UnitState) {
    const definition = gameData.units[unit.kind];
    const weapon = gameData.weapons[definition.weaponId];
    let unitTarget =
      unit.targetId === null ? undefined : this.unitById(unit.targetId);
    let structureTarget =
      unit.targetStructureId === null
        ? undefined
        : this.structureById(unit.targetStructureId);

    if (
      !unitTarget ||
      unitTarget.playerId === unit.playerId ||
      unitTarget.health <= 0
    ) {
      unit.targetId = null;
      unitTarget = undefined;
    }
    if (
      !structureTarget ||
      structureTarget.playerId === unit.playerId ||
      structureTarget.health <= 0
    ) {
      unit.targetStructureId = null;
      structureTarget = undefined;
    }

    if (!unitTarget && !structureTarget) {
      const completedForcedAttack = unit.forcedTarget;
      unit.forcedTarget = false;
      if (completedForcedAttack && unit.order === "attack") {
        unit.order = "idle";
        this.clearPath(unit);
      } else if (unit.order === "attackMove" && unit.attackMoveDestination) {
        this.planPath(unit, unit.attackMoveDestination);
      }
    }

    if (
      !unitTarget &&
      !structureTarget &&
      unit.order !== "move" &&
      unit.order !== "hold"
    ) {
      unitTarget = this.acquireUnitTarget(unit, definition.visionMilli);
      if (unitTarget) unit.targetId = unitTarget.id;
      else if (this.scenario === "economy") {
        structureTarget = this.acquireStructureTarget(
          unit,
          definition.visionMilli,
        );
        if (structureTarget) unit.targetStructureId = structureTarget.id;
      }
    }

    if (
      !unitTarget &&
      !structureTarget &&
      this.scenario === "combat" &&
      unit.playerId === 2 &&
      unit.order === "idle"
    ) {
      unit.order = "attackMove";
      unit.attackMoveDestination = { x: 21, y: 31 };
      this.planPath(unit, unit.attackMoveDestination);
      return;
    }
    const targetPosition = unitTarget?.position ??
      (structureTarget ? tileCenter(structureTarget.tile) : null);
    if (!targetPosition) return;

    const rangeSquared = weapon.rangeMilli * weapon.rangeMilli;
    if (distanceSquared(unit.position, targetPosition) <= rangeSquared) {
      this.clearPath(unit);
      if (unit.cooldownTicks === 0) {
        this.fire(
          unit.playerId,
          unit.position,
          unitTarget ? "unit" : "structure",
          (unitTarget ?? structureTarget)!.id,
          weapon,
        );
        unit.cooldownTicks = weapon.cooldownTicks;
      }
      return;
    }
    if (unit.order === "hold") {
      unit.targetId = null;
      unit.targetStructureId = null;
      unit.forcedTarget = false;
      return;
    }
    if (this.tick % CHASE_REPATH_TICKS === unit.id % CHASE_REPATH_TICKS) {
      this.planChase(unit, targetPosition);
    }
  }

  private acquireUnitTarget(unit: UnitState, acquisitionRange: number) {
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

  private acquireStructureTarget(unit: UnitState, acquisitionRange: number) {
    const rangeSquared = acquisitionRange * acquisitionRange;
    return this.structures
      .filter(
        (candidate) =>
          candidate.playerId !== unit.playerId &&
          candidate.health > 0 &&
          distanceSquared(unit.position, tileCenter(candidate.tile)) <=
            rangeSquared,
      )
      .map((candidate) => ({
        candidate,
        distance: distanceSquared(unit.position, tileCenter(candidate.tile)),
      }))
      .sort(
        (left, right) =>
          left.distance - right.distance ||
          left.candidate.id - right.candidate.id,
      )[0]?.candidate;
  }

  private fire(
    playerId: PlayerId,
    position: Vec2,
    targetType: "unit" | "structure",
    targetId: number,
    weapon: WeaponDefinition,
  ) {
    this.projectiles.push({
      id: this.nextProjectileId,
      playerId,
      weapon,
      position: { ...position },
      targetType,
      targetId,
      willHit: this.rng.nextBasisPoints() < weapon.accuracyBasisPoints,
    });
    this.nextProjectileId += 1;
  }

  private planChase(unit: UnitState, position: Vec2) {
    const targetTile = toTile(position);
    const destination = this.nearestOpenAdjacentTile(targetTile, unit.id);
    if (destination) this.planPath(unit, destination);
  }

  private planPath(unit: UnitState, requestedTarget: GridPoint) {
    const occupied = this.occupiedTiles(new Set([unit.id]));
    const destination = nearestWalkable(requestedTarget, { occupied });
    if (!destination) return;
    const path = findPath(toTile(unit.position), destination, { occupied });
    if (path.length === 0) return;
    unit.path = path.slice(1).map((point) => ({ ...point }));
    unit.pathIndex = 0;
    unit.destination = { ...destination };
  }

  private nearestOpenAdjacentTile(tile: GridPoint, unitId: number) {
    const occupied = this.occupiedTiles(new Set([unitId]));
    return [
      { x: tile.x - 1, y: tile.y },
      { x: tile.x + 1, y: tile.y },
      { x: tile.x, y: tile.y - 1 },
      { x: tile.x, y: tile.y + 1 },
      { x: tile.x - 1, y: tile.y - 1 },
      { x: tile.x + 1, y: tile.y + 1 },
    ]
      .filter(
        (candidate) =>
          !isTerrainBlocked(candidate) &&
          !occupied.has(tileKeyOf(candidate)),
      )
      .sort(
        (left, right) =>
          gridDistanceSquared(toTile(this.unitById(unitId)!.position), left) -
            gridDistanceSquared(
              toTile(this.unitById(unitId)!.position),
              right,
            ) ||
          tileKeyOf(left) - tileKeyOf(right),
      )[0];
  }

  private clearPath(unit: UnitState) {
    unit.path = [];
    unit.pathIndex = 0;
    unit.destination = null;
  }

  private moveUnit(unit: UnitState) {
    if (unit.pathIndex >= unit.path.length) {
      if (unit.order === "move" && unit.destination) {
        this.clearPath(unit);
        unit.order = "idle";
      }
      return;
    }
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

  private updateConstruction() {
    for (const structure of this.sortedStructures()) {
      if (structure.constructionRemainingTicks <= 0) continue;
      structure.constructionRemainingTicks -= 1;
      if (
        structure.constructionRemainingTicks === 0 &&
        structure.kind === "refinery"
      ) {
        this.spawnUnit(structure, "midasHarvester");
      }
    }
  }

  private updateConnectivityAndPower() {
    for (const playerId of [1, 2] as const) {
      const completed = this.sortedStructures().filter(
        (structure) =>
          structure.playerId === playerId &&
          structure.constructionRemainingTicks === 0 &&
          structure.health > 0,
      );
      for (const structure of completed) {
        structure.connected = structure.kind === "citadel";
      }
      let changed = true;
      while (changed) {
        changed = false;
        for (const candidate of completed) {
          if (candidate.connected) continue;
          if (
            completed.some((source) => {
              if (!source.connected) return false;
              const radius = gameData.buildings[source.kind].buildRadius;
              return (
                radius > 0 &&
                gridDistanceSquared(source.tile, candidate.tile) <=
                  radius * radius
              );
            })
          ) {
            candidate.connected = true;
            changed = true;
          }
        }
      }

      const generated = completed.reduce(
        (total, structure) =>
          total + gameData.buildings[structure.kind].powerGenerated,
        0,
      );
      const demanded = completed.reduce(
        (total, structure) =>
          total + gameData.buildings[structure.kind].powerConsumed,
        0,
      );
      let available = generated;
      for (const structure of completed) {
        const demand = gameData.buildings[structure.kind].powerConsumed;
        structure.powered = demand === 0 || available >= demand;
        if (structure.powered) available -= demand;
      }
      this.players[playerId].powerGenerated = generated;
      this.players[playerId].powerConsumed = demanded;
    }
  }

  private updateRepairs() {
    for (const structure of this.sortedStructures()) {
      if (!structure.repairing) continue;
      const definition = gameData.buildings[structure.kind];
      if (structure.health >= definition.maxHealth) {
        structure.repairing = false;
        continue;
      }
      const player = this.players[structure.playerId];
      if (player.credits <= 0) {
        structure.repairing = false;
        continue;
      }
      player.credits -= 1;
      structure.health = Math.min(
        definition.maxHealth,
        structure.health + gameData.economy.repairHealthPerCredit,
      );
    }
  }

  private updateProduction() {
    for (const structure of this.sortedStructures()) {
      if (
        structure.queue.length === 0 ||
        structure.constructionRemainingTicks > 0 ||
        !structure.powered
      ) {
        continue;
      }
      const item = structure.queue[0];
      item.remainingTicks -= 1;
      if (item.remainingTicks > 0) continue;
      if (!this.spawnUnit(structure, item.unitKind)) {
        item.remainingTicks = 1;
        continue;
      }
      structure.queue.shift();
    }
  }

  private updateFields() {
    for (const field of this.fields) {
      if (field.amount >= field.capacity) {
        field.regenAccumulator = 0;
        continue;
      }
      field.regenAccumulator += field.regenPerMinute;
      if (field.regenAccumulator < REGEN_DENOMINATOR) continue;
      const regenerated = Math.floor(
        field.regenAccumulator / REGEN_DENOMINATOR,
      );
      field.regenAccumulator %= REGEN_DENOMINATOR;
      field.amount = Math.min(field.capacity, field.amount + regenerated);
    }
  }

  private updateHarvester(unit: UnitState) {
    if (unit.forcedTarget || unit.order === "attack") {
      this.updateCombatOrder(unit);
      return;
    }
    if (unit.order === "move" || unit.order === "hold") return;
    if (unit.order === "attackMove") {
      this.updateCombatOrder(unit);
      return;
    }
    const definition = gameData.units.midasHarvester;
    if (unit.cargo >= definition.cargoCapacity) {
      const refinery = this.nearestOperationalRefinery(unit);
      if (!refinery) {
        unit.order = "idle";
        this.clearPath(unit);
        return;
      }
      unit.order = "unload";
      if (
        distanceSquared(unit.position, tileCenter(refinery.tile)) <=
        1_600 * 1_600
      ) {
        const unloaded = Math.min(
          gameData.economy.unloadAmountPerTick,
          unit.cargo,
        );
        unit.cargo -= unloaded;
        this.players[unit.playerId].credits += unloaded;
        if (unit.cargo === 0) {
          unit.order = "harvest";
          unit.harvestFieldId = null;
        }
      } else if (unit.path.length === 0) {
        const adjacent = this.nearestOpenAdjacentTile(refinery.tile, unit.id);
        if (adjacent) this.planPath(unit, adjacent);
      }
      return;
    }

    let field =
      unit.harvestFieldId === null
        ? undefined
        : this.fields.find((candidate) => candidate.id === unit.harvestFieldId);
    if (!field || field.amount <= 0) {
      field = this.fields
        .filter((candidate) => candidate.amount > 0)
        .map((candidate) => ({
          candidate,
          distance: distanceSquared(unit.position, tileCenter(candidate.tile)),
        }))
        .sort(
          (left, right) =>
            left.distance - right.distance ||
            left.candidate.id - right.candidate.id,
        )[0]?.candidate;
      unit.harvestFieldId = field?.id ?? null;
    }
    if (!field) {
      unit.order = "idle";
      this.clearPath(unit);
      return;
    }
    unit.order = "harvest";
    if (
      distanceSquared(unit.position, tileCenter(field.tile)) <=
      1_600 * 1_600
    ) {
      this.clearPath(unit);
      if (this.tick % gameData.economy.harvestIntervalTicks === unit.id % 10) {
        const gathered = Math.min(
          gameData.economy.harvestAmount,
          field.amount,
          definition.cargoCapacity - unit.cargo,
        );
        field.amount -= gathered;
        unit.cargo += gathered;
      }
    } else if (unit.path.length === 0) {
      const adjacent = this.nearestOpenAdjacentTile(field.tile, unit.id);
      if (adjacent) this.planPath(unit, adjacent);
    }
  }

  private nearestOperationalRefinery(unit: UnitState) {
    return this.structures
      .filter(
        (structure) =>
          structure.playerId === unit.playerId &&
          structure.kind === "refinery" &&
          structure.constructionRemainingTicks === 0 &&
          structure.powered &&
          structure.health > 0,
      )
      .map((structure) => ({
        structure,
        distance: distanceSquared(unit.position, tileCenter(structure.tile)),
      }))
      .sort(
        (left, right) =>
          left.distance - right.distance ||
          left.structure.id - right.structure.id,
      )[0]?.structure;
  }

  private updateTurrets() {
    for (const structure of this.sortedStructures()) {
      if (structure.cooldownTicks > 0) structure.cooldownTicks -= 1;
      const definition = gameData.buildings[structure.kind];
      if (
        !definition.weaponId ||
        !structure.powered ||
        structure.constructionRemainingTicks > 0
      ) {
        continue;
      }
      const weapon = gameData.weapons[definition.weaponId];
      if (structure.cooldownTicks > 0) continue;
      const position = tileCenter(structure.tile);
      const target = this.units
        .filter(
          (unit) =>
            unit.playerId !== structure.playerId &&
            distanceSquared(position, unit.position) <=
              weapon.rangeMilli * weapon.rangeMilli,
        )
        .map((unit) => ({
          unit,
          distance: distanceSquared(position, unit.position),
        }))
        .sort(
          (left, right) =>
            left.distance - right.distance || left.unit.id - right.unit.id,
        )[0]?.unit;
      if (!target) continue;
      this.fire(structure.playerId, position, "unit", target.id, weapon);
      structure.cooldownTicks = weapon.cooldownTicks;
    }
  }

  private placementFailure(
    playerId: PlayerId,
    buildingKind: BuildingKind,
    tile: GridPoint,
  ): PlacementFailure | null {
    const definition = gameData.buildings[buildingKind];
    if (
      tile.x < 0 ||
      tile.y < 0 ||
      tile.x >= MAP_SIZE ||
      tile.y >= MAP_SIZE
    ) {
      return "outsideMap";
    }
    if (isTerrainBlocked(tile)) return "blockedTerrain";
    if (
      this.units.some((unit) => tileKeyOf(toTile(unit.position)) === tileKeyOf(tile)) ||
      this.structures.some(
        (structure) => tileKeyOf(structure.tile) === tileKeyOf(tile),
      )
    ) {
      return "occupied";
    }
    if (this.fields.some((field) => tileKeyOf(field.tile) === tileKeyOf(tile))) {
      return "resourceField";
    }
    if (
      definition.prerequisites.some(
        (required) => !this.hasCompletedStructure(playerId, required),
      )
    ) {
      return "missingPrerequisite";
    }
    if (this.players[playerId].credits < definition.cost) {
      return "insufficientCredits";
    }
    if (
      buildingKind === "citadel" &&
      this.structures.some(
        (structure) =>
          structure.playerId === playerId &&
          structure.kind === "citadel" &&
          structure.health > 0,
      )
    ) {
      return "citadelUnique";
    }
    const inRadius = this.structures.some((structure) => {
      if (
        structure.playerId !== playerId ||
        structure.constructionRemainingTicks > 0 ||
        !structure.connected
      ) {
        return false;
      }
      const radius = gameData.buildings[structure.kind].buildRadius;
      return (
        radius > 0 &&
        gridDistanceSquared(structure.tile, tile) <= radius * radius
      );
    });
    return inRadius ? null : "outsideBuildRadius";
  }

  private placeBuilding(
    playerId: PlayerId,
    buildingKind: BuildingKind,
    tile: GridPoint,
  ) {
    const failure = this.placementFailure(playerId, buildingKind, tile);
    this.lastPlacementFailure = failure;
    if (failure) return;
    const definition = gameData.buildings[buildingKind];
    this.players[playerId].credits -= definition.cost;
    this.structures.push(
      this.createStructureState(
        this.nextStructureId,
        playerId,
        buildingKind,
        tile,
        false,
      ),
    );
    this.nextStructureId += 1;
  }

  private queueUnit(structureId: number, unitKind: UnitKind) {
    const structure = this.structureById(structureId);
    if (
      !structure ||
      structure.playerId !== this.controlledPlayer ||
      structure.constructionRemainingTicks > 0 ||
      structure.queue.length >= gameData.economy.productionQueueLimit
    ) {
      return;
    }
    const definition = gameData.units[unitKind];
    if (
      definition.producedAt !== structure.kind ||
      definition.prerequisites.some(
        (required) =>
          !this.hasCompletedStructure(structure.playerId, required),
      ) ||
      this.players[structure.playerId].credits < definition.cost
    ) {
      return;
    }
    this.players[structure.playerId].credits -= definition.cost;
    structure.queue.push({
      unitKind,
      remainingTicks: definition.buildTicks,
      totalTicks: definition.buildTicks,
    });
  }

  private cancelProduction(structureId: number, queueIndex: number) {
    const structure = this.structureById(structureId);
    if (
      !structure ||
      structure.playerId !== this.controlledPlayer ||
      queueIndex < 0 ||
      queueIndex >= structure.queue.length
    ) {
      return;
    }
    const [cancelled] = structure.queue.splice(queueIndex, 1);
    this.players[structure.playerId].credits +=
      gameData.units[cancelled.unitKind].cost;
  }

  private hasCompletedStructure(
    playerId: PlayerId,
    kind: BuildingKind,
  ) {
    return this.structures.some(
      (structure) =>
        structure.playerId === playerId &&
        structure.kind === kind &&
        structure.constructionRemainingTicks === 0 &&
        structure.health > 0,
    );
  }

  private spawnUnit(structure: StructureState, unitKind: UnitKind) {
    const spawnTile = this.nearestSpawnTile(structure.tile);
    if (!spawnTile) return false;
    const unit = this.createUnitState(
      this.nextUnitId,
      structure.playerId,
      unitKind,
      spawnTile,
    );
    this.nextUnitId += 1;
    this.units.push(unit);
    const rally = this.rallies.get(structure.playerId);
    if (rally) {
      unit.order = "move";
      this.planPath(unit, rally);
    }
    return true;
  }

  private nearestSpawnTile(tile: GridPoint) {
    const occupied = this.occupiedTiles();
    const candidates: GridPoint[] = [];
    for (let radius = 1; radius <= 3; radius += 1) {
      for (let y = tile.y - radius; y <= tile.y + radius; y += 1) {
        for (let x = tile.x - radius; x <= tile.x + radius; x += 1) {
          if (
            Math.max(Math.abs(x - tile.x), Math.abs(y - tile.y)) !== radius
          ) {
            continue;
          }
          const candidate = { x, y };
          if (
            !isTerrainBlocked(candidate) &&
            !occupied.has(tileKeyOf(candidate))
          ) {
            candidates.push(candidate);
          }
        }
      }
      if (candidates.length > 0) break;
    }
    return candidates.sort((a, b) => tileKeyOf(a) - tileKeyOf(b))[0];
  }

  private updateProjectiles() {
    const remaining: ProjectileState[] = [];
    for (const projectile of this.projectiles
      .slice()
      .sort((a, b) => a.id - b.id)) {
      const target =
        projectile.targetType === "unit"
          ? this.unitById(projectile.targetId)
          : this.structureById(projectile.targetId);
      if (!target || target.health <= 0) continue;
      const targetPosition =
        projectile.targetType === "unit"
          ? (target as UnitState).position
          : tileCenter((target as StructureState).tile);
      const dx = targetPosition.x - projectile.position.x;
      const dy = targetPosition.y - projectile.position.y;
      const distance = integerSqrt(dx * dx + dy * dy);
      if (distance <= projectile.weapon.projectileSpeedMilli) {
        if (projectile.willHit) {
          const armor =
            projectile.targetType === "unit"
              ? gameData.units[(target as UnitState).kind].armor
              : gameData.buildings[(target as StructureState).kind].armor;
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

  private removeDestroyedEntities() {
    const destroyedUnits = this.units
      .filter((unit) => unit.health <= 0)
      .sort((a, b) => a.id - b.id);
    for (const unit of destroyedUnits) {
      const killer = unit.playerId === 1 ? 2 : 1;
      this.kills[killer] += 1;
      for (const group of this.controlGroups.values()) {
        const index = group.indexOf(unit.id);
        if (index >= 0) group.splice(index, 1);
      }
    }
    if (destroyedUnits.length > 0) {
      const destroyedIds = new Set(destroyedUnits.map((unit) => unit.id));
      this.units = this.units.filter((unit) => !destroyedIds.has(unit.id));
      this.projectiles = this.projectiles.filter(
        (projectile) =>
          projectile.targetType !== "unit" ||
          !destroyedIds.has(projectile.targetId),
      );
    }

    const destroyedStructures = this.structures
      .filter((structure) => structure.health <= 0)
      .sort((a, b) => a.id - b.id);
    if (destroyedStructures.length > 0) {
      for (const structure of destroyedStructures) {
        const player = this.players[structure.playerId];
        for (const item of structure.queue) {
          player.credits += gameData.units[item.unitKind].cost;
        }
      }
      const destroyedIds = new Set(
        destroyedStructures.map((structure) => structure.id),
      );
      this.structures = this.structures.filter(
        (structure) => !destroyedIds.has(structure.id),
      );
      this.projectiles = this.projectiles.filter(
        (projectile) =>
          projectile.targetType !== "structure" ||
          !destroyedIds.has(projectile.targetId),
      );
      for (const unit of this.units) {
        if (
          unit.targetStructureId !== null &&
          destroyedIds.has(unit.targetStructureId)
        ) {
          unit.targetStructureId = null;
        }
      }
      this.updateConnectivityAndPower();
    }
  }

  private resolveMatch() {
    const playerAlive =
      this.scenario === "combat"
        ? this.units.some((unit) => unit.playerId === 1)
        : this.structures.some(
            (structure) =>
              structure.playerId === 1 && structure.kind === "citadel",
          );
    const enemyAlive =
      this.scenario === "combat"
        ? this.units.some((unit) => unit.playerId === 2)
        : this.structures.some(
            (structure) =>
              structure.playerId === 2 && structure.kind === "citadel",
          );
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
      unit.targetStructureId = null;
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
