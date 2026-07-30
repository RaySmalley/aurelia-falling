import {
  gameData,
  type AiProfile,
  type WeaponDefinition,
} from "./data";
import {
  isTerrainBlocked,
  MAP_SIZE,
  TILE_MILLI,
  tileKeyOf,
} from "./map";
import {
  nearestWalkable,
  translateSharedPath,
  type PathOptions,
} from "./pathfinding";
import {
  DeterministicPathRequestQueue,
  type PathRequestPriority,
  type PathRequestResult,
} from "./path-request-queue";
import { DeterministicSpatialIndex } from "./spatial-index";
import { VisibilityGrid, type VisibilitySource } from "./visibility";
import type {
  AiDifficulty,
  AiPhase,
  AiSnapshot,
  AureliteFieldSnapshot,
  BuildingKind,
  GridPoint,
  OnboardingSnapshot,
  OrderKind,
  PathingState,
  PlacementFailure,
  PlayerId,
  PlayerSnapshot,
  ProductionItemSnapshot,
  ProjectileSnapshot,
  SimCommand,
  SimulationScenario,
  SimulationSnapshot,
  SolarSpearFailure,
  SolarSpearSnapshot,
  StructureId,
  StructureSnapshot,
  UnitId,
  UnitKind,
  Vec2,
} from "./types";

export const TICKS_PER_SECOND = 20;
export const SIM_STEP_MS = 1_000 / TICKS_PER_SECOND;
export const DEFAULT_COMBAT_SEED = 0xa11e_1a;
export const PATH_EXPANSIONS_PER_TICK = 4_096;
export const SIMULATION_SYSTEMS = [
  "commands",
  "pathfinding",
  "construction",
  "connectivity",
  "solarSpear",
  "repairs",
  "production",
  "fields",
  "unitOrders",
  "turrets",
  "movement",
  "separation",
  "projectiles",
  "cleanup",
  "visibility",
  "aiMemory",
  "matchResolution",
  "ai",
] as const;

export type SimulationSystem = (typeof SIMULATION_SYSTEMS)[number];

export type SimulationStepObserver = {
  begin(system: SimulationSystem, tick: number): void;
  end(system: SimulationSystem, tick: number): void;
};

const ZERO_SEED_RNG_STATE = 0x6d2b_79f5;
const SEPARATION_MILLI = 420;
const SEPARATION_STEP = 24;
const CHASE_REPATH_TICKS = 8;
const REGEN_DENOMINATOR = TICKS_PER_SECOND * 60;
const MAX_BUILD_RADIUS_MILLI =
  Math.max(
    ...Object.values(gameData.buildings).map(
      (definition) => definition.buildRadius,
    ),
  ) * TILE_MILLI;

const insertInIdOrder = <Entity extends { id: number }>(
  entities: readonly Entity[],
  entity: Entity,
) => {
  let low = 0;
  let high = entities.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (entities[middle].id < entity.id) low = middle + 1;
    else high = middle;
  }
  const ordered = entities.slice();
  ordered.splice(low, 0, entity);
  return ordered;
};

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
  aiScout: boolean;
  cargo: number;
  harvestFieldId: number | null;
};

type UnitPathRequest = Readonly<{
  kind: "unit";
  unitId: UnitId;
  destination: GridPoint;
}>;

type FormationPathRequest = Readonly<{
  kind: "formation";
  unitIds: readonly UnitId[];
  starts: readonly Readonly<{ unitId: UnitId; tile: GridPoint }>[];
  anchorStart: GridPoint;
  anchorTarget: GridPoint;
  mode: "move" | "attackMove";
  occupied: readonly number[];
  priority: PathRequestPriority;
}>;

type SimulationPathRequest = UnitPathRequest | FormationPathRequest;

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

type SolarSpearStateData = {
  chargeTicks: number;
  target: GridPoint | null;
  impactTick: number | null;
  lastImpact: { target: GridPoint; tick: number } | null;
  launches: number;
};

type OnboardingState = {
  -readonly [Key in keyof OnboardingSnapshot]: boolean;
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

type AiCommand =
  | Readonly<{
      kind: "placeBuilding";
      buildingKind: BuildingKind;
      tile: GridPoint;
    }>
  | Readonly<{
      kind: "queueUnit";
      structureId: StructureId;
      unitKind: UnitKind;
    }>
  | Readonly<{
      kind: "orderUnits";
      unitIds: readonly UnitId[];
      target: GridPoint;
      mode: "move" | "attackMove";
      scout?: boolean;
    }>
  | Readonly<{
      kind: "attackUnit";
      unitIds: readonly UnitId[];
      targetUnitId: UnitId;
    }>
  | Readonly<{
      kind: "attackStructure";
      unitIds: readonly UnitId[];
      targetStructureId: StructureId;
    }>
  | Readonly<{
      kind: "repair";
      structureId: StructureId;
    }>
  | Readonly<{
      kind: "launchSolarSpear";
      target: GridPoint;
    }>;

type EnemyMemory = {
  id: number;
  tile: GridPoint;
  lastSeenTick: number;
};

const createSolarSpearState = (): SolarSpearStateData => ({
  chargeTicks: 0,
  target: null,
  impactTick: null,
  lastImpact: null,
  launches: 0,
});

const createOnboardingState = (): OnboardingState => ({
  selection: false,
  reactor: false,
  refinery: false,
  barracks: false,
  production: false,
  controlGroup: false,
  attackMove: false,
  operationsCenter: false,
  solarSpear: false,
});

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
    const normalizedSeed = seed >>> 0;
    this.state =
      normalizedSeed === 0 ? ZERO_SEED_RNG_STATE : normalizedSeed;
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

  authoritativeState() {
    return this.state;
  }
}

export class Simulation {
  private tick = 0;
  private seed: number;
  private rng: DeterministicRng;
  private readonly commands: SimCommand[] = [];
  private readonly aiCommands: AiCommand[] = [];
  private scenario: SimulationScenario;
  private controlledPlayer: PlayerId = 1;
  private units: UnitState[] = [];
  private structures: StructureState[] = [];
  private orderedUnits: readonly UnitState[] = [];
  private orderedStructures: readonly StructureState[] = [];
  private readonly unitsById = new Map<UnitId, UnitState>();
  private readonly structuresById = new Map<StructureId, StructureState>();
  private readonly unitSpatialIndex =
    new DeterministicSpatialIndex<UnitId>(TILE_MILLI);
  private readonly unitTileSpatialIndex =
    new DeterministicSpatialIndex<UnitId>(TILE_MILLI);
  private readonly structureSpatialIndex =
    new DeterministicSpatialIndex<StructureId>(TILE_MILLI);
  private fields: FieldState[] = [];
  private readonly fieldsById = new Map<number, FieldState>();
  private readonly fieldSpatialIndex =
    new DeterministicSpatialIndex<number>(TILE_MILLI);
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
  private lastSolarFailure: SolarSpearFailure | null = null;
  private visibility!: Record<PlayerId, VisibilityGrid>;
  private solarSpears: Record<PlayerId, SolarSpearStateData> = {
    1: createSolarSpearState(),
    2: createSolarSpearState(),
  };
  private onboarding = createOnboardingState();
  private readonly onboardingConstructionIds = new Set<StructureId>();
  private aiPhase: AiPhase = "build";
  private aiLastDecisionTick = -1;
  private aiLastActionTick = -1;
  private aiLastScoutTick = -1;
  private aiLastAttackTick = -1;
  private aiScoutWaypointIndex = 0;
  private aiUnitMixIndex = 0;
  private readonly aiKnownUnits = new Map<UnitId, EnemyMemory>();
  private readonly aiKnownStructures = new Map<StructureId, EnemyMemory>();
  private aiDifficulty: AiDifficulty;
  private readonly pathRequests = new DeterministicPathRequestQueue();
  private readonly pendingPathRequests =
    new Map<string, SimulationPathRequest>();
  private readonly unitPendingPathRequests = new Map<UnitId, string>();
  private readonly unitPathingOverrides = new Map<UnitId, PathingState>();
  private nextPathRequestId = 1;
  private lastPathExpansions = 0;

  constructor(
    seed = DEFAULT_COMBAT_SEED,
    scenario: SimulationScenario = "combat",
    difficulty: AiDifficulty = "normal",
  ) {
    this.seed = seed >>> 0;
    this.rng = new DeterministicRng(this.seed);
    this.scenario = scenario;
    this.aiDifficulty = difficulty;
    if (scenario === "combat") this.resetCombat(this.seed);
    else if (scenario === "skirmish") this.resetSkirmish(this.seed);
    else this.resetEconomy(this.seed);
  }

