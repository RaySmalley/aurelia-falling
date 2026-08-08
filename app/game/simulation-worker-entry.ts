import { startSimulationWorkerHost } from "./simulation-worker-host";

type WorkerScope = Readonly<{
  postMessage(message: unknown): void;
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<unknown>) => void,
  ): void;
  removeEventListener(
    type: "message",
    listener: (event: MessageEvent<unknown>) => void,
  ): void;
}>;

const scope = globalThis as unknown as WorkerScope;

startSimulationWorkerHost({
  postMessage: (event) => scope.postMessage(event),
  subscribe(listener) {
    const onMessage = (event: MessageEvent<unknown>) => listener(event.data);
    scope.addEventListener("message", onMessage);
    return () => scope.removeEventListener("message", onMessage);
  },
});
