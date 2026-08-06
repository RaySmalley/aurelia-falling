import { Simulation } from "./simulation";
import {
  DEFAULT_SNAPSHOT_CADENCE_TICKS,
  SIMULATION_RUNTIME_PROTOCOL_VERSION,
  type InitializeSimulationRuntimeMessage,
  type QueueSimulationCommandMessage,
  type SimulationRuntimeErrorCode,
  type SimulationRuntimeEvent,
  type SimulationRuntimePauseReason,
  type SimulationRuntimeRequest,
} from "./runtime-protocol";

export type SimulationRuntimeEventListener = (
  event: SimulationRuntimeEvent,
) => void;

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
    new Map<number, QueueSimulationCommandMessage[]>();
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
        this.queueCommand(message);
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
    if (!this.requireSimulation() || this.pauseReason !== null) return 0;

    let advanced = 0;
    for (let count = 0; count < ticks; count += 1) {
      const simulation = this.simulation!;
      const commands = this.scheduledCommands.get(this.lastTick) ?? [];
      commands
        .sort((left, right) => left.sequence - right.sequence)
        .forEach(({ command }) => simulation.enqueue(command));
      this.scheduledCommands.delete(this.lastTick);
      simulation.step();
      const snapshot = simulation.snapshot();
      this.lastTick = snapshot.tick;
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
    if (!isNonNegativeInteger(message.seed) || cadence < 1 || !Number.isInteger(cadence)) {
      this.emitError(
        "invalid_initialization",
        "Seed and snapshot cadence must be valid non-negative integers.",
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

  private queueCommand(message: QueueSimulationCommandMessage) {
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
    commands.push(message);
    this.scheduledCommands.set(message.intendedTick, commands);
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
      tick: snapshot.tick,
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