  enqueue(command: SimCommand) {
    this.commands.push(command);
  }

  authoritativeState() {
    return structuredClone({
      schemaVersion: 1,
      tick: this.tick,
      seed: this.seed,
      rng: this.rng.authoritativeState(),
      commands: this.commands,
      aiCommands: this.aiCommands,
      scenario: this.scenario,
      controlledPlayer: this.controlledPlayer,
      units: this.units,
      structures: this.structures,
      fields: this.fields,
      players: this.players,
      projectiles: this.projectiles,
      nextUnitId: this.nextUnitId,
      nextStructureId: this.nextStructureId,
      nextProjectileId: this.nextProjectileId,
      controlGroups: [...this.controlGroups],
      rallies: [...this.rallies],
      kills: this.kills,
      status: this.status,
      winner: this.winner,
      lastPlacementFailure: this.lastPlacementFailure,
      lastSolarFailure: this.lastSolarFailure,
      visibility: {
        1: this.visibility[1].authoritativeState(),
        2: this.visibility[2].authoritativeState(),
      },
      solarSpears: this.solarSpears,
      onboarding: this.onboarding,
      onboardingConstructionIds: [...this.onboardingConstructionIds],
      aiPhase: this.aiPhase,
      aiLastDecisionTick: this.aiLastDecisionTick,
      aiLastActionTick: this.aiLastActionTick,
      aiLastScoutTick: this.aiLastScoutTick,
      aiLastAttackTick: this.aiLastAttackTick,
      aiScoutWaypointIndex: this.aiScoutWaypointIndex,
      aiUnitMixIndex: this.aiUnitMixIndex,
      aiKnownUnits: [...this.aiKnownUnits],
      aiKnownStructures: [...this.aiKnownStructures],
      aiDifficulty: this.aiDifficulty,
      ...(this.pathRequests.size > 0
        ? {
            pathPlanning: {
              queue: this.pathRequests.authoritativeState(),
              pending: [...this.pendingPathRequests].sort(
                ([left], [right]) =>
                  left < right ? -1 : left > right ? 1 : 0,
              ),
              units: [...this.unitPendingPathRequests].sort(
                ([left], [right]) => left - right,
              ),
            },
          }
        : {}),
    });
  }

  step(observer?: SimulationStepObserver) {
    const commandTick = this.tick;
    observer?.begin("commands", commandTick);
    for (const command of this.commands.splice(0)) {
      this.applyCommand(command);
    }
    for (const command of this.aiCommands.splice(0)) {
      this.applyAiCommand(command);
    }
    observer?.end("commands", commandTick);
    if (this.status !== "active") {
      this.tick += 1;
      return;
    }

    const observedTick = this.tick;
    this.lastPathExpansions = 0;
    observer?.begin("pathfinding", observedTick);
    this.processPathRequests(PATH_EXPANSIONS_PER_TICK);
    observer?.end("pathfinding", observedTick);
    if (this.scenario !== "combat") {
      observer?.begin("construction", observedTick);
      this.updateConstruction();
      observer?.end("construction", observedTick);
      observer?.begin("connectivity", observedTick);
      this.updateConnectivityAndPower();
      observer?.end("connectivity", observedTick);
      observer?.begin("solarSpear", observedTick);
      const solarSpearDestroyedEntities = this.updateSolarSpears();
      observer?.end("solarSpear", observedTick);
      if (solarSpearDestroyedEntities) {
        observer?.begin("cleanup", observedTick);
        this.removeDestroyedEntities();
        observer?.end("cleanup", observedTick);
      }
      observer?.begin("repairs", observedTick);
      this.updateRepairs();
      observer?.end("repairs", observedTick);
      observer?.begin("production", observedTick);
      this.updateProduction();
      observer?.end("production", observedTick);
      observer?.begin("fields", observedTick);
      this.updateFields();
      observer?.end("fields", observedTick);
    }

    observer?.begin("unitOrders", observedTick);
    for (const unit of this.sortedUnits()) {
      if (unit.cooldownTicks > 0) unit.cooldownTicks -= 1;
      if (this.scenario !== "combat" && unit.kind === "midasHarvester") {
        this.updateHarvester(unit);
      } else {
        this.updateCombatOrder(unit);
      }
    }
    observer?.end("unitOrders", observedTick);
    observer?.begin("pathfinding", observedTick);
    this.processPathRequests(
      PATH_EXPANSIONS_PER_TICK - this.lastPathExpansions,
    );
    observer?.end("pathfinding", observedTick);
    if (this.scenario !== "combat") {
      observer?.begin("turrets", observedTick);
      this.updateTurrets();
      observer?.end("turrets", observedTick);
    }
    observer?.begin("movement", observedTick);
    for (const unit of this.sortedUnits()) this.moveUnit(unit);
    observer?.end("movement", observedTick);
    observer?.begin("separation", observedTick);
    this.applyLocalSeparation();
    observer?.end("separation", observedTick);
    observer?.begin("projectiles", observedTick);
    this.updateProjectiles();
    observer?.end("projectiles", observedTick);
    observer?.begin("cleanup", observedTick);
    this.removeDestroyedEntities();
    observer?.end("cleanup", observedTick);
    observer?.begin("visibility", observedTick);
    this.updateVisibility();
    observer?.end("visibility", observedTick);
    if (this.scenario === "skirmish") {
      observer?.begin("aiMemory", observedTick);
      this.updateAiMemory();
      observer?.end("aiMemory", observedTick);
    }
    observer?.begin("matchResolution", observedTick);
    this.resolveMatch();
    observer?.end("matchResolution", observedTick);
    if (this.status === "active" && this.scenario === "skirmish") {
      observer?.begin("ai", observedTick);
      this.updateAi();
      observer?.end("ai", observedTick);
    }
    this.tick += 1;
  }

