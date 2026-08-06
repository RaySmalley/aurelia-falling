import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
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
const simulationModule = await vite.ssrLoadModule(
  "/app/game/simulation.ts",
);
const { SIMULATION_RUNTIME_PROTOCOL_VERSION: version } = protocolModule;
const { InProcessSimulationRuntime } = runtimeModule;
const { Simulation } = simulationModule;

test.after(() => vite.close());

const initialize = (overrides = {}) => ({
  protocolVersion: version,
  type: "initialize",
  seed: 4_115,
  scenario: "skirmish",
  difficulty: "normal",
  ...overrides,
});

const command = (sequence, intendedTick, value) => ({
  protocolVersion: version,
  type: "command",
  sequence,
  intendedTick,
  command: value,
});

const restart = (sequence, intendedTick, overrides = {}) => ({
  protocolVersion: version,
  type: "restart",
  sequence,
  intendedTick,
  seed: 4_115,
  scenario: "skirmish",
  difficulty: "normal",
  ...overrides,
});

test("runtime protocol initializes and publishes snapshots at a fixed cadence", () => {
  const runtime = new InProcessSimulationRuntime();
  const events = [];
  runtime.subscribe((event) => events.push(event));

  runtime.dispatch(initialize({ snapshotCadenceTicks: 2 }));
  assert.deepEqual(events.map((event) => event.type), ["ready", "snapshot"]);
  assert.equal(events[1].tick, 0);

  runtime.advance(5);
  assert.deepEqual(
    events.filter((event) => event.type === "snapshot").map((event) => event.tick),
    [0, 2, 4],
  );
  assert.equal(runtime.tick(), 5);
});

test("runtime constructs full snapshots only on publication ticks", () => {
  const runtime = new InProcessSimulationRuntime();
  runtime.dispatch(initialize({ snapshotCadenceTicks: 3 }));
  const simulation = runtime.simulation;
  const snapshot = simulation.snapshot.bind(simulation);
  let snapshotCalls = 0;
  simulation.snapshot = () => {
    snapshotCalls += 1;
    return snapshot();
  };

  runtime.advance(2);
  assert.equal(snapshotCalls, 0);
  runtime.advance();
  assert.equal(snapshotCalls, 1);
});

test("same-tick commands apply in sequence order rather than arrival order", () => {
  const runtime = new InProcessSimulationRuntime();
  runtime.dispatch(initialize());
  runtime.dispatch(
    restart(2, 0, {
      seed: 222,
      difficulty: "hard",
    }),
  );
  runtime.dispatch(
    restart(1, 0, {
      seed: 111,
      difficulty: "easy",
    }),
  );

  runtime.advance();
  const state = runtime.authoritativeState();
  assert.equal(state.seed, 222);
  assert.equal(state.aiDifficulty, "hard");
});

test("future commands wait for their intended tick and late commands fail closed", () => {
  const runtime = new InProcessSimulationRuntime();
  const events = [];
  runtime.subscribe((event) => events.push(event));
  runtime.dispatch(initialize());
  runtime.dispatch(command(1, 2, { kind: "surrender" }));

  runtime.advance(2);
  assert.equal(runtime.authoritativeState().status, "active");
  runtime.advance();
  assert.equal(runtime.authoritativeState().status, "defeat");

  runtime.dispatch(command(2, 1, { kind: "stop" }));
  assert.equal(events.at(-1).type, "error");
  assert.equal(events.at(-1).code, "late_command");
  assert.equal(events.at(-1).recoverable, true);
});

test("pause and resume are explicit and never accumulate catch-up work", () => {
  const runtime = new InProcessSimulationRuntime();
  runtime.dispatch(initialize());
  runtime.dispatch({
    protocolVersion: version,
    type: "pause",
    reason: "hidden",
  });

  assert.equal(runtime.advance(20), 0);
  assert.equal(runtime.tick(), 0);
  runtime.dispatch({
    protocolVersion: version,
    type: "resume",
    reason: "hidden",
  });
  assert.equal(runtime.advance(), 1);
  assert.equal(runtime.tick(), 1);
});

