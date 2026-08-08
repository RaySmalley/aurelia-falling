import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const workerEntry = new URL("./fixtures/simulation-worker-thread.mjs", import.meta.url);
const vite = await createServer({
  root,
  configFile: false,
  logLevel: "silent",
  server: { middlewareMode: true },
});
const protocolModule = await vite.ssrLoadModule(
  "/app/game/runtime-protocol.ts",
);
const runtimeModule = await vite.ssrLoadModule(
  "/app/game/simulation-runtime.ts",
);
const workerClientModule = await vite.ssrLoadModule(
  "/app/game/simulation-worker-client.ts",
);
const { SIMULATION_RUNTIME_PROTOCOL_VERSION: version } = protocolModule;
const { InProcessSimulationRuntime } = runtimeModule;
const { WorkerSimulationRuntime } = workerClientModule;

test.after(() => vite.close());

const initialize = (overrides = {}) => ({
  protocolVersion: version,
  type: "initialize",
  seed: 4_115,
  scenario: "skirmish",
  difficulty: "normal",
  snapshotCadenceTicks: 1,
  ...overrides,
});

const command = (sequence, intendedTick, value) => ({
  protocolVersion: version,
  type: "command",
  sequence,
  intendedTick,
  command: value,
});

function createNodeWorkerRuntime() {
  const heartbeat = new Int32Array(new SharedArrayBuffer(4));
  const worker = new Worker(workerEntry, {
    workerData: { root, heartbeat: heartbeat.buffer },
  });
  const runtime = new WorkerSimulationRuntime({
    postMessage: (message) => worker.postMessage(message),
    subscribe(listener) {
      worker.on("message", listener);
      return () => worker.off("message", listener);
    },
    subscribeFailure(listener) {
      const onError = (error) => listener(error);
      const onExit = (code) => {
        if (code !== 0) listener(new Error(`Simulation worker exited with code ${code}.`));
      };
      worker.on("error", onError);
      worker.on("exit", onExit);
      return () => {
        worker.off("error", onError);
        worker.off("exit", onExit);
      };
    },
    terminate: () => worker.terminate(),
  });
  return { runtime, worker, heartbeat };
}

function createControlledTransport() {
  let eventListener = () => {};
  let failureListener = () => {};
  const posted = [];
  let terminations = 0;
  const transport = {
    postMessage: (message) => posted.push(message),
    subscribe(listener) {
      eventListener = listener;
      return () => {
        eventListener = () => {};
      };
    },
    subscribeFailure(listener) {
      failureListener = listener;
      return () => {
        failureListener = () => {};
      };
    },
    terminate() {
      terminations += 1;
    },
  };
  return {
    transport,
    emit: (event) => eventListener(event),
    fail: (error) => failureListener(error),
    posted,
    terminations: () => terminations,
  };
}

function waitForEvent(runtime, predicate, timeoutMs = 5_000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error("Timed out waiting for a simulation worker event."));
    }, timeoutMs);
    const unsubscribe = runtime.subscribe((event) => {
      if (!predicate(event)) return;
      clearTimeout(timeout);
      unsubscribe();
      resolve(event);
    });
  });
}

test("worker thread and in-process runtime publish identical checkpoints", async () => {
  const oracle = new InProcessSimulationRuntime();
  const oracleSnapshots = new Map();
  oracle.subscribe((event) => {
    if (event.type === "snapshot") oracleSnapshots.set(event.tick, event.snapshot);
  });

  const scheduled = [
    command(0, 1, { kind: "selectUnits", unitIds: [1, 2], additive: false }),
    command(1, 2, { kind: "move", target: { x: 18, y: 18 }, mode: "move" }),
    command(2, 5, { kind: "stop" }),
  ];
  oracle.dispatch(initialize());
  for (const queued of scheduled) oracle.dispatch(queued);
  oracle.advance(8);

  const { runtime, worker } = createNodeWorkerRuntime();
  const workerSnapshots = new Map();
  runtime.subscribe((event) => {
    if (event.type === "snapshot") workerSnapshots.set(event.tick, event.snapshot);
  });
  const checkpoint = waitForEvent(
    runtime,
    (event) => event.type === "snapshot" && event.tick === 8,
  );
  runtime.dispatch(initialize());
  for (const queued of scheduled) runtime.dispatch(queued);
  await checkpoint;

  assert.deepEqual([...workerSnapshots.keys()], [...oracleSnapshots.keys()]);
  for (const tick of oracleSnapshots.keys()) {
    assert.deepEqual(workerSnapshots.get(tick), oracleSnapshots.get(tick));
  }

  runtime.terminate();
  await worker.terminate();
});

test("a blocked main thread does not stop the worker-owned fixed-step clock", async () => {
  const { runtime, worker, heartbeat } = createNodeWorkerRuntime();
  const ready = waitForEvent(runtime, (event) => event.type === "ready");
  runtime.dispatch(initialize({ snapshotCadenceTicks: 2 }));
  await ready;

  const advanced = waitForEvent(
    runtime,
    (event) => event.type === "snapshot" && event.tick >= 4,
  );
  const blockedUntil = performance.now() + 260;
  while (performance.now() < blockedUntil) {
    // Deliberately occupy the parent event loop; the simulation owns another thread.
  }
  assert.ok(Atomics.load(heartbeat, 0) >= 4);
  const event = await advanced;
  assert.ok(event.tick >= 4);

  runtime.terminate();
  await worker.terminate();
});

test("worker termination surfaces a recoverable structured failure", async () => {
  const { runtime, worker } = createNodeWorkerRuntime();
  const ready = waitForEvent(runtime, (event) => event.type === "ready");
  runtime.dispatch(initialize());
  await ready;

  const failure = waitForEvent(
    runtime,
    (event) => event.type === "error" && event.code === "worker_failure",
  );
  await worker.terminate();
  const event = await failure;
  assert.equal(event.recoverable, true);
  assert.equal(event.tick, null);
});

test("host-reported worker failures close the transport and reject later work", () => {
  const controlled = createControlledTransport();
  const runtime = new WorkerSimulationRuntime(controlled.transport);
  const events = [];
  runtime.subscribe((event) => events.push(event));

  controlled.emit({
    protocolVersion: version,
    type: "error",
    code: "worker_failure",
    message: "worker host failed",
    recoverable: true,
    tick: 3,
  });
  runtime.dispatch(initialize());

  assert.equal(events.at(-1).code, "worker_failure");
  assert.equal(controlled.terminations(), 1);
  assert.deepEqual(controlled.posted, []);
});

test("terminating before readiness closes the transport directly", () => {
  const controlled = createControlledTransport();
  const runtime = new WorkerSimulationRuntime(controlled.transport);

  runtime.terminate();

  assert.equal(controlled.terminations(), 1);
  assert.deepEqual(controlled.posted, []);
});
