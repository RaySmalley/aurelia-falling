export type Vec2 = Readonly<{ x: number; y: number }>;
export type GridPoint = Vec2;
export type UnitId = number;
export type StructureId = number;
export type PlayerId = 1 | 2;
export type UnitKind =
  | "midasHarvester"
  | "argusRifle"
  | "cyclopsRocket"
  | "hermesScout"
  | "atlasTank"
  | "gorgonWalker";
export type BuildingKind =
  | "citadel"
  | "reactor"
  | "refinery"
  | "barracks"
  | "foundry"
  | "operationsCenter"
  | "turret";
export type ArmorClass = "infantry" | "light" | "heavy" | "siege";
export type WeaponId =
  | "miningLaser"
  | "argusRifle"
  | "cyclopsRockets"
  | "hermesAutocannon"
  | "atlasCannon"
  | "gorgonMortar"
  | "cerberusPulse";
export type OrderKind =
  | "idle"
  | "move"
  | "attackMove"
  | "attack"
  | "hold"
  | "harvest"
  | "unload";
export type MatchStatus = "active" | "victory" | "defeat" | "draw";
export type SimulationScenario = "combat" | "economy" | "skirmish";
export type VisibilityLevel = 0 | 1 | 2;
export type PlacementFailure =
  | "outsideMap"
  | "blockedTerrain"
  | "occupied"
  | "resourceField"
  | "unexplored"
  | "outsideBuildRadius"
  | "missingPrerequisite"
  | "insufficientCredits"
  | "citadelUnique";

export type SimCommand =
  | {
      kind: "selectUnits";
      unitIds: readonly UnitId[];
      additive: boolean;
    }
  | {
      kind: "selectStructures";
      structureIds: readonly StructureId[];
      additive: boolean;
    }
  | { kind: "move"; target: GridPoint; mode: "move" | "attackMove" }
  | { kind: "stop" }
  | { kind: "hold" }
  | { kind: "assignControlGroup"; group: number }
  | { kind: "recallControlGroup"; group: number }
  | { kind: "setRally"; target: GridPoint }
  | { kind: "attackUnit"; targetUnitId: UnitId }
  | { kind: "attackStructure"; targetStructureId: StructureId }
  | { kind: "placeBuilding"; buildingKind: BuildingKind; tile: GridPoint }
  | {
      kind: "queueUnit";
      structureId: StructureId;
      unitKind: UnitKind;
    }
  | { kind: "cancelProduction"; structureId: StructureId; queueIndex: number }
  | { kind: "setRepair"; structureId: StructureId; enabled: boolean }
  | { kind: "switchPlayer"; playerId: PlayerId }
  | { kind: "restartCombat"; seed?: number }
  | { kind: "restartEconomy"; seed?: number }
  | { kind: "restartSkirmish"; seed?: number };

export type UnitSnapshot = Readonly<{
  id: UnitId;
  callsign: string;
  playerId: PlayerId;
  kind: UnitKind;
  displayName: string;
  armor: ArmorClass;
  formationId: number;
  position: Vec2;
  destination: GridPoint | null;
  selected: boolean;
  order: OrderKind;
  path: readonly GridPoint[];
  health: number;
  maxHealth: number;
  weaponId: WeaponId;
  targetId: UnitId | null;
  targetStructureId: StructureId | null;
  cooldownTicks: number;
  cargo: number;
  cargoCapacity: number;
}>;

export type ProductionItemSnapshot = Readonly<{
  unitKind: UnitKind;
  remainingTicks: number;
  totalTicks: number;
}>;

export type StructureSnapshot = Readonly<{
  id: StructureId;
  playerId: PlayerId;
  kind: BuildingKind;
  displayName: string;
  tile: GridPoint;
  selected: boolean;
  health: number;
  maxHealth: number;
  constructionRemainingTicks: number;
  constructionTotalTicks: number;
  completed: boolean;
  powered: boolean;
  connected: boolean;
  repairing: boolean;
  powerGenerated: number;
  powerConsumed: number;
  buildRadius: number;
  queue: readonly ProductionItemSnapshot[];
}>;

export type AureliteFieldSnapshot = Readonly<{
  id: number;
  tile: GridPoint;
  amount: number;
  capacity: number;
  contested: boolean;
}>;

export type PlayerSnapshot = Readonly<{
  id: PlayerId;
  credits: number;
  powerGenerated: number;
  powerConsumed: number;
  lowPower: boolean;
}>;

export type ProjectileSnapshot = Readonly<{
  id: number;
  playerId: PlayerId;
  weaponId: WeaponId;
  position: Vec2;
  targetType: "unit" | "structure";
  targetId: number;
}>;

export type RallySnapshot = Readonly<{
  formationId: number;
  target: GridPoint;
}>;

export type VisibilitySnapshot = Readonly<{
  enabled: boolean;
  width: number;
  height: number;
  revision: number;
  tiles: readonly VisibilityLevel[];
}>;

export type AiPhase =
  | "build"
  | "scout"
  | "defend"
  | "expand"
  | "attack";

export type AiSnapshot = Readonly<{
  enabled: boolean;
  playerId: 2;
  profile: "normal";
  phase: AiPhase;
  lastDecisionTick: number;
  knownEnemyUnits: number;
  knownEnemyStructures: number;
  cheats: false;
}>;

export type SimulationSnapshot = Readonly<{
  tick: number;
  scenario: SimulationScenario;
  controlledPlayer: PlayerId;
  units: readonly UnitSnapshot[];
  structures: readonly StructureSnapshot[];
  fields: readonly AureliteFieldSnapshot[];
  players: Readonly<Record<PlayerId, PlayerSnapshot>>;
  projectiles: readonly ProjectileSnapshot[];
  selectedUnitIds: readonly UnitId[];
  selectedStructureIds: readonly StructureId[];
  rallies: readonly RallySnapshot[];
  status: MatchStatus;
  winner: PlayerId | null;
  kills: Readonly<Record<PlayerId, number>>;
  seed: number;
  lastPlacementFailure: PlacementFailure | null;
  visibility: VisibilitySnapshot;
  ai: AiSnapshot;
}>;

export type RuntimeSnapshot = Readonly<{
  simulation: SimulationSnapshot;
  paused: boolean;
  pauseReason: "hidden" | "manual" | null;
  audioReady: boolean;
  renderer: string;
}>;

export type RuntimeListener = (snapshot: RuntimeSnapshot) => void;

export type GameRuntime = {
  subscribe(listener: RuntimeListener): () => void;
  enqueue(command: SimCommand): void;
  beginPlacement(buildingKind: BuildingKind | null): void;
  pause(reason: "hidden" | "manual"): void;
  resume(): void;
  unlockAudio(): Promise<void>;
  centerCamera(): void;
  destroy(): void;
};
