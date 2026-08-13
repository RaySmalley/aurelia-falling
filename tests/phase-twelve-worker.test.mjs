import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { createServer } from "vite";
import {
  evaluateAcceptanceGate,
  parseArguments as parseWorkerBenchmarkArguments,
} from "../scripts/run-worker-benchmark.mjs";

const execFileAsync = promisify(execFile);
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
const workerSessionModule = await vite.ssrLoadModule(
  "/app/game/simulation-worker-session.ts",
);
const { SIMULATION_RUNTIME_PROTOCOL_VERSION: version } = protocolModule;
const { InProcessSimulationRuntime } = runtimeModule;
const { WorkerSimulationRuntime } = workerClientModule;
const {
  LIVE_COMMAND_INPUT_DELAY_TICKS,
  SimulationWorkerSession,
} = workerSessionModule;

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

function waitForEvent(runtime, predicate, timeoutMs = 15_000) {
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

function initialSnapshot() {
  const runtime = new InProcessSimulationRuntime();
  let snapshotEvent;
  runtime.subscribe((event) => {
    if (event.type === "snapshot") snapshotEvent = event;
  });
  runtime.dispatch(initialize());
  return snapshotEvent;
}

test("live session initialization uses the versioned worker protocol", async () => {
  const controlled = createControlledTransport();
  const runtime = new WorkerSimulationRuntime(controlled.transport);
  const session = new SimulationWorkerSession(runtime, {
    seed: 8_808,
    scenario: "skirmish",
    difficulty: "hard",
  });
  const initialized = session.initialize();

  assert.deepEqual(controlled.posted, [
    {
      protocolVersion: version,
      type: "initialize",
      seed: 8_808,
      scenario: "skirmish",
      difficulty: "hard",
      snapshotCadenceTicks: 2,
    },
  ]);
  const { snapshot, renderDelta } = initialSnapshot();
  controlled.emit({
    protocolVersion: version,
    type: "snapshot",
    tick: 0,
    snapshot,
    renderDelta,
  });
  assert.equal(await initialized, snapshot);
  session.terminate();
});

test("live command scheduling stays ahead of a worker after a main-thread stall", async () => {
  let now = 0;
  const controlled = createControlledTransport();
  const runtime = new WorkerSimulationRuntime(controlled.transport);
  const session = new SimulationWorkerSession(runtime, {
    seed: 4_115,
    scenario: "skirmish",
    difficulty: "normal",
    now: () => now,
  });
  const initialized = session.initialize();
  const { snapshot, renderDelta } = initialSnapshot();
  controlled.emit({
    protocolVersion: version,
    type: "snapshot",
    tick: 10,
    snapshot,
    renderDelta,
  });
  await initialized;

  now = 260;
  session.enqueue({ kind: "stop" });
  const posted = controlled.posted.at(-1);
  assert.equal(posted.type, "command");
  assert.equal(posted.intendedTick, 15 + LIVE_COMMAND_INPUT_DELAY_TICKS);
  session.terminate();
});

test("delayed snapshot delivery preserves the worker publication clock", async () => {
  let now = 0;
  const controlled = createControlledTransport();
  const runtime = new WorkerSimulationRuntime(controlled.transport);
  const session = new SimulationWorkerSession(runtime, {
    seed: 4_115,
    scenario: "skirmish",
    difficulty: "normal",
    now: () => now,
  });
  const initialized = session.initialize();
  const { snapshot, renderDelta } = initialSnapshot();
  now = 260;
  controlled.emit({
    protocolVersion: version,
    type: "snapshot",
    tick: 2,
    publishedAtMs: 100,
    snapshot,
    renderDelta,
  });
  await initialized;

  session.enqueue({ kind: "stop" });
  assert.equal(
    controlled.posted.at(-1).intendedTick,
    5 + LIVE_COMMAND_INPUT_DELAY_TICKS,
  );
  session.terminate();
});

test("paused live-session restarts target the frozen tick and resume explicitly", async () => {
  const controlled = createControlledTransport();
  const runtime = new WorkerSimulationRuntime(controlled.transport);
  const session = new SimulationWorkerSession(runtime, {
    seed: 4_115,
    scenario: "skirmish",
    difficulty: "normal",
    now: () => 0,
  });
  const initialized = session.initialize();
  const { snapshot, renderDelta } = initialSnapshot();
  controlled.emit({
    protocolVersion: version,
    type: "snapshot",
    tick: 12,
    snapshot,
    renderDelta,
  });
  await initialized;
  session.pause("manual");
  controlled.emit({
    protocolVersion: version,
    type: "pauseChanged",
    paused: true,
    reasons: ["manual"],
    tick: 12,
  });

  session.enqueue({
    kind: "restartSkirmish",
    seed: 9_900,
    difficulty: "hard",
  });
  assert.deepEqual(controlled.posted.at(-1), {
    protocolVersion: version,
    type: "restart",
    sequence: 0,
    intendedTick: 12,
    seed: 9_900,
    scenario: "skirmish",
    difficulty: "hard",
  });
  session.resume();
  assert.deepEqual(controlled.posted.at(-1), {
    protocolVersion: version,
    type: "resume",
    reason: "manual",
  });
  session.terminate();
});

test("resuming rebases command scheduling after a long pause", async () => {
  let now = 0;
  const controlled = createControlledTransport();
  const runtime = new WorkerSimulationRuntime(controlled.transport);
  const session = new SimulationWorkerSession(runtime, {
    seed: 4_115,
    scenario: "skirmish",
    difficulty: "normal",
    now: () => now,
  });
  const initialized = session.initialize();
  const { snapshot, renderDelta } = initialSnapshot();
  controlled.emit({
    protocolVersion: version,
    type: "snapshot",
    tick: 12,
    snapshot,
    renderDelta,
  });
  await initialized;
  session.pause("manual");
  controlled.emit({
    protocolVersion: version,
    type: "pauseChanged",
    paused: true,
    reasons: ["manual"],
    tick: 12,
  });

  now = 120_000;
  session.resume();
  const intendedTick = session.enqueue({ kind: "surrender" });

  assert.equal(intendedTick, 12 + LIVE_COMMAND_INPUT_DELAY_TICKS);
  assert.equal(controlled.posted.at(-1).intendedTick, intendedTick);
  session.terminate();
});

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
  const initialSnapshot = waitForEvent(
    runtime,
    (event) => event.type === "snapshot" && event.tick === 0,
  );
  runtime.dispatch(initialize({ snapshotCadenceTicks: 2 }));
  await ready;
  await initialSnapshot;

  try {
    const advanced = waitForEvent(
      runtime,
      (event) => event.type === "snapshot" && event.tick >= 4,
    );
    const blockedUntil = performance.now() + 1_000;
    while (performance.now() < blockedUntil) {
      // Deliberately occupy the parent event loop; the simulation owns another thread.
    }
    assert.ok(Atomics.load(heartbeat, 0) >= 4);
    const event = await advanced;
    assert.ok(event.tick >= 4);
  } finally {
    runtime.terminate();
    await worker.terminate();
  }
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

test("worker benchmark arguments preserve the Phase 12 acceptance workload", () => {
  assert.deepEqual(parseWorkerBenchmarkArguments([]), {
    maxTickMs: 50,
    measuredTicks: 100,
    output: null,
    seed: 12_600,
    snapshotCadenceTicks: 2,
    unitCount: 600,
    warmupTicks: 20,
  });
  assert.throws(
    () => parseWorkerBenchmarkArguments(["--units", "600units"]),
    /must be a positive integer/,
  );
  assert.throws(
    () => parseWorkerBenchmarkArguments(["--max-tick-ms", "0"]),
    /must be a positive number/,
  );
});

test("overridden worker benchmark runs are explicitly diagnostic", async () => {
  const { stdout } = await execFileAsync(
    process.execPath,
    [
      "scripts/run-worker-benchmark.mjs",
      "--units",
      "20",
      "--warmup",
      "0",
      "--ticks",
      "3",
      "--seed",
      "12601",
      "--max-tick-ms",
      "1000",
    ],
    { cwd: root, maxBuffer: 4 * 1024 * 1024 },
  );
  const report = JSON.parse(stdout);

  assert.equal(report.schemaVersion, 2);
  assert.equal(report.benchmark.simulationRateHz, 20);
  assert.equal(report.benchmark.tickIntervalMs, 50);
  assert.equal(report.benchmark.workload, "normal-skirmish");
  assert.equal(report.result.host, "startSimulationWorkerHost");
  assert.equal(report.result.scenario, "skirmish");
  assert.equal(report.result.difficulty, "normal");
  assert.equal(report.result.unitCount, 20);
  assert.equal(typeof report.result.finalUnitCount, "number");
  assert.equal(report.result.completedTicks, 3);
  assert.equal(report.result.snapshotCount, 1);
  assert.equal(report.result.tickTiming.sampleCount, 3);
  assert.equal(report.result.scheduleLateness.sampleCount, 3);
  assert.equal(report.gate.mode, "diagnostic");
  assert.equal(report.gate.checks, null);
  assert.deepEqual(report.gate.diagnosticReasons, ["parameters"]);
  assert.equal(report.gate.passed, null);
  assert.deepEqual(report.gate.acceptanceProfile, {
    maxTickMs: 50,
    measuredTicks: 100,
    nodeVersion: "v24.19.0",
    seed: 12_600,
    snapshotCadenceTicks: 2,
    unitCount: 600,
    warmupTicks: 20,
  });
});

test("worker acceptance gate verifies the fixed workload and snapshot cadence", () => {
  const options = parseWorkerBenchmarkArguments([]);
  const result = {
    completedTicks: 100,
    difficulty: "normal",
    finalUnitCount: 411,
    host: "startSimulationWorkerHost",
    missedDeadlines: 0,
    scenario: "skirmish",
    snapshotCount: 50,
    unitCount: 600,
  };
  const passing = evaluateAcceptanceGate(
    options,
    result,
    { worstMs: 49 },
    "v24.19.0",
  );

  assert.equal(passing.mode, "acceptance");
  assert.deepEqual(passing.diagnosticReasons, []);
  assert.deepEqual(passing.checks, {
    productionHost: true,
    normalSkirmish: true,
    unitCount: true,
    completedTicks: true,
    snapshotCadence: true,
    tickBudget: true,
    fixedCadence: true,
  });
  assert.equal(passing.passed, true);

  const missingSnapshot = evaluateAcceptanceGate(
    options,
    { ...result, snapshotCount: 49 },
    { worstMs: 49 },
    "v24.19.0",
  );
  assert.equal(missingSnapshot.checks.snapshotCadence, false);
  assert.equal(missingSnapshot.passed, false);

  const syntheticLoop = evaluateAcceptanceGate(
    options,
    { ...result, host: "synthetic" },
    { worstMs: 49 },
    "v24.19.0",
  );
  assert.equal(syntheticLoop.checks.productionHost, false);
  assert.equal(syntheticLoop.passed, false);

  const alternateSeed = evaluateAcceptanceGate(
    { ...options, seed: 0 },
    result,
    { worstMs: 49 },
    "v24.19.0",
  );
  assert.equal(alternateSeed.mode, "diagnostic");
  assert.deepEqual(alternateSeed.diagnosticReasons, ["parameters"]);
  assert.equal(alternateSeed.passed, null);

  const alternateRuntime = evaluateAcceptanceGate(
    options,
    result,
    { worstMs: 49 },
    "v24.18.0",
  );
  assert.equal(alternateRuntime.mode, "diagnostic");
  assert.deepEqual(alternateRuntime.diagnosticReasons, ["runtime"]);
  assert.equal(alternateRuntime.passed, null);
});
