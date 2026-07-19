export type Vec2 = Readonly<{ x: number; y: number }>;
export type GridPoint = Vec2;
export type UnitId = number;
export type PlayerId = 1 | 2;
export type UnitKind =
  | "midasHarvester"
  | "argusRifle"
  | "cyclopsRocket"
  | "hermesScout"
  | "atlasTank"
  | "gorgonWalker";
export type ArmorClass = "infantry" | "light" | "heavy" | "siege";
export type WeaponId =
  | "miningLaser"
  | "argusRifle"
  | "cyclopsRockets"
  | "hermesAutocannon"
  | "atlasCannon"
  | "gorgonMortar";
export type OrderKind = "idle" | "move" | "attackMove" | "attack" | "hold";
export type MatchStatus = "active" | "victory" | "defeat" | "draw";

export type SimCommand =
  | {
      kind: "selectUnits";
      unitIds: readonly UnitId[];
      additive: boolean;
    }
  | { kind: "move"; target: GridPoint; mode: "move" | "attackMove" }
  | { kind: "stop" }
  | { kind: "hold" }
  | { kind: "assignControlGroup"; group: number }
  | { kind: "recallControlGroup"; group: number }
  | { kind: "setRally"; target: GridPoint }
  | { kind: "attackUnit"; targetUnitId: UnitId }
  | { kind: "restartCombat"; seed?: number };

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
  cooldownTicks: number;
}>;

export type ProjectileSnapshot = Readonly<{
  id: number;
  playerId: PlayerId;
  weaponId: WeaponId;
  position: Vec2;
  targetId: UnitId;
}>;

export type RallySnapshot = Readonly<{
  formationId: number;
  target: GridPoint;
}>;

export type SimulationSnapshot = Readonly<{
  tick: number;
  units: readonly UnitSnapshot[];
  projectiles: readonly ProjectileSnapshot[];
  selectedUnitIds: readonly UnitId[];
  rallies: readonly RallySnapshot[];
  status: MatchStatus;
  winner: PlayerId | null;
  kills: Readonly<Record<PlayerId, number>>;
  seed: number;
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
  pause(reason: "hidden" | "manual"): void;
  resume(): void;
  unlockAudio(): Promise<void>;
  centerCamera(): void;
  destroy(): void;
};
