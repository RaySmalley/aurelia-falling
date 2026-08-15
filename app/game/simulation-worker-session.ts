import {
  DEFAULT_SNAPSHOT_CADENCE_TICKS,
  DEFAULT_UI_CADENCE_TICKS,
  SIMULATION_RUNTIME_PROTOCOL_VERSION,
  type SimulationRuntimeEvent,
  type SimulationRuntimePauseReason,
} from "./runtime-protocol";
import type { WorkerSimulationRuntime } from "./simulation-worker-client";
import { RenderSnapshotDeltaStore } from "./render-delta";
import type {
  AiDifficulty,
  SimCommand,
  SimulationRenderFrame,
  SimulationScenario,
  SimulationUiSnapshot,
} from "./types";

export const SIMULATION_TICK_INTERVAL_MS = 50;
export const LIVE_COMMAND_INPUT_DELAY_TICKS = 2;

type SimulationWorkerSessionOptions = Readonly<{
  seed: number;
  scenario: SimulationScenario;
  difficulty: AiDifficulty;
  snapshotCadenceTicks?: number;
  uiCadenceTicks?: number;
  now?: () => number;
}>;

type SessionListener = (event: SimulationRuntimeEvent) => void;

export class SimulationWorkerSession {
  private readonly listeners = new Set<SessionListener>();
  private readonly pauseReasons = new Set<SimulationRuntimePauseReason>();
  private readonly now: () => number;
  private readonly snapshotCadenceTicks: number;
  private readonly uiCadenceTicks: number;
  private latestRenderFrame: SimulationRenderFrame | null = null;
  private latestUiSnapshot: SimulationUiSnapshot | null = null;
  private latestRuntimeTick = 0;
  private latestRuntimeTickAt = 0;
  private nextSequence = 0;
  private started = false;
  private terminated = false;
  private readonly renderStore = new RenderSnapshotDeltaStore();

  constructor(
    private readonly runtime: WorkerSimulationRuntime,
    private readonly options: SimulationWorkerSessionOptions,
  ) {
    this.now = options.now ?? (() => Date.now());
    this.snapshotCadenceTicks =
      options.snapshotCadenceTicks ?? DEFAULT_SNAPSHOT_CADENCE_TICKS;
    this.uiCadenceTicks = options.uiCadenceTicks ?? DEFAULT_UI_CADENCE_TICKS;
    this.latestRuntimeTickAt = this.now();
    runtime.subscribe((event) => this.receive(event));
  }

  subscribe(listener: SessionListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  renderSnapshot() {
    return this.renderStore.snapshot();
  }

  renderFrame() {
    return this.latestRenderFrame;
  }

  initialize(timeoutMs = 5_000) {
    if (this.started) {
      return Promise.reject(new Error("Simulation worker session already started."));
    }
    this.started = true;

    return new Promise<SimulationUiSnapshot>((resolve, reject) => {
      let settled = false;
      const settle = (
        outcome: "resolve" | "reject",
        value: SimulationUiSnapshot | Error,
      ) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        unsubscribe();
        if (outcome === "resolve") resolve(value as SimulationUiSnapshot);
        else reject(value);
      };
      const unsubscribe = this.subscribe((event) => {
        if (event.type === "uiSnapshot") {
          settle("resolve", event.snapshot);
        } else if (event.type === "error" && !event.recoverable) {
          settle("reject", new Error(event.message));
        } else if (event.type === "error" && event.code === "worker_failure") {
          settle("reject", new Error(event.message));
        }
      });
      const timeout = setTimeout(
        () =>
          settle(
            "reject",
            new Error("Timed out waiting for the simulation worker."),
          ),
        timeoutMs,
      );
      this.runtime.dispatch({
        protocolVersion: SIMULATION_RUNTIME_PROTOCOL_VERSION,
        type: "initialize",
        seed: this.options.seed,
        scenario: this.options.scenario,
        difficulty: this.options.difficulty,
        snapshotCadenceTicks: this.snapshotCadenceTicks,
        uiCadenceTicks: this.uiCadenceTicks,
      });
    });
  }

