import {
  SIMULATION_RUNTIME_PROTOCOL_VERSION,
  type SimulationRuntimeEvent,
} from "./runtime-protocol";
import { InProcessSimulationRuntime } from "./simulation-runtime";

export const SIMULATION_TICK_RATE = 20;
export const SIMULATION_TICK_INTERVAL_MS = 1_000 / SIMULATION_TICK_RATE;

export type SimulationWorkerHostPort = Readonly<{
  postMessage(event: SimulationRuntimeEvent): void;
  subscribe(listener: (message: unknown) => void): () => void;
}>;

export type SimulationWorkerClock = Readonly<{
  start(tick: () => void): void;
  stop(): void;
}>;

export function createIntervalSimulationClock(
  intervalMs = SIMULATION_TICK_INTERVAL_MS,
): SimulationWorkerClock {
  let interval: ReturnType<typeof setInterval> | null = null;
  return {
    start(tick) {
      if (interval !== null) return;
      interval = setInterval(tick, intervalMs);
    },
    stop() {
      if (interval === null) return;
      clearInterval(interval);
      interval = null;
    },
  };
}

export function startSimulationWorkerHost(
  port: SimulationWorkerHostPort,
  clock: SimulationWorkerClock = createIntervalSimulationClock(),
) {
  const runtime = new InProcessSimulationRuntime();
  let started = false;
  let stopped = false;
  let unsubscribeMessage = () => {};
  let unsubscribeRuntime = () => {};

  const stop = () => {
    if (stopped) return;
    stopped = true;
    clock.stop();
    unsubscribeMessage();
    unsubscribeRuntime();
  };

  const fail = (error: unknown) => {
    if (stopped) return;
    port.postMessage({
      protocolVersion: SIMULATION_RUNTIME_PROTOCOL_VERSION,
      type: "error",
      code: "worker_failure",
      message:
        error instanceof Error
          ? error.message
          : "The simulation worker failed unexpectedly.",
      recoverable: true,
      tick: runtime.tick(),
    });
    stop();
  };

  unsubscribeRuntime = runtime.subscribe((event) => {
    port.postMessage(event);
    if (event.type === "ready" && !started) {
      started = true;
      clock.start(() => {
        try {
          runtime.advance();
        } catch (error) {
          fail(error);
        }
      });
    }
    if (event.type === "terminated") stop();
  });

  unsubscribeMessage = port.subscribe((message) => {
    if (stopped) return;
    try {
      runtime.dispatch(message);
    } catch (error) {
      fail(error);
    }
  });

  return Object.freeze({ stop });
}
