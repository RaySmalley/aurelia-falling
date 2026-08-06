import { Simulation } from "./simulation";
import {
  DEFAULT_SNAPSHOT_CADENCE_TICKS,
  SIMULATION_RUNTIME_PROTOCOL_VERSION,
  type InitializeSimulationRuntimeMessage,
  type QueueSimulationCommandMessage,
  type RestartSimulationRuntimeMessage,
  type SimulationRuntimeErrorCode,
  type SimulationRuntimeEvent,
  type SimulationRuntimePauseReason,
  type SimulationRuntimeRequest,
} from "./runtime-protocol";

export type SimulationRuntimeEventListener = (
  event: SimulationRuntimeEvent,
) => void;

type ScheduledRuntimeMessage =
  | QueueSimulationCommandMessage
  | RestartSimulationRuntimeMessage;

const SIMULATION_SCENARIOS = new Set(["combat", "economy", "skirmish"]);
const AI_DIFFICULTIES = new Set(["easy", "normal", "hard"]);
const RESTART_COMMAND_KINDS = new Set([
  "restartCombat",
  "restartEconomy",
  "restartSkirmish",
]);

function isNonNegativeInteger(value: number) {
  return Number.isInteger(value) && value >= 0;
}

export class InProcessSimulationRuntime {
  private simulation: Simulation | null = null;
  private lastTick = 0;
  private snapshotCadenceTicks = DEFAULT_SNAPSHOT_CADENCE_TICKS;
  private pauseReason: SimulationRuntimePauseReason | null = null;
  private terminated = false;
  private readonly scheduledCommands =
    new Map<number, ScheduledRuntimeMessage[]>();
  private readonly receivedSequences = new Set<number>();
  private readonly listeners = new Set<SimulationRuntimeEventListener>();

