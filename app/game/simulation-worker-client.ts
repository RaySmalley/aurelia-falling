import {
  SIMULATION_RUNTIME_PROTOCOL_VERSION,
  type SimulationRuntimeEvent,
  type SimulationRuntimeRequest,
} from "./runtime-protocol";
import type { SimulationRuntimeEventListener } from "./simulation-runtime";

export type SimulationWorkerTransport = Readonly<{
  postMessage(message: SimulationRuntimeRequest): void;
  subscribe(listener: (event: unknown) => void): () => void;
  subscribeFailure(listener: (error: unknown) => void): () => void;
  terminate(): void;
}>;

export class WorkerSimulationRuntime {
  private readonly listeners = new Set<SimulationRuntimeEventListener>();
  private unsubscribeEvent: () => void = () => {};
  private unsubscribeFailure: () => void = () => {};
  private cleanedUp = false;
  private failed = false;
  private ready = false;
  private terminated = false;

  constructor(
    private readonly transport: SimulationWorkerTransport,
    private readonly reportListenerError: (error: unknown) => void = () => {},
  ) {
    this.unsubscribeEvent = transport.subscribe((event) => {
      if (!this.isRuntimeEvent(event) || this.failed) return;
      if (event.type === "ready") this.ready = true;
      if (event.type === "error" && event.code === "worker_failure") {
        this.failed = true;
      }
      if (event.type === "terminated") this.terminated = true;
      this.emit(event);
      if (
        event.type === "terminated" ||
        (event.type === "error" && event.code === "worker_failure")
      ) {
        this.cleanupTransport();
      }
    });
    this.unsubscribeFailure = transport.subscribeFailure((error) =>
      this.fail(error),
    );
  }

  subscribe(listener: SimulationRuntimeEventListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispatch(message: SimulationRuntimeRequest) {
    if (this.failed || this.terminated) return;
    try {
      this.transport.postMessage(message);
    } catch (error) {
      this.fail(error);
    }
  }

  terminate() {
    if (this.failed || this.terminated) return;
    if (!this.ready) {
      this.terminated = true;
      this.cleanupTransport();
      return;
    }
    this.dispatch({
      protocolVersion: SIMULATION_RUNTIME_PROTOCOL_VERSION,
      type: "terminate",
    });
  }

  private fail(error: unknown) {
    if (this.failed || this.terminated) return;
    this.failed = true;
    this.emit({
      protocolVersion: SIMULATION_RUNTIME_PROTOCOL_VERSION,
      type: "error",
      code: "worker_failure",
      message:
        error instanceof Error
          ? error.message
          : "The simulation worker transport failed.",
      recoverable: true,
      tick: null,
    });
    this.cleanupTransport();
  }

  private cleanupTransport() {
    if (this.cleanedUp) return;
    this.cleanedUp = true;
    this.unsubscribeEvent();
    this.unsubscribeFailure();
    this.transport.terminate();
  }

  private emit(event: SimulationRuntimeEvent) {
    const immutableEvent = Object.freeze(event);
    for (const listener of [...this.listeners]) {
      try {
        listener(immutableEvent);
      } catch (error) {
        try {
          this.reportListenerError(error);
        } catch {
          // Presentation error reporting cannot affect worker ownership.
        }
      }
    }
  }

  private isRuntimeEvent(event: unknown): event is SimulationRuntimeEvent {
    if (typeof event !== "object" || event === null) return false;
    const candidate = event as Partial<SimulationRuntimeEvent>;
    return (
      candidate.protocolVersion === SIMULATION_RUNTIME_PROTOCOL_VERSION &&
      (candidate.type === "ready" ||
        candidate.type === "snapshot" ||
        candidate.type === "uiSnapshot" ||
        candidate.type === "pauseChanged" ||
        candidate.type === "terminated" ||
        candidate.type === "error")
    );
  }
}
