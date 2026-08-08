import { parentPort, workerData } from "node:worker_threads";
import { createServer } from "vite";

if (!parentPort) throw new Error("Simulation worker requires a parent port.");

const vite = await createServer({
  root: workerData.root,
  configFile: false,
  logLevel: "silent",
  server: { middlewareMode: true },
});
const { startSimulationWorkerHost } = await vite.ssrLoadModule(
  "/app/game/simulation-worker-host.ts",
);
const heartbeat = new Int32Array(workerData.heartbeat);

let closing = false;
const close = async () => {
  if (closing) return;
  closing = true;
  await vite.close();
  parentPort.close();
};

startSimulationWorkerHost({
  postMessage(event) {
    if (event.type === "snapshot") Atomics.store(heartbeat, 0, event.tick);
    parentPort.postMessage(event);
    if (event.type === "terminated") queueMicrotask(close);
  },
  subscribe(listener) {
    parentPort.on("message", listener);
    return () => parentPort.off("message", listener);
  },
});
