"use client";

import { WorkerSimulationRuntime } from "./simulation-worker-client";
import simulationWorkerUrl from "./simulation-worker-entry.ts?worker&url";

export function createBrowserSimulationWorkerRuntime(
  reportListenerError?: (error: unknown) => void,
) {
  const worker = new Worker(
    new URL(simulationWorkerUrl, window.location.origin),
    { type: "module", name: "aurelia-simulation" },
  );

  return new WorkerSimulationRuntime(
    {
      postMessage: (message) => worker.postMessage(message),
      subscribe(listener) {
        const onMessage = (event: MessageEvent<unknown>) => listener(event.data);
        worker.addEventListener("message", onMessage);
        return () => worker.removeEventListener("message", onMessage);
      },
      subscribeFailure(listener) {
        const onError = (event: ErrorEvent) => listener(event.error ?? event.message);
        const onMessageError = () =>
          listener(new Error("The simulation worker returned an unreadable message."));
        worker.addEventListener("error", onError);
        worker.addEventListener("messageerror", onMessageError);
        return () => {
          worker.removeEventListener("error", onError);
          worker.removeEventListener("messageerror", onMessageError);
        };
      },
      terminate: () => worker.terminate(),
    },
    reportListenerError,
  );
}