  enqueue(command: SimCommand) {
    if (this.terminated || !this.latestUiSnapshot) return null;
    const intendedTick = this.commandTick();
    const sequence = this.nextSequence;
    this.nextSequence += 1;

    if (
      command.kind === "restartCombat" ||
      command.kind === "restartEconomy" ||
      command.kind === "restartSkirmish"
    ) {
      const scenario: SimulationScenario =
        command.kind === "restartCombat"
          ? "combat"
          : command.kind === "restartEconomy"
            ? "economy"
            : "skirmish";
      this.runtime.dispatch({
        protocolVersion: SIMULATION_RUNTIME_PROTOCOL_VERSION,
        type: "restart",
        sequence,
        intendedTick,
        seed: command.seed ?? this.latestUiSnapshot.seed,
        scenario,
        difficulty:
          command.kind === "restartSkirmish"
            ? command.difficulty ?? this.latestUiSnapshot.ai.profile
            : this.latestUiSnapshot.ai.profile,
      });
      return intendedTick;
    }

    this.runtime.dispatch({
      protocolVersion: SIMULATION_RUNTIME_PROTOCOL_VERSION,
      type: "command",
      sequence,
      intendedTick,
      command,
    });
    return intendedTick;
  }

  pause(reason: SimulationRuntimePauseReason) {
    if (this.terminated) return;
    this.pauseReasons.add(reason);
    this.runtime.dispatch({
      protocolVersion: SIMULATION_RUNTIME_PROTOCOL_VERSION,
      type: "pause",
      reason,
    });
  }

  resume() {
    if (this.terminated) return;
    const reasons = [...this.pauseReasons];
    this.latestRuntimeTickAt = this.now();
    this.pauseReasons.clear();
    for (const reason of reasons) {
      this.runtime.dispatch({
        protocolVersion: SIMULATION_RUNTIME_PROTOCOL_VERSION,
        type: "resume",
        reason,
      });
    }
  }

  terminate() {
    if (this.terminated) return;
    this.terminated = true;
    this.listeners.clear();
    this.runtime.terminate();
  }

  private commandTick() {
    if (this.pauseReasons.size > 0) return this.latestRuntimeTick;
    const elapsedTicks = Math.floor(
      Math.max(0, this.now() - this.latestRuntimeTickAt) /
        SIMULATION_TICK_INTERVAL_MS,
    );
    return (
      this.latestRuntimeTick + elapsedTicks + LIVE_COMMAND_INPUT_DELAY_TICKS
    );
  }

  private receive(event: SimulationRuntimeEvent) {
    if (this.terminated) return;
    if (event.tick !== null) {
      const advancesRuntimeTick = event.tick > this.latestRuntimeTick;
      this.latestRuntimeTick = Math.max(this.latestRuntimeTick, event.tick);
      if (event.type === "uiSnapshot") {
        if (advancesRuntimeTick) this.latestRuntimeTickAt = this.now();
      } else {
        this.latestRuntimeTickAt =
          event.type === "snapshot" && event.publishedAtMs !== undefined
            ? event.publishedAtMs
            : this.now();
      }
    }
    if (event.type === "snapshot") {
      try {
        this.renderStore.apply(event.renderDelta);
      } catch (error) {
        this.failRenderChannel(error, event.tick);
        return;
      }
      this.latestRenderFrame = event.snapshot;
    }
    if (event.type === "uiSnapshot") this.latestUiSnapshot = event.snapshot;
    if (event.type === "pauseChanged") {
      this.pauseReasons.clear();
      for (const reason of event.reasons) this.pauseReasons.add(reason);
    }
    if (event.type === "terminated") this.terminated = true;
    for (const listener of [...this.listeners]) listener(event);
  }

  private failRenderChannel(error: unknown, tick: number) {
    const failure: SimulationRuntimeEvent = {
      protocolVersion: SIMULATION_RUNTIME_PROTOCOL_VERSION,
      type: "error",
      code: "invalid_message",
      message:
        error instanceof Error
          ? `Render channel failed: ${error.message}`
          : "Render channel failed with an invalid delta.",
      recoverable: false,
      tick,
    };
    this.runtime.terminate();
    this.terminated = true;
    for (const listener of [...this.listeners]) listener(failure);
  }
}