  snapshot(): SimulationSnapshot {
    const units = this.sortedUnits()
      .filter((unit) => this.isUnitVisibleTo(this.controlledPlayer, unit))
      .map((unit) => {
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
        pathingState: this.pathingStateOf(unit),
        path: Object.freeze(
          unit.path
            .slice(unit.pathIndex)
            .map((point) => Object.freeze({ ...point })),
        ),
        health: unit.health,
        maxHealth: definition.maxHealth,
        weaponId: definition.weaponId,
        targetId:
          unit.targetId !== null &&
          this.isUnitVisibleTo(
            this.controlledPlayer,
            this.unitById(unit.targetId),
          )
            ? unit.targetId
            : null,
        targetStructureId:
          unit.targetStructureId !== null &&
          this.isStructureVisibleTo(
            this.controlledPlayer,
            this.structureById(unit.targetStructureId),
          )
            ? unit.targetStructureId
            : null,
        cooldownTicks: unit.cooldownTicks,
        cargo: unit.cargo,
        cargoCapacity: definition.cargoCapacity,
      });
    });
    const structures: readonly StructureSnapshot[] = Object.freeze(
      this.sortedStructures()
        .filter((structure) =>
          this.isStructureVisibleTo(this.controlledPlayer, structure),
        )
        .map((structure) => {
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
        .filter(
          (field) =>
            this.scenario !== "skirmish" ||
            this.visibility[this.controlledPlayer].isVisible(field.tile),
        )
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
        .filter(
          (projectile) =>
            projectile.playerId === this.controlledPlayer ||
            this.scenario !== "skirmish" ||
            this.visibility[this.controlledPlayer].isVisible(
              toTile(projectile.position),
            ),
        )
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
      lastSolarFailure: this.lastSolarFailure,
      visibility: this.visibility[this.controlledPlayer].snapshot(),
      ai: this.aiSnapshot(),
      solarSpears: Object.freeze({
        1: this.solarSpearSnapshot(1),
        2: this.solarSpearSnapshot(2),
      }),
      pathfinding: Object.freeze({
        expansionBudget: PATH_EXPANSIONS_PER_TICK,
        expansions: this.lastPathExpansions,
        pendingRequests: this.pathRequests.size,
      }),
      onboarding: Object.freeze({ ...this.onboarding }),
    });
  }

  private solarSpearSnapshot(playerId: PlayerId): SolarSpearSnapshot {
    const solar = this.solarSpears[playerId];
    const warning = solar.impactTick !== null;
    const oracle = this.operationalOracle(playerId);
    const hiddenEnemy = playerId !== this.controlledPlayer && !warning;
    const state = hiddenEnemy
      ? "unknown"
      : warning
        ? "warning"
        : !oracle
          ? "unavailable"
          : solar.chargeTicks >= gameData.solarSpear.chargeTicks
            ? "ready"
            : "charging";
    return Object.freeze({
      playerId,
      state,
      chargeTicks: hiddenEnemy ? 0 : solar.chargeTicks,
      chargeTotalTicks: gameData.solarSpear.chargeTicks,
      target: solar.target ? Object.freeze({ ...solar.target }) : null,
      impactTick: solar.impactTick,
      lastImpact: solar.lastImpact
        ? Object.freeze({
            target: Object.freeze({ ...solar.lastImpact.target }),
            tick: solar.lastImpact.tick,
          })
        : null,
      launches: hiddenEnemy ? 0 : solar.launches,
    });
  }

  private aiSnapshot(): AiSnapshot {
    return Object.freeze({
      enabled: this.scenario === "skirmish",
      playerId: 2,
      profile: this.aiDifficulty,
      phase: this.aiPhase,
      lastDecisionTick: this.aiLastDecisionTick,
      knownEnemyUnits: this.aiKnownUnits.size,
      knownEnemyStructures: this.aiKnownStructures.size,
      cheats: false,
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

  private isUnitVisibleTo(
    playerId: PlayerId,
    unit: UnitState | undefined,
  ) {
    if (!unit) return false;
    return (
      this.scenario !== "skirmish" ||
      unit.playerId === playerId ||
      this.visibility[playerId].isVisible(toTile(unit.position))
    );
  }

  private isStructureVisibleTo(
    playerId: PlayerId,
    structure: StructureState | undefined,
  ) {
    if (!structure) return false;
    return (
      this.scenario !== "skirmish" ||
      structure.playerId === playerId ||
      this.visibility[playerId].isVisible(structure.tile)
    );
  }

  private visibilitySources(playerId: PlayerId): VisibilitySource[] {
    return [
      ...this.sortedUnits()
        .filter((unit) => unit.playerId === playerId && unit.health > 0)
        .map((unit) => ({
          id: unit.id,
          kind: "unit" as const,
          tile: toTile(unit.position),
          visionMilli: gameData.units[unit.kind].visionMilli,
        })),
      ...this.sortedStructures()
        .filter(
          (structure) =>
            structure.playerId === playerId &&
            structure.health > 0 &&
            structure.constructionRemainingTicks === 0,
        )
        .map((structure) => ({
          id: structure.id,
          kind: "structure" as const,
          tile: { ...structure.tile },
          visionMilli: gameData.buildings[structure.kind].visionMilli,
        })),
    ];
  }

  private updateVisibility(force = false) {
    for (const playerId of [1, 2] as const) {
      this.visibility[playerId].update(
        this.visibilitySources(playerId),
        force,
      );
    }
  }

  private resetShared(seed: number, scenario: SimulationScenario) {
    this.tick = 0;
    this.seed = seed >>> 0;
    this.rng = new DeterministicRng(this.seed);
    this.scenario = scenario;
    this.controlledPlayer = 1;
    this.units = [];
    this.structures = [];
    this.orderedUnits = [];
    this.orderedStructures = [];
    this.unitsById.clear();
    this.structuresById.clear();
    this.unitSpatialIndex.clear();
    this.unitTileSpatialIndex.clear();
    this.structureSpatialIndex.clear();
    this.fields = [];
    this.fieldsById.clear();
    this.fieldSpatialIndex.clear();
    this.players = {
      1: { id: 1, credits: 0, powerGenerated: 0, powerConsumed: 0 },
      2: { id: 2, credits: 0, powerGenerated: 0, powerConsumed: 0 },
    };
    this.projectiles = [];
    this.aiCommands.length = 0;
    this.nextUnitId = 100;
    this.nextStructureId = 100;
    this.nextProjectileId = 1;
    this.controlGroups.clear();
    this.rallies.clear();
    this.kills = { 1: 0, 2: 0 };
    this.status = "active";
    this.winner = null;
    this.lastPlacementFailure = null;
    this.lastSolarFailure = null;
    this.visibility = {
      1: new VisibilityGrid(scenario === "skirmish"),
      2: new VisibilityGrid(scenario === "skirmish"),
    };
    this.solarSpears = {
      1: createSolarSpearState(),
      2: createSolarSpearState(),
    };
    this.onboarding = createOnboardingState();
    this.onboardingConstructionIds.clear();
    this.aiPhase = "build";
    this.aiLastDecisionTick = -1;
    this.aiLastActionTick = -1;
    this.aiLastScoutTick = -1;
    this.aiLastAttackTick = -1;
    this.aiScoutWaypointIndex = 0;
    this.aiUnitMixIndex = 0;
    this.aiKnownUnits.clear();
    this.aiKnownStructures.clear();
    this.pathRequests.clear();
    this.pendingPathRequests.clear();
    this.unitPendingPathRequests.clear();
    this.unitPathingOverrides.clear();
    this.nextPathRequestId = 1;
    this.lastPathExpansions = 0;
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
    this.rebuildEntityIndexes();
    this.nextUnitId = 13;
    for (const unit of this.units.filter((unit) => unit.playerId === 2)) {
      unit.order = "attackMove";
      unit.attackMoveDestination = { x: 21, y: 31 };
    }
    this.issueSideMove(2, { x: 21, y: 31 }, "attackMove");
    this.updateVisibility(true);
  }

  private resetEconomy(seed: number) {
    this.resetEconomyState(seed, "economy");
  }

  private resetSkirmish(seed: number) {
    this.resetEconomyState(seed, "skirmish");
  }

  private resetEconomyState(
    seed: number,
    scenario: "economy" | "skirmish",
  ) {
    this.resetShared(seed, scenario);
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
    this.rebuildEntityIndexes();
    this.nextUnitId = 3;
    this.nextStructureId = 7;
    this.updateConnectivityAndPower();
    this.updateVisibility(true);
    if (scenario === "skirmish") this.updateAiMemory();
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
      aiScout: false,
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
    if (command.kind === "restartSkirmish") {
      this.aiDifficulty = command.difficulty ?? this.aiDifficulty;
      this.resetSkirmish(command.seed ?? this.seed);
      this.commands.length = 0;
      return;
    }
    if (this.status !== "active") return;

    if (command.kind === "surrender") {
      this.clearAllOrders();
      this.winner = this.controlledPlayer === 1 ? 2 : 1;
      this.status = this.controlledPlayer === 1 ? "defeat" : "victory";
      return;
    }
    if (command.kind === "launchSolarSpear") {
      this.launchSolarSpear(this.controlledPlayer, command.target);
      return;
    }
    if (command.kind === "switchPlayer") {
      if (this.scenario === "skirmish") return;
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
          this.scenario !== "combat" &&
          unit.playerId !== this.controlledPlayer
        ) {
          continue;
        }
        unit.selected = command.additive
          ? unit.selected || requested.has(unit.id)
          : requested.has(unit.id);
      }
      this.onboarding.selection ||=
        this.selectedUnits().length > 0;
      return;
    }
    if (command.kind === "selectStructures") {
      const requested = new Set(command.structureIds);
      if (!command.additive) this.clearSelections();
      for (const structure of this.structures) {
        if (
          this.scenario !== "combat" &&
          structure.playerId !== this.controlledPlayer
        ) {
          continue;
        }
        structure.selected = command.additive
          ? structure.selected || requested.has(structure.id)
          : requested.has(structure.id);
      }
      this.onboarding.selection ||=
        this.structures.some(
          (structure) =>
            structure.selected &&
            structure.playerId === this.controlledPlayer,
        );
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
      this.queueUnit(
        this.controlledPlayer,
        command.structureId,
        command.unitKind,
      );
      return;
    }
    if (command.kind === "cancelProduction") {
      this.cancelProduction(command.structureId, command.queueIndex);
      return;
    }
    if (command.kind === "sellStructure") {
      this.sellStructure(command.structureId);
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
      const selected = this.selectedUnits().map((unit) => unit.id);
      this.controlGroups.set(command.group, selected);
      this.onboarding.controlGroup ||= selected.length > 0;
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
        unit.aiScout = false;
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
      if (
        !target ||
        target.playerId === this.controlledPlayer ||
        !this.isUnitVisibleTo(this.controlledPlayer, target)
      ) {
        return;
      }
      for (const unit of this.selectedUnits()) {
        unit.targetId = target.id;
        unit.targetStructureId = null;
        unit.forcedTarget = true;
        unit.attackMoveDestination = null;
        unit.order = "attack";
        this.planChase(unit, target.position, "direct");
      }
      return;
    }
    if (command.kind === "attackStructure") {
      const target = this.structureById(command.targetStructureId);
      if (
        !target ||
        target.playerId === this.controlledPlayer ||
        !this.isStructureVisibleTo(this.controlledPlayer, target)
      ) {
        return;
      }
      for (const unit of this.selectedUnits()) {
        unit.targetId = null;
        unit.targetStructureId = target.id;
        unit.forcedTarget = true;
        unit.attackMoveDestination = null;
        unit.order = "attack";
        this.planChase(unit, tileCenter(target.tile), "direct");
      }
      return;
    }
    if (command.kind === "move") {
      this.onboarding.attackMove ||=
        command.mode === "attackMove" && this.selectedUnits().length > 0;
      this.issueFormationMove(command.target, command.mode);
    }
  }

  private applyAiCommand(command: AiCommand) {
    if (this.scenario !== "skirmish" || this.status !== "active") return;
    if (command.kind === "placeBuilding") {
      this.placeBuilding(2, command.buildingKind, command.tile, false);
      return;
    }
    if (command.kind === "queueUnit") {
      this.queueUnit(2, command.structureId, command.unitKind);
      return;
    }
    if (command.kind === "repair") {
      const structure = this.structureById(command.structureId);
      if (
        structure?.playerId === 2 &&
        structure.constructionRemainingTicks === 0
      ) {
        structure.repairing = true;
      }
      return;
    }
    if (command.kind === "launchSolarSpear") {
      this.launchSolarSpear(2, command.target, false);
      return;
    }
    const units = command.unitIds
      .map((unitId) => this.unitById(unitId))
      .filter(
        (unit): unit is UnitState =>
          unit?.playerId === 2 && unit.health > 0,
      )
      .sort((left, right) => left.id - right.id);
    if (units.length === 0) return;
    if (command.kind === "orderUnits") {
      this.issueFormationMoveFor(
        units,
        command.target,
        command.mode,
        "ai",
      );
      for (const unit of units) unit.aiScout = command.scout === true;
      return;
    }
    if (command.kind === "attackUnit") {
      const target = this.unitById(command.targetUnitId);
      if (!this.isUnitVisibleTo(2, target) || target?.playerId !== 1) return;
      for (const unit of units) {
        unit.targetId = target.id;
        unit.targetStructureId = null;
        unit.forcedTarget = true;
        unit.aiScout = false;
        unit.attackMoveDestination = null;
        unit.order = "attack";
        this.planChase(unit, target.position, "ai");
      }
      return;
    }
    const target = this.structureById(command.targetStructureId);
    if (!this.isStructureVisibleTo(2, target) || target?.playerId !== 1) {
      return;
    }
    for (const unit of units) {
      unit.targetId = null;
      unit.targetStructureId = target.id;
      unit.forcedTarget = true;
      unit.aiScout = false;
      unit.attackMoveDestination = null;
      unit.order = "attack";
      this.planChase(unit, tileCenter(target.tile), "ai");
    }
  }

  private updateAiMemory() {
    for (const unit of this.sortedUnits()) {
      if (unit.playerId !== 1 || !this.isUnitVisibleTo(2, unit)) continue;
      this.aiKnownUnits.set(unit.id, {
        id: unit.id,
        tile: toTile(unit.position),
        lastSeenTick: this.tick,
      });
    }
    for (const structure of this.sortedStructures()) {
      if (
        structure.playerId !== 1 ||
        !this.isStructureVisibleTo(2, structure)
      ) {
        continue;
      }
      this.aiKnownStructures.set(structure.id, {
        id: structure.id,
        tile: { ...structure.tile },
        lastSeenTick: this.tick,
      });
    }
    for (const [id, memory] of this.aiKnownUnits) {
      const visibleUnit = this.unitById(id);
      if (visibleUnit && this.isUnitVisibleTo(2, visibleUnit)) continue;
      if (this.visibility[2].isVisible(memory.tile)) {
        this.aiKnownUnits.delete(id);
      }
    }
    for (const [id, memory] of this.aiKnownStructures) {
      const visibleStructure = this.structureById(id);
      if (
        visibleStructure &&
        this.isStructureVisibleTo(2, visibleStructure)
      ) {
        continue;
      }
      if (this.visibility[2].isVisible(memory.tile)) {
        this.aiKnownStructures.delete(id);
      }
    }
  }

  private updateAi() {
    const profile = gameData.ai[this.aiDifficulty];
    if (this.tick % profile.reactionIntervalTicks !== 0) return;
    if (
      this.aiLastActionTick >= 0 &&
      this.tick - this.aiLastActionTick < profile.actionRateLimitTicks
    ) {
      return;
    }
    this.aiLastDecisionTick = this.tick;
    this.aiLastActionTick = this.tick;

    const ownStructures = this.sortedStructures().filter(
      (structure) => structure.playerId === 2 && structure.health > 0,
    );
    const combatUnits = this.sortedUnits().filter(
      (unit) =>
        unit.playerId === 2 &&
        unit.kind !== "midasHarvester" &&
        unit.health > 0,
    );
    const visibleThreats = this.sortedUnits()
      .filter(
        (unit) =>
          unit.playerId === 1 &&
          this.isUnitVisibleTo(2, unit) &&
          ownStructures.some(
            (structure) =>
              distanceSquared(unit.position, tileCenter(structure.tile)) <=
              profile.defenseRadiusMilli * profile.defenseRadiusMilli,
          ),
      )
      .sort((left, right) => left.id - right.id);
    const attackForce = this.aiAttackForce(combatUnits, profile);
    const currentHealthBasisPoints =
      combatUnits.length === 0
        ? 10_000
        : Math.floor(
            combatUnits.reduce(
              (total, unit) =>
                total +
                Math.floor(
                  (unit.health * 10_000) /
                    gameData.units[unit.kind].maxHealth,
                ),
              0,
            ) /
              combatUnits.length,
          );
    const homeCitadel = ownStructures.find(
      (structure) => structure.kind === "citadel",
    );

    if (
      this.aiPhase === "attack" &&
      homeCitadel &&
      currentHealthBasisPoints < profile.retreatHealthBasisPoints
    ) {
      this.aiPhase = "defend";
      this.aiCommands.push({
        kind: "orderUnits",
        unitIds: combatUnits.map((unit) => unit.id),
        target: { ...homeCitadel.tile },
        mode: "move",
      });
      return;
    }

    if (
      this.tick >= profile.solarLaunchStartTick &&
      this.solarSpearReady(2)
    ) {
      const visibleStructure = this.sortedStructures()
        .filter(
          (structure) =>
            structure.playerId === 1 &&
            this.isStructureVisibleTo(2, structure),
        )
        .sort(
          (left, right) =>
            Number(right.kind === "citadel") -
              Number(left.kind === "citadel") ||
            left.id - right.id,
        )[0];
      const visibleUnit = this.sortedUnits().find(
        (unit) => unit.playerId === 1 && this.isUnitVisibleTo(2, unit),
      );
      const solarTarget = visibleStructure
        ? { ...visibleStructure.tile }
        : visibleUnit
          ? toTile(visibleUnit.position)
          : null;
      if (solarTarget) {
        this.aiPhase = "attack";
        this.aiCommands.push({
          kind: "launchSolarSpear",
          target: solarTarget,
        });
        return;
      }
    }

    const damaged = ownStructures.find(
      (structure) =>
        structure.constructionRemainingTicks === 0 &&
        structure.health < gameData.buildings[structure.kind].maxHealth &&
        !structure.repairing &&
        this.players[2].credits > 500,
    );
    if (damaged) {
      this.aiCommands.push({ kind: "repair", structureId: damaged.id });
    }

    if (visibleThreats.length > 0 && combatUnits.length > 0) {
      this.aiPhase = "defend";
      this.aiCommands.push({
        kind: "attackUnit",
        unitIds: combatUnits.map((unit) => unit.id),
        targetUnitId: visibleThreats[0].id,
      });
      return;
    }

    const buildStep = profile.buildOrder.find(
      (step) =>
        ownStructures.filter((structure) => structure.kind === step.kind)
          .length < step.count,
    );
    if (buildStep) {
      const tile = this.findAiPlacement(buildStep.kind);
      if (tile) {
        this.aiPhase = "build";
        this.aiCommands.push({
          kind: "placeBuilding",
          buildingKind: buildStep.kind,
          tile,
        });
        return;
      }
    }

    const refineries = ownStructures.filter(
      (structure) => structure.kind === "refinery",
    );
    const exploredField = this.fields
      .filter(
        (field) =>
          field.contested && this.visibility[2].isExplored(field.tile),
      )
      .sort((left, right) => left.id - right.id)[0];
    const expansionNeeded =
      this.tick >= profile.expansionStartTick &&
      refineries.length < 2 &&
      exploredField !== undefined;
    if (expansionNeeded) {
      const tile = this.findAiPlacement("refinery", exploredField.tile);
      if (tile) {
        this.aiPhase = "expand";
        this.aiCommands.push({
          kind: "placeBuilding",
          buildingKind: "refinery",
          tile,
        });
      }
      this.aiPhase = "expand";
      return;
    }

    if (!buildStep) this.queueAiProduction();

    if (
      this.tick >= profile.attackStartTick &&
      combatUnits.length >= profile.attackUnitThreshold &&
      this.tick - this.aiLastAttackTick >= profile.attackIntervalTicks
    ) {
      const visibleUnit = this.sortedUnits().find(
        (unit) => unit.playerId === 1 && this.isUnitVisibleTo(2, unit),
      );
      const visibleStructure = this.sortedStructures().find(
        (structure) =>
          structure.playerId === 1 &&
          this.isStructureVisibleTo(2, structure),
      );
      if (visibleStructure) {
        this.aiPhase = "attack";
        this.aiLastAttackTick = this.tick;
        this.aiCommands.push({
          kind: "attackStructure",
          unitIds: attackForce.map((unit) => unit.id),
          targetStructureId: visibleStructure.id,
        });
        return;
      }
      if (visibleUnit) {
        this.aiPhase = "attack";
        this.aiLastAttackTick = this.tick;
        this.aiCommands.push({
          kind: "attackUnit",
          unitIds: attackForce.map((unit) => unit.id),
          targetUnitId: visibleUnit.id,
        });
        return;
      }
      const rememberedTarget =
        [...this.aiKnownStructures.values()].sort(
          (left, right) =>
            right.lastSeenTick - left.lastSeenTick || left.id - right.id,
        )[0] ??
        [...this.aiKnownUnits.values()].sort(
          (left, right) =>
            right.lastSeenTick - left.lastSeenTick || left.id - right.id,
        )[0];
      if (rememberedTarget) {
        this.aiPhase = "attack";
        this.aiLastAttackTick = this.tick;
        this.aiCommands.push({
          kind: "orderUnits",
          unitIds: attackForce.map((unit) => unit.id),
          target: { ...rememberedTarget.tile },
          mode: "attackMove",
        });
        return;
      }
    }

    if (
      combatUnits.length > 0 &&
      this.tick - this.aiLastScoutTick >= profile.scoutIntervalTicks
    ) {
      const scout =
        combatUnits.find((unit) => unit.kind === "hermesScout") ??
        combatUnits.find((unit) => unit.kind === "argusRifle") ??
        combatUnits[0];
      const waypoint =
        profile.scoutWaypoints[
          this.aiScoutWaypointIndex % profile.scoutWaypoints.length
        ];
      this.aiScoutWaypointIndex += 1;
      this.aiLastScoutTick = this.tick;
      this.aiPhase = "scout";
      this.aiCommands.push({
        kind: "orderUnits",
        unitIds: [scout.id],
        target: { ...waypoint },
        mode: "move",
        scout: true,
      });
    }
  }

  private queueAiProduction() {
    const profile = gameData.ai[this.aiDifficulty];
    for (const structure of this.sortedStructures()) {
      if (
        structure.playerId !== 2 ||
        structure.constructionRemainingTicks > 0 ||
        !structure.powered ||
        structure.queue.length >= profile.productionQueueTarget
      ) {
        continue;
      }
      for (let offset = 0; offset < profile.unitMix.length; offset += 1) {
        const index = (this.aiUnitMixIndex + offset) % profile.unitMix.length;
        const unitKind = profile.unitMix[index];
        const definition = gameData.units[unitKind];
        if (
          definition.producedAt !== structure.kind ||
          definition.prerequisites.some(
            (required) => !this.hasCompletedStructure(2, required),
          ) ||
          this.players[2].credits < definition.cost
        ) {
          continue;
        }
        this.aiUnitMixIndex = (index + 1) % profile.unitMix.length;
        this.aiCommands.push({
          kind: "queueUnit",
          structureId: structure.id,
          unitKind,
        });
        break;
      }
    }
  }

  private aiAttackForce(
    combatUnits: readonly UnitState[],
    profile: AiProfile,
  ) {
    const desired = Math.max(
      profile.attackUnitThreshold,
      Math.floor(
        (combatUnits.length * profile.aggressionBasisPoints) / 10_000,
      ),
    );
    return combatUnits.slice(0, Math.min(combatUnits.length, desired));
  }

  private findAiPlacement(
    buildingKind: BuildingKind,
    preferred?: GridPoint,
  ) {
    const citadel = this.sortedStructures().find(
      (structure) =>
        structure.playerId === 2 &&
        structure.kind === "citadel" &&
        structure.health > 0,
    );
    const ownedCount = this.structures.filter(
      (structure) =>
        structure.playerId === 2 && structure.kind === buildingKind,
    ).length;
    const target =
      preferred ??
      (citadel
        ? {
            x: Math.max(0, citadel.tile.x - 4 - ownedCount * 2),
            y: Math.max(0, citadel.tile.y - 3 - ownedCount * 2),
          }
        : { x: MAP_SIZE - 1, y: MAP_SIZE - 1 });
    const candidates: GridPoint[] = [];
    for (let y = 0; y < MAP_SIZE; y += 1) {
      for (let x = 0; x < MAP_SIZE; x += 1) {
        const tile = { x, y };
        if (this.placementFailure(2, buildingKind, tile) === null) {
          candidates.push(tile);
        }
      }
    }
    return candidates.sort(
      (left, right) =>
        gridDistanceSquared(left, target) -
          gridDistanceSquared(right, target) ||
        tileKeyOf(left) - tileKeyOf(right),
    )[0];
  }

  private clearSelections() {
    for (const unit of this.units) unit.selected = false;
    for (const structure of this.structures) structure.selected = false;
  }

  private sortedUnits() {
    return this.orderedUnits;
  }

  private sortedStructures() {
    return this.orderedStructures;
  }

  private unitById(id: UnitId) {
    return this.unitsById.get(id);
  }

  private structureById(id: StructureId) {
    return this.structuresById.get(id);
  }

  private unitsWithin(position: Vec2, radius: number) {
    return this.unitSpatialIndex
      .query(position, radius)
      .map((id) => this.unitById(id))
      .filter((unit): unit is UnitState => unit !== undefined);
  }

  private structuresWithin(position: Vec2, radius: number) {
    return this.structureSpatialIndex
      .query(position, radius)
      .map((id) => this.structureById(id))
      .filter((structure): structure is StructureState => structure !== undefined);
  }

  private tileHasEntity(
    tile: GridPoint,
    observer?: PlayerId,
    excludedUnitIds = new Set<UnitId>(),
  ) {
    const tileKey = tileKeyOf(tile);
    const occupiedByUnit = this.unitTileSpatialIndex
      .query(tileCenter(tile), 0)
      .map((id) => this.unitById(id))
      .some(
        (unit) =>
          unit !== undefined &&
          !excludedUnitIds.has(unit.id) &&
          tileKeyOf(toTile(unit.position)) === tileKey &&
          (!observer ||
            this.scenario !== "skirmish" ||
            unit.playerId === observer ||
            this.isUnitVisibleTo(observer, unit)),
      );
    if (occupiedByUnit) return true;
    return this.structuresWithin(tileCenter(tile), 0).some(
      (structure) => tileKeyOf(structure.tile) === tileKey,
    );
  }

  private rebuildEntityIndexes() {
    this.unitsById.clear();
    this.structuresById.clear();
    this.unitSpatialIndex.clear();
    this.unitTileSpatialIndex.clear();
    this.structureSpatialIndex.clear();
    this.fieldsById.clear();
    this.fieldSpatialIndex.clear();
    for (const unit of this.units) this.indexUnit(unit, false);
    for (const structure of this.structures) {
      this.indexStructure(structure, false);
    }
    for (const field of this.fields) this.indexField(field);
    this.orderedUnits = this.units.slice().sort((a, b) => a.id - b.id);
    this.orderedStructures = this.structures
      .slice()
      .sort((a, b) => a.id - b.id);
  }

  private indexUnit(unit: UnitState, maintainOrderedView = true) {
    this.unitsById.set(unit.id, unit);
    this.unitSpatialIndex.insert(unit.id, unit.position);
    this.unitTileSpatialIndex.insert(unit.id, tileCenter(toTile(unit.position)));
    if (maintainOrderedView) {
      this.orderedUnits = insertInIdOrder(this.orderedUnits, unit);
    }
  }

  private moveUnitIndexes(unit: UnitState) {
    this.unitSpatialIndex.move(unit.id, unit.position);
    this.unitTileSpatialIndex.move(unit.id, tileCenter(toTile(unit.position)));
  }

  private indexStructure(
    structure: StructureState,
    maintainOrderedView = true,
  ) {
    this.structuresById.set(structure.id, structure);
    this.structureSpatialIndex.insert(
      structure.id,
      tileCenter(structure.tile),
    );
    if (maintainOrderedView) {
      this.orderedStructures = insertInIdOrder(
        this.orderedStructures,
        structure,
      );
    }
  }

  private indexField(field: FieldState) {
    this.fieldsById.set(field.id, field);
    this.fieldSpatialIndex.insert(field.id, tileCenter(field.tile));
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
      "ai",
    );
  }

  private issueFormationMove(
    target: GridPoint,
    mode: "move" | "attackMove",
  ) {
    this.issueFormationMoveFor(this.selectedUnits(), target, mode, "direct");
  }

  private occupiedTiles(
    excludedUnitIds = new Set<number>(),
    observer?: PlayerId,
  ) {
    return new Set([
      ...this.units
        .filter(
          (unit) =>
            !excludedUnitIds.has(unit.id) &&
            (!observer ||
              this.scenario !== "skirmish" ||
              unit.playerId === observer ||
              this.isUnitVisibleTo(observer, unit)),
        )
        .map((unit) => tileKeyOf(toTile(unit.position))),
      ...this.structures.map((structure) => tileKeyOf(structure.tile)),
      ...this.fields.map((field) => tileKeyOf(field.tile)),
    ]);
  }

  private issueFormationMoveFor(
    selectedInput: readonly UnitState[],
    requestedTarget: GridPoint,
    mode: "move" | "attackMove",
    priority: PathRequestPriority,
  ) {
    const selected = selectedInput.slice().sort((a, b) => a.id - b.id);
    if (selected.length === 0) return;
    const selectedIds = new Set(selected.map((unit) => unit.id));
    const occupied = this.occupiedTiles(selectedIds, selected[0].playerId);
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
    if (!anchorTarget) {
      for (const unit of selected) {
        this.cancelPendingPathRequest(unit);
        this.unitPathingOverrides.set(unit.id, "blocked");
      }
      return;
    }

    const requestKey = `formation:${this.nextPathRequestId}`;
    this.nextPathRequestId += 1;
    for (const unit of selected) {
      this.cancelPendingPathRequest(unit);
      unit.path = [];
      unit.pathIndex = 0;
      unit.destination = null;
      unit.attackMoveDestination = null;
      unit.targetId = null;
      unit.targetStructureId = null;
      unit.harvestFieldId = null;
      unit.forcedTarget = false;
      unit.aiScout = false;
      unit.order = mode;
      this.unitPendingPathRequests.set(unit.id, requestKey);
      this.unitPathingOverrides.set(unit.id, "queued");
    }
    this.pendingPathRequests.set(requestKey, {
      kind: "formation",
      unitIds: selected.map((unit) => unit.id),
      starts: selected.map((unit) => ({
        unitId: unit.id,
        tile: toTile(unit.position),
      })),
      anchorStart,
      anchorTarget,
      mode,
      occupied: [...occupied].sort((left, right) => left - right),
      priority,
    });
    this.pathRequests.enqueue({
      key: requestKey,
      start: anchorStart,
      goal: anchorTarget,
      priority,
      options: { occupied },
    });
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
      unitTarget.health <= 0 ||
      !this.isUnitVisibleTo(unit.playerId, unitTarget)
    ) {
      unit.targetId = null;
      unitTarget = undefined;
    }
    if (
      !structureTarget ||
      structureTarget.playerId === unit.playerId ||
      structureTarget.health <= 0 ||
      !this.isStructureVisibleTo(unit.playerId, structureTarget)
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
        this.planPath(unit, unit.attackMoveDestination, "combat");
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
      else if (this.scenario !== "combat") {
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
      this.planPath(unit, unit.attackMoveDestination, "ai");
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
      this.planChase(unit, targetPosition, "combat");
    }
  }

  private acquireUnitTarget(unit: UnitState, acquisitionRange: number) {
    const rangeSquared = acquisitionRange * acquisitionRange;
    return this.unitSpatialIndex
      .query(unit.position, acquisitionRange)
      .map((id) => this.unitById(id))
      .filter(
        (candidate): candidate is UnitState =>
          candidate !== undefined &&
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
    return this.structureSpatialIndex
      .query(unit.position, acquisitionRange)
      .map((id) => this.structureById(id))
      .filter(
        (candidate): candidate is StructureState =>
          candidate !== undefined &&
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

  private planChase(
    unit: UnitState,
    position: Vec2,
    priority: PathRequestPriority,
  ) {
    const targetTile = toTile(position);
    const destination = this.nearestOpenAdjacentTile(targetTile, unit.id);
    if (destination) this.planPath(unit, destination, priority);
  }

  private planPath(
    unit: UnitState,
    requestedTarget: GridPoint,
    priority: PathRequestPriority,
    options: PathOptions & Readonly<{ start?: GridPoint }> = {},
  ) {
    const occupied =
      options.occupied ??
      this.occupiedTiles(new Set([unit.id]), unit.playerId);
    const destination = nearestWalkable(requestedTarget, {
      occupied,
      reserved: options.reserved,
    });
    if (!destination) {
      this.cancelPendingPathRequest(unit);
      this.unitPathingOverrides.set(unit.id, "blocked");
      return;
    }
    const currentRequestKey = this.unitPendingPathRequests.get(unit.id);
    const currentRequest = currentRequestKey
      ? this.pendingPathRequests.get(currentRequestKey)
      : undefined;
    if (
      currentRequest?.kind === "unit" &&
      currentRequest.destination.x === destination.x &&
      currentRequest.destination.y === destination.y
    ) {
      return;
    }

    const retrying = this.unitPathingOverrides.get(unit.id) === "blocked";
    this.cancelPendingPathRequest(unit);
    const requestKey = `unit:${unit.id}:${this.nextPathRequestId}`;
    this.nextPathRequestId += 1;
    this.pendingPathRequests.set(requestKey, {
      kind: "unit",
      unitId: unit.id,
      destination: { ...destination },
    });
    this.unitPendingPathRequests.set(unit.id, requestKey);
    this.unitPathingOverrides.set(
      unit.id,
      retrying ? "retrying" : "queued",
    );
    unit.destination = { ...destination };
    this.pathRequests.enqueue({
      key: requestKey,
      start: options.start ?? toTile(unit.position),
      goal: destination,
      priority,
      options: { occupied, reserved: options.reserved },
    });
  }

  private processPathRequests(expansionBudget: number) {
    let remaining = expansionBudget;
    while (this.pathRequests.size > 0) {
      for (const [unitId, requestKey] of this.unitPendingPathRequests) {
        const queueState = this.pathRequests.stateOf(requestKey);
        if (queueState === "planning") {
          this.unitPathingOverrides.set(unitId, "planning");
        }
      }

      const advanced = this.pathRequests.advance(remaining);
      this.lastPathExpansions += advanced.expansions;
      remaining -= advanced.expansions;
      for (const result of advanced.completed) {
        this.completePathRequest(result);
      }
      if (
        remaining === 0 ||
        (advanced.expansions === 0 && advanced.completed.length === 0)
      ) {
        break;
      }
    }
  }

  private completePathRequest(result: PathRequestResult) {
    const request = this.pendingPathRequests.get(result.key);
    this.pendingPathRequests.delete(result.key);
    if (!request) return;
    if (request.kind === "formation") {
      this.completeFormationPath(result, request);
      return;
    }

    const unit = this.unitById(request.unitId);
    if (
      !unit ||
      this.unitPendingPathRequests.get(unit.id) !== result.key
    ) {
      return;
    }
    this.unitPendingPathRequests.delete(unit.id);
    if (result.status === "failed" || result.path.length === 0) {
      this.unitPathingOverrides.set(unit.id, "blocked");
      return;
    }
    this.applyResolvedPath(unit, result.path, request.destination);
  }

  private completeFormationPath(
    result: PathRequestResult,
    request: FormationPathRequest,
  ) {
    const occupied = new Set(request.occupied);
    const reserved = new Set<number>();
    const starts = new Map(
      request.starts.map(({ unitId, tile }) => [unitId, tile]),
    );
    for (const unitId of request.unitIds) {
      const unit = this.unitById(unitId);
      if (
        !unit ||
        this.unitPendingPathRequests.get(unitId) !== result.key
      ) {
        continue;
      }
      this.unitPendingPathRequests.delete(unitId);
      if (result.status === "failed" || result.path.length === 0) {
        this.unitPathingOverrides.set(unitId, "blocked");
        continue;
      }

      const start = starts.get(unitId)!;
      const offset = {
        x: start.x - request.anchorStart.x,
        y: start.y - request.anchorStart.y,
      };
      const destination = nearestWalkable(
        {
          x: request.anchorTarget.x + offset.x,
          y: request.anchorTarget.y + offset.y,
        },
        { occupied, reserved },
      );
      if (!destination) {
        this.unitPathingOverrides.set(unitId, "blocked");
        continue;
      }
      const translated = translateSharedPath(result.path, offset, {
        occupied,
        reserved,
      });
      if (
        translated.length === 0 ||
        translated[translated.length - 1].x !== destination.x ||
        translated[translated.length - 1].y !== destination.y
      ) {
        this.planPath(unit, destination, request.priority, {
          occupied,
          reserved,
          start,
        });
      } else {
        this.applyResolvedPath(unit, translated, destination);
      }
      unit.attackMoveDestination =
        request.mode === "attackMove" ? { ...destination } : null;
      reserved.add(tileKeyOf(destination));
    }
  }

  private applyResolvedPath(
    unit: UnitState,
    path: readonly GridPoint[],
    destination: GridPoint,
  ) {
    unit.path = path.slice(1).map((point) => ({ ...point }));
    unit.pathIndex = 0;
    unit.destination = { ...destination };
    this.unitPathingOverrides.delete(unit.id);
  }

  private nearestOpenAdjacentTile(tile: GridPoint, unitId: number) {
    const unit = this.unitById(unitId);
    if (!unit) return undefined;
    const occupied = this.occupiedTiles(new Set([unitId]), unit.playerId);
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
          gridDistanceSquared(toTile(unit.position), left) -
            gridDistanceSquared(
              toTile(unit.position),
              right,
            ) ||
          tileKeyOf(left) - tileKeyOf(right),
      )[0];
  }

  private clearPath(unit: UnitState) {
    this.cancelPendingPathRequest(unit);
    unit.path = [];
    unit.pathIndex = 0;
    unit.destination = null;
    this.unitPathingOverrides.delete(unit.id);
  }

  private cancelPendingPathRequest(unit: UnitState) {
    const requestKey = this.unitPendingPathRequests.get(unit.id);
    if (!requestKey) return;
    this.unitPendingPathRequests.delete(unit.id);
    const request = this.pendingPathRequests.get(requestKey);
    if (request?.kind === "unit") {
      this.pendingPathRequests.delete(requestKey);
      this.pathRequests.cancel(requestKey);
      return;
    }
    if (
      request?.kind === "formation" &&
      request.unitIds.every(
        (unitId) =>
          this.unitPendingPathRequests.get(unitId) !== requestKey,
      )
    ) {
      this.pendingPathRequests.delete(requestKey);
      this.pathRequests.cancel(requestKey);
    }
  }

  private pathingStateOf(unit: UnitState): PathingState {
    const requestKey = this.unitPendingPathRequests.get(unit.id);
    if (requestKey) {
      const override = this.unitPathingOverrides.get(unit.id);
      if (override === "retrying") return override;
      return this.pathRequests.stateOf(requestKey) ?? override ?? "queued";
    }
    if (unit.pathIndex < unit.path.length) return "following";
    return this.unitPathingOverrides.get(unit.id) ?? "idle";
  }

  private moveUnit(unit: UnitState) {
    if (unit.pathIndex >= unit.path.length) {
      if (unit.order === "move" && unit.destination) {
        this.clearPath(unit);
        unit.order = unit.aiScout ? "hold" : "idle";
        unit.aiScout = false;
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
      this.moveUnitIndexes(unit);
      unit.pathIndex += 1;
      if (unit.pathIndex >= unit.path.length) {
        this.clearPath(unit);
        if (unit.order === "move") {
          unit.order = unit.aiScout ? "hold" : "idle";
          unit.aiScout = false;
        }
      }
      return;
    }
    unit.position.x += Math.trunc((dx * stepMilli) / distance);
    unit.position.y += Math.trunc((dy * stepMilli) / distance);
    this.moveUnitIndexes(unit);
  }

  private liveOracle(playerId: PlayerId) {
    return this.sortedStructures().find(
      (structure) =>
        structure.playerId === playerId &&
        structure.kind === "operationsCenter" &&
        structure.constructionRemainingTicks === 0 &&
        structure.health > 0,
    );
  }

  private operationalOracle(playerId: PlayerId) {
    const oracle = this.liveOracle(playerId);
    return oracle?.powered ? oracle : undefined;
  }

  private solarSpearReady(playerId: PlayerId) {
    const solar = this.solarSpears[playerId];
    return (
      solar.impactTick === null &&
      this.operationalOracle(playerId) !== undefined &&
      solar.chargeTicks >= gameData.solarSpear.chargeTicks
    );
  }

  private launchSolarSpear(
    playerId: PlayerId,
    target: GridPoint,
    reportFailure = playerId === this.controlledPlayer,
  ) {
    const normalizedTarget = {
      x: Math.round(target.x),
      y: Math.round(target.y),
    };
    let failure: SolarSpearFailure | null = null;
    if (
      !Number.isFinite(normalizedTarget.x) ||
      !Number.isFinite(normalizedTarget.y) ||
      normalizedTarget.x < 0 ||
      normalizedTarget.y < 0 ||
      normalizedTarget.x >= MAP_SIZE ||
      normalizedTarget.y >= MAP_SIZE
    ) {
      failure = "outsideMap";
    } else if (!this.solarSpearReady(playerId)) {
      failure = "notReady";
    } else if (
      this.scenario === "skirmish" &&
      !this.visibility[playerId].isVisible(normalizedTarget)
    ) {
      failure = "notVisible";
    }
    if (reportFailure) this.lastSolarFailure = failure;
    if (failure) return false;

    const solar = this.solarSpears[playerId];
    solar.chargeTicks = 0;
    solar.target = normalizedTarget;
    solar.impactTick = this.tick + gameData.solarSpear.warningTicks;
    solar.launches += 1;
    if (playerId === this.controlledPlayer) {
      this.onboarding.solarSpear = true;
    }
    return true;
  }

  private updateSolarSpears() {
    let impacted = false;
    for (const playerId of [1, 2] as const) {
      const solar = this.solarSpears[playerId];
      if (solar.impactTick !== null && solar.target) {
        if (this.tick < solar.impactTick) continue;
        const targetPosition = tileCenter(solar.target);
        const radiusSquared =
          gameData.solarSpear.blastRadiusMilli *
          gameData.solarSpear.blastRadiusMilli;
        for (const unit of this.unitsWithin(
          targetPosition,
          gameData.solarSpear.blastRadiusMilli,
        )) {
          if (distanceSquared(unit.position, targetPosition) <= radiusSquared) {
            unit.health = Math.max(
              0,
              unit.health - gameData.solarSpear.damage,
            );
          }
        }
        for (const structure of this.structuresWithin(
          targetPosition,
          gameData.solarSpear.blastRadiusMilli,
        )) {
          if (
            distanceSquared(tileCenter(structure.tile), targetPosition) <=
            radiusSquared
          ) {
            structure.health = Math.max(
              0,
              structure.health - gameData.solarSpear.damage,
            );
          }
        }
        solar.lastImpact = { target: { ...solar.target }, tick: this.tick };
        solar.target = null;
        solar.impactTick = null;
        impacted = true;
        continue;
      }

      if (!this.liveOracle(playerId)) {
        solar.chargeTicks = 0;
      } else if (this.operationalOracle(playerId)) {
        solar.chargeTicks = Math.min(
          gameData.solarSpear.chargeTicks,
          solar.chargeTicks + 1,
        );
      }
    }
    return impacted;
  }

  private updateConstruction() {
    for (const structure of this.sortedStructures()) {
      if (structure.constructionRemainingTicks <= 0) continue;
      structure.constructionRemainingTicks -= 1;
      if (structure.constructionRemainingTicks === 0) {
        if (structure.kind === "refinery") {
          this.spawnUnit(structure, "midasHarvester");
        }
        if (this.onboardingConstructionIds.delete(structure.id)) {
          if (
            structure.kind === "reactor" ||
            structure.kind === "refinery" ||
            structure.kind === "barracks" ||
            structure.kind === "operationsCenter"
          ) {
            this.onboarding[structure.kind] = true;
          }
        }
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
        if (adjacent) this.planPath(unit, adjacent, "harvest");
      }
      return;
    }

    let field =
      unit.harvestFieldId === null
        ? undefined
        : this.fieldsById.get(unit.harvestFieldId);
    if (!field || field.amount <= 0) {
      const fieldId = this.fieldSpatialIndex.nearest(
        unit.position,
        (id) => (this.fieldsById.get(id)?.amount ?? 0) > 0,
      );
      field = fieldId === undefined ? undefined : this.fieldsById.get(fieldId);
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
      if (adjacent) this.planPath(unit, adjacent, "harvest");
    }
  }

  private nearestOperationalRefinery(unit: UnitState) {
    const refineryId = this.structureSpatialIndex.nearest(
      unit.position,
      (id) => {
        const structure = this.structureById(id);
        return (
          structure !== undefined &&
          structure.playerId === unit.playerId &&
          structure.kind === "refinery" &&
          structure.constructionRemainingTicks === 0 &&
          structure.powered &&
          structure.health > 0
        );
      },
    );
    return refineryId === undefined
      ? undefined
      : this.structureById(refineryId);
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
      const target = this.unitsWithin(position, weapon.rangeMilli)
        .filter(
          (unit) =>
            unit.playerId !== structure.playerId &&
            this.isUnitVisibleTo(structure.playerId, unit) &&
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
      this.scenario === "skirmish" &&
      !this.visibility[playerId].isVisible(tile)
    ) {
      return "unexplored";
    }
    if (
      this.tileHasEntity(tile)
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
    const inRadius = this.structuresWithin(
      tileCenter(tile),
      MAX_BUILD_RADIUS_MILLI,
    ).some((structure) => {
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
    reportFailure = playerId === this.controlledPlayer,
  ) {
    const failure = this.placementFailure(playerId, buildingKind, tile);
    if (reportFailure) this.lastPlacementFailure = failure;
    if (failure) return;
    const definition = gameData.buildings[buildingKind];
    this.players[playerId].credits -= definition.cost;
    const structureId = this.nextStructureId;
    const structure = this.createStructureState(
      structureId,
      playerId,
      buildingKind,
      tile,
      false,
    );
    this.structures.push(structure);
    this.indexStructure(structure);
    if (playerId === this.controlledPlayer) {
      this.onboardingConstructionIds.add(structureId);
    }
    this.nextStructureId += 1;
  }

  private queueUnit(
    playerId: PlayerId,
    structureId: number,
    unitKind: UnitKind,
  ) {
    const structure = this.structureById(structureId);
    if (
      !structure ||
      structure.playerId !== playerId ||
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
    if (playerId === this.controlledPlayer) {
      this.onboarding.production = true;
    }
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

  private sellStructure(structureId: StructureId) {
    const structure = this.structureById(structureId);
    if (
      !structure ||
      structure.playerId !== this.controlledPlayer ||
      structure.kind === "citadel"
    ) {
      return;
    }
    const queuedRefund = structure.queue.reduce(
      (total, item) => total + gameData.units[item.unitKind].cost,
      0,
    );
    const structureRefund = Math.floor(
      (gameData.buildings[structure.kind].cost *
        gameData.economy.structureSellRefundBasisPoints) /
        10_000,
    );
    this.players[structure.playerId].credits +=
      structureRefund + queuedRefund;
    this.structures = this.structures.filter(
      (candidate) => candidate.id !== structureId,
    );
    this.orderedStructures = this.orderedStructures.filter(
      (candidate) => candidate.id !== structureId,
    );
    this.structuresById.delete(structureId);
    this.structureSpatialIndex.remove(structureId);
    this.onboardingConstructionIds.delete(structureId);
    this.updateConnectivityAndPower();
    this.updateVisibility();
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
    const spawnTile = this.nearestSpawnTile(
      structure.tile,
      structure.playerId,
    );
    if (!spawnTile) return false;
    const unit = this.createUnitState(
      this.nextUnitId,
      structure.playerId,
      unitKind,
      spawnTile,
    );
    this.nextUnitId += 1;
    this.units.push(unit);
    this.indexUnit(unit);
    const rally = this.rallies.get(structure.playerId);
    if (rally) {
      unit.order = "move";
      this.planPath(unit, rally, "background");
    }
    return true;
  }

  private nearestSpawnTile(tile: GridPoint, playerId: PlayerId) {
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
            !this.tileHasEntity(candidate, playerId) &&
            !this.fields.some(
              (field) => tileKeyOf(field.tile) === tileKeyOf(candidate),
            )
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
      this.cancelPendingPathRequest(unit);
      this.unitPathingOverrides.delete(unit.id);
      for (const group of this.controlGroups.values()) {
        const index = group.indexOf(unit.id);
        if (index >= 0) group.splice(index, 1);
      }
    }
    if (destroyedUnits.length > 0) {
      const destroyedIds = new Set(destroyedUnits.map((unit) => unit.id));
      for (const id of destroyedIds) {
        this.unitsById.delete(id);
        this.unitSpatialIndex.remove(id);
        this.unitTileSpatialIndex.remove(id);
      }
      this.units = this.units.filter((unit) => !destroyedIds.has(unit.id));
      this.orderedUnits = this.orderedUnits.filter(
        (unit) => !destroyedIds.has(unit.id),
      );
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
      for (const id of destroyedIds) this.onboardingConstructionIds.delete(id);
      for (const id of destroyedIds) {
        this.structuresById.delete(id);
        this.structureSpatialIndex.remove(id);
      }
      this.structures = this.structures.filter(
        (structure) => !destroyedIds.has(structure.id),
      );
      this.orderedStructures = this.orderedStructures.filter(
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
      for (const playerId of [1, 2] as const) {
        if (
          this.solarSpears[playerId].impactTick === null &&
          !this.liveOracle(playerId)
        ) {
          this.solarSpears[playerId].chargeTicks = 0;
        }
      }
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
    for (const unit of this.sortedUnits()) this.applySeparationFor(unit);
  }

  private applySeparationFor(left: UnitState) {
    const minimumSquared = SEPARATION_MILLI * SEPARATION_MILLI;
    const processedIds = new Set<UnitId>();
    let nearbyIds = this.unitSpatialIndex
      .query(left.position, TILE_MILLI)
      .filter((id) => id > left.id);
    while (nearbyIds.length > 0) {
      const rightId = nearbyIds.shift()!;
      if (processedIds.has(rightId)) continue;
      processedIds.add(rightId);
      const right = this.unitById(rightId);
      if (!right) continue;
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
      this.moveUnitIndexes(left);
      this.moveUnitIndexes(right);
      nearbyIds = [
        ...new Set([
          ...nearbyIds,
          ...this.unitSpatialIndex
            .query(left.position, TILE_MILLI)
            .filter((id) => id > left.id && !processedIds.has(id)),
        ]),
      ].sort((a, b) => a - b);
    }
  }
}