  subscribe(listener: SimulationRuntimeEventListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispatch(message: SimulationRuntimeRequest) {
    if (
      message.protocolVersion !== SIMULATION_RUNTIME_PROTOCOL_VERSION
    ) {
      this.emitError(
        "protocol_version_mismatch",
        `Expected protocol version ${SIMULATION_RUNTIME_PROTOCOL_VERSION}.`,
        false,
      );
      return;
    }
    if (this.terminated) {
      this.emitError("runtime_terminated", "Runtime is terminated.", false);
      return;
    }

    switch (message.type) {
      case "initialize":
        this.initialize(message);
        break;
      case "command":
        if (RESTART_COMMAND_KINDS.has(message.command.kind)) {
          this.emitError(
            "invalid_message",
            "Restart transitions must use an explicit restart message.",
            false,
          );
          return;
        }
        this.queueScheduledMessage(message);
        break;
      case "restart":
        if (!this.validInitialization(message)) {
          this.emitError(
            "invalid_initialization",
            "Restart seed, scenario, and difficulty must be valid.",
            false,
          );
          return;
        }
        this.queueScheduledMessage(message);
        break;
      case "pause":
        if (!this.requireSimulation()) return;
        this.pauseReason = message.reason;
        this.emitPauseChanged();
        break;
      case "resume":
        if (!this.requireSimulation()) return;
        this.pauseReason = null;
        this.emitPauseChanged();
        break;
      case "terminate":
        if (!this.requireSimulation()) return;
        this.terminated = true;
        this.scheduledCommands.clear();
        this.receivedSequences.clear();
        this.emit({
          protocolVersion: SIMULATION_RUNTIME_PROTOCOL_VERSION,
          type: "terminated",
          tick: this.lastTick,
        });
        break;
      default:
        this.emitError("invalid_message", "Unknown runtime message.", false);
    }
  }

  advance(ticks = 1) {
    if (!isNonNegativeInteger(ticks)) {
      throw new Error("ticks must be a non-negative integer");
    }
    if (this.terminated) return 0;
    if (!this.requireSimulation() || this.pauseReason !== null) return 0;

    let advanced = 0;
    for (
      let count = 0;
      count < ticks && !this.terminated;
      count += 1
    ) {
      const commands = this.scheduledCommands.get(this.lastTick) ?? [];
      this.scheduledCommands.delete(this.lastTick);
      for (const message of commands.sort(
        (left, right) => left.sequence - right.sequence,
      )) {
        if (message.type === "restart") {
          this.simulation = new Simulation(
            message.seed,
            message.scenario,
            message.difficulty,
          );
          this.scheduledCommands.clear();
        } else {
          this.simulation!.enqueue(message.command);
        }
      }
      const simulation = this.simulation!;
      simulation.step();
      const snapshot = simulation.snapshot();
      this.lastTick += 1;
      advanced += 1;
      if (this.lastTick % this.snapshotCadenceTicks === 0) {
        this.emitSnapshot(snapshot);
      }
    }
    return advanced;
  }

  tick() {
    return this.simulation ? this.lastTick : null;
  }

  authoritativeState() {
    return this.simulation?.authoritativeState() ?? null;
  }

  private initialize(message: InitializeSimulationRuntimeMessage) {
    if (this.simulation) {
      this.emitError(
        "invalid_initialization",
        "Runtime has already been initialized.",
        false,
      );
      return;
    }
    const cadence =
      message.snapshotCadenceTicks ?? DEFAULT_SNAPSHOT_CADENCE_TICKS;
    if (
      !this.validInitialization(message) ||
      cadence < 1 ||
      !Number.isInteger(cadence)
    ) {
      this.emitError(
        "invalid_initialization",
        "Seed, scenario, difficulty, and snapshot cadence must be valid.",
        false,
      );
      return;
    }
    this.snapshotCadenceTicks = cadence;
    this.simulation = new Simulation(
      message.seed,
      message.scenario,
      message.difficulty,
    );
    const snapshot = this.simulation.snapshot();
    this.lastTick = snapshot.tick;
    this.emit({
      protocolVersion: SIMULATION_RUNTIME_PROTOCOL_VERSION,
      type: "ready",
      tick: this.lastTick,
    });
    this.emitSnapshot(snapshot);
  }

  private queueScheduledMessage(message: ScheduledRuntimeMessage) {
    if (!this.requireSimulation()) return;
    if (
      !isNonNegativeInteger(message.sequence) ||
      !isNonNegativeInteger(message.intendedTick)
    ) {
      this.emitError(
        "invalid_message",
        "Command sequence and intended tick must be non-negative integers.",
        false,
      );
      return;
    }
    if (this.receivedSequences.has(message.sequence)) {
      this.emitError(
        "duplicate_sequence",
        `Command sequence ${message.sequence} was already received.`,
        true,
      );
      return;
    }
    if (message.intendedTick < this.lastTick) {
      this.emitError(
        "late_command",
        `Command intended for tick ${message.intendedTick} arrived at tick ${this.lastTick}.`,
        true,
      );
      return;
    }
    this.receivedSequences.add(message.sequence);
    const commands = this.scheduledCommands.get(message.intendedTick) ?? [];
    commands.push(structuredClone(message));
    this.scheduledCommands.set(message.intendedTick, commands);
  }

  private validInitialization(
    message:
      | InitializeSimulationRuntimeMessage
      | RestartSimulationRuntimeMessage,
  ) {
    return (
      isNonNegativeInteger(message.seed) &&
      message.seed <= 0xffff_ffff &&
      SIMULATION_SCENARIOS.has(message.scenario) &&
      AI_DIFFICULTIES.has(message.difficulty)
    );
  }

  private requireSimulation() {
    if (this.simulation) return true;
    this.emitError(
      "not_initialized",
      "Runtime must be initialized before use.",
      true,
    );
    return false;
  }

  private emitSnapshot(snapshot: ReturnType<Simulation["snapshot"]>) {
    this.emit({
      protocolVersion: SIMULATION_RUNTIME_PROTOCOL_VERSION,
      type: "snapshot",
      tick: this.lastTick,
      snapshot,
    });
  }

  private emitPauseChanged() {
    this.emit({
      protocolVersion: SIMULATION_RUNTIME_PROTOCOL_VERSION,
      type: "pauseChanged",
      paused: this.pauseReason !== null,
      reason: this.pauseReason,
      tick: this.lastTick,
    });
  }

  private emitError(
    code: SimulationRuntimeErrorCode,
    message: string,
    recoverable: boolean,
  ) {
    this.emit({
      protocolVersion: SIMULATION_RUNTIME_PROTOCOL_VERSION,
      type: "error",
      code,
      message,
      recoverable,
      tick: this.simulation ? this.lastTick : null,
    });
  }

  private emit(event: SimulationRuntimeEvent) {
    this.listeners.forEach((listener) => listener(event));
  }
}