test("visibility resumes preserve an independent manual pause", () => {
  const runtime = new InProcessSimulationRuntime();
  const events = [];
  runtime.subscribe((event) => events.push(event));
  runtime.dispatch(initialize());
  runtime.dispatch({
    protocolVersion: version,
    type: "pause",
    reason: "manual",
  });
  runtime.dispatch({
    protocolVersion: version,
    type: "pause",
    reason: "hidden",
  });
  runtime.dispatch({
    protocolVersion: version,
    type: "resume",
    reason: "hidden",
  });

  assert.equal(runtime.advance(), 0);
  assert.deepEqual(events.at(-1).reasons, ["manual"]);
  runtime.dispatch({
    protocolVersion: version,
    type: "resume",
    reason: "manual",
  });
  assert.equal(runtime.advance(), 1);
});

test("restart keeps the protocol clock monotonic and clears old future work", () => {
  const runtime = new InProcessSimulationRuntime();
  const snapshots = [];
  runtime.subscribe((event) => {
    if (event.type === "snapshot") snapshots.push(event);
  });
  runtime.dispatch(initialize({ snapshotCadenceTicks: 1 }));
  runtime.advance(3);
  runtime.dispatch(restart(1, 3, { seed: 9_001 }));
  runtime.dispatch(command(2, 5, { kind: "surrender" }));

  runtime.advance(4);
  assert.equal(runtime.tick(), 7);
  assert.equal(snapshots.at(-1).tick, 7);
  assert.equal(snapshots.at(-1).snapshot.tick, 4);
  assert.equal(runtime.authoritativeState().seed, 9_001);
  assert.equal(runtime.authoritativeState().status, "active");
});

test("termination is final even when requested during a multi-tick advance", () => {
  const runtime = new InProcessSimulationRuntime();
  runtime.dispatch(initialize({ snapshotCadenceTicks: 1 }));
  runtime.subscribe((event) => {
    if (event.type === "snapshot" && event.tick === 1) {
      runtime.dispatch({ protocolVersion: version, type: "terminate" });
    }
  });

  assert.equal(runtime.advance(10), 1);
  assert.equal(runtime.tick(), 1);
  assert.equal(runtime.advance(10), 0);
  assert.equal(runtime.tick(), 1);
});

test("termination reentered from ready suppresses the initial snapshot", () => {
  const runtime = new InProcessSimulationRuntime();
  const events = [];
  runtime.subscribe((event) => {
    events.push(event);
    if (event.type === "ready") {
      runtime.dispatch({ protocolVersion: version, type: "terminate" });
    }
  });

  runtime.dispatch(initialize());
  assert.deepEqual(events.map((event) => event.type), ["ready", "terminated"]);
  assert.equal(runtime.advance(), 0);
});

test("ready listeners cannot advance ahead of the initial snapshot", () => {
  const runtime = new InProcessSimulationRuntime();
  const events = [];
  const advances = [];
  runtime.subscribe((event) => {
    events.push(event);
    if (event.type === "ready") advances.push(runtime.advance());
  });

  runtime.dispatch(initialize({ snapshotCadenceTicks: 1 }));
  assert.deepEqual(advances, [0]);
  assert.deepEqual(events.map((event) => event.type), ["ready", "snapshot"]);
  assert.equal(events.at(-1).tick, 0);
  assert.equal(events.at(-1).snapshot.tick, 0);
  assert.equal(runtime.tick(), 0);
});

test("a reentrant pause stops the current multi-tick batch", () => {
  const runtime = new InProcessSimulationRuntime();
  runtime.dispatch(initialize({ snapshotCadenceTicks: 1 }));
  runtime.subscribe((event) => {
    if (event.type === "snapshot" && event.tick === 1) {
      runtime.dispatch({
        protocolVersion: version,
        type: "pause",
        reason: "manual",
      });
    }
  });

  assert.equal(runtime.advance(10), 1);
  assert.equal(runtime.tick(), 1);
});

test("nested runtime events reach every listener in FIFO order", () => {
  const runtime = new InProcessSimulationRuntime();
  runtime.dispatch(initialize({ snapshotCadenceTicks: 1 }));
  const firstEvents = [];
  const secondEvents = [];
  runtime.subscribe((event) => {
    firstEvents.push(event.type);
    if (event.type === "snapshot") {
      runtime.dispatch({ protocolVersion: version, type: "terminate" });
    }
  });
  runtime.subscribe((event) => secondEvents.push(event.type));

  runtime.advance();
  assert.deepEqual(firstEvents, ["snapshot", "terminated"]);
  assert.deepEqual(secondEvents, ["snapshot", "terminated"]);
});

