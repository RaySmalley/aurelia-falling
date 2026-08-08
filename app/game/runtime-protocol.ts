import type {
  AiDifficulty,
  SimCommand,
  SimulationScenario,
  SimulationSnapshot,
} from "./types";

export const SIMULATION_RUNTIME_PROTOCOL_VERSION = 1 as const;
export const DEFAULT_SNAPSHOT_CADENCE_TICKS = 2;

export type SimulationRuntimeProtocolVersion =
  typeof SIMULATION_RUNTIME_PROTOCOL_VERSION;
export type SimulationRuntimePauseReason = "hidden" | "manual";

type VersionedRuntimeMessage = Readonly<{
  protocolVersion: SimulationRuntimeProtocolVersion;
}>;

export type InitializeSimulationRuntimeMessage = VersionedRuntimeMessage &
  Readonly<{
    type: "initialize";
    seed: number;
    scenario: SimulationScenario;
    difficulty: AiDifficulty;
    snapshotCadenceTicks?: number;
  }>;

export type QueueSimulationCommandMessage = VersionedRuntimeMessage &
  Readonly<{
    type: "command";
    sequence: number;
    intendedTick: number;
    command: Exclude<
      SimCommand,
      {
        kind: "restartCombat" | "restartEconomy" | "restartSkirmish";
      }
    >;
  }>;

export type RestartSimulationRuntimeMessage = VersionedRuntimeMessage &
  Readonly<{
    type: "restart";
    sequence: number;
    intendedTick: number;
    seed: number;
    scenario: SimulationScenario;
    difficulty: AiDifficulty;
  }>;

export type PauseSimulationRuntimeMessage = VersionedRuntimeMessage &
  Readonly<{
    type: "pause";
    reason: SimulationRuntimePauseReason;
  }>;

export type ResumeSimulationRuntimeMessage = VersionedRuntimeMessage &
  Readonly<{
    type: "resume";
    reason: SimulationRuntimePauseReason;
  }>;

export type TerminateSimulationRuntimeMessage = VersionedRuntimeMessage &
  Readonly<{
    type: "terminate";
  }>;

export type SimulationRuntimeRequest =
  | InitializeSimulationRuntimeMessage
  | QueueSimulationCommandMessage
  | RestartSimulationRuntimeMessage
  | PauseSimulationRuntimeMessage
  | ResumeSimulationRuntimeMessage
  | TerminateSimulationRuntimeMessage;

export type SimulationRuntimeErrorCode =
  | "duplicate_sequence"
  | "invalid_initialization"
  | "invalid_message"
  | "late_command"
  | "not_initialized"
  | "protocol_version_mismatch"
  | "runtime_terminated"
  | "worker_failure";

export type SimulationRuntimeReadyEvent = VersionedRuntimeMessage &
  Readonly<{
    type: "ready";
    tick: number;
  }>;

export type SimulationRuntimeSnapshotEvent = VersionedRuntimeMessage &
  Readonly<{
    type: "snapshot";
    /** Monotonic runtime tick. The nested simulation tick resets on restart. */
    tick: number;
    snapshot: SimulationSnapshot;
  }>;

export type SimulationRuntimePauseEvent = VersionedRuntimeMessage &
  Readonly<{
    type: "pauseChanged";
    paused: boolean;
    reasons: readonly SimulationRuntimePauseReason[];
    tick: number;
  }>;

export type SimulationRuntimeTerminatedEvent = VersionedRuntimeMessage &
  Readonly<{
    type: "terminated";
    tick: number;
  }>;

export type SimulationRuntimeErrorEvent = VersionedRuntimeMessage &
  Readonly<{
    type: "error";
    code: SimulationRuntimeErrorCode;
    message: string;
    recoverable: boolean;
    tick: number | null;
  }>;

export type SimulationRuntimeEvent =
  | SimulationRuntimeReadyEvent
  | SimulationRuntimeSnapshotEvent
  | SimulationRuntimePauseEvent
  | SimulationRuntimeTerminatedEvent
  | SimulationRuntimeErrorEvent;
