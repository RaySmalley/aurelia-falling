export type Vec2 = Readonly<{ x: number; y: number }>;
export type GridPoint = Vec2;
export type UnitId = number;
export type OrderKind = "idle" | "move" | "attackMove" | "hold";

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
  | { kind: "setRally"; target: GridPoint };

export type UnitSnapshot = Readonly<{
  id: UnitId;
  callsign: string;
  formationId: number;
  position: Vec2;
  destination: GridPoint | null;
  selected: boolean;
  order: OrderKind;
  path: readonly GridPoint[];
}>;

export type RallySnapshot = Readonly<{
  formationId: number;
  target: GridPoint;
}>;

export type SimulationSnapshot = Readonly<{
  tick: number;
  units: readonly UnitSnapshot[];
  selectedUnitIds: readonly UnitId[];
  rallies: readonly RallySnapshot[];
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