test("serialized initialization discriminants fail closed", () => {
  for (const invalid of [
    { scenario: "sandbox" },
    { difficulty: "impossible" },
    { seed: 0x1_0000_0000 },
  ]) {
    const runtime = new InProcessSimulationRuntime();
    const events = [];
    runtime.subscribe((event) => events.push(event));
    runtime.dispatch(initialize(invalid));
    assert.equal(events.at(-1).type, "error");
    assert.equal(events.at(-1).code, "invalid_initialization");
    assert.equal(runtime.tick(), null);
  }
});

test("queued messages are cloned at the transport boundary", () => {
  const runtime = new InProcessSimulationRuntime();
  runtime.dispatch(initialize());
  const message = command(1, 1, {
    kind: "selectUnits",
    unitIds: [1],
    additive: false,
  });
  runtime.dispatch(message);
  message.command.unitIds.push(2);

  runtime.advance(2);
  assert.deepEqual(runtime.authoritativeState().units
    .filter((unit) => unit.selected)
    .map((unit) => unit.id), [1]);
});

test("malformed serialized command payloads report structured errors", () => {
  for (const malformed of [
    undefined,
    null,
    { kind: "selectUnits" },
    { kind: "move", target: { x: Number.NaN, y: 4 }, mode: "move" },
    {
      kind: "placeBuilding",
      buildingKind: "reactor",
      tile: { x: 10.5, y: 10.5 },
    },
    { kind: "restartSkirmish", seed: 1 },
    { kind: "unknown" },
  ]) {
    const runtime = new InProcessSimulationRuntime();
    const events = [];
    runtime.subscribe((event) => events.push(event));
    runtime.dispatch(initialize());
    runtime.dispatch({
      protocolVersion: version,
      type: "command",
      sequence: 1,
      intendedTick: 0,
      command: malformed,
    });
    assert.equal(events.at(-1).type, "error");
    assert.equal(events.at(-1).code, "invalid_message");
    assert.equal(runtime.advance(), 1);
  }
});

test("non-record serialized requests report structured errors", () => {
  for (const malformed of [undefined, null, false, 7, "initialize"]) {
    const runtime = new InProcessSimulationRuntime();
    const events = [];
    runtime.subscribe((event) => events.push(event));
    assert.doesNotThrow(() => runtime.dispatch(malformed));
    assert.equal(events.at(-1).type, "error");
    assert.equal(events.at(-1).code, "invalid_message");
  }
});

test("adapter matches direct simulation state for the same scheduled commands", () => {
  const direct = new Simulation(4_115, "skirmish", "normal");
  const runtime = new InProcessSimulationRuntime();
  runtime.dispatch(initialize({ snapshotCadenceTicks: 1 }));
  const scheduled = new Map([
    [0, [{ kind: "selectUnits", unitIds: [1, 2], additive: false }]],
    [1, [{ kind: "move", target: { x: 18, y: 18 }, mode: "move" }]],
    [4, [{ kind: "stop" }]],
  ]);
  let sequence = 0;
  for (const [tick, commands] of scheduled) {
    for (const queued of commands) {
      runtime.dispatch(command(sequence, tick, queued));
      sequence += 1;
    }
  }

  for (let tick = 0; tick < 8; tick += 1) {
    for (const queued of scheduled.get(tick) ?? []) direct.enqueue(queued);
    direct.step();
    runtime.advance();
    assert.deepEqual(runtime.authoritativeState(), direct.authoritativeState());
  }
});

test("protocol mismatches and duplicate sequences report structured errors", () => {
  const runtime = new InProcessSimulationRuntime();
  const events = [];
  runtime.subscribe((event) => events.push(event));
  runtime.dispatch({ ...initialize(), protocolVersion: 999 });
  assert.equal(events.at(-1).code, "protocol_version_mismatch");

  runtime.dispatch(initialize());
  runtime.dispatch(command(7, 0, { kind: "stop" }));
  runtime.dispatch(command(7, 0, { kind: "hold" }));
  assert.equal(events.at(-1).code, "duplicate_sequence");
});
