export type Vec2 = Readonly<{ x: number; y: number }>;

export type SimCommand =
  | { kind: "move"; target: Vec2 }
  | { kind: "select"; selected: boolean };

export type SimulationSnapshot = Readonly<{
  tick: number;
  unit: Readonly<{
    id: "pathfinder-01";
    position: Vec2;
    destination: Vec2 | null;
    selected: boolean;
  }>;
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
