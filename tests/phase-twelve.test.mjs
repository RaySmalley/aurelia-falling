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

test("same-tick commands apply in sequence order rather than arrival order", () => {
  const runtime = new InProcessSimulationRuntime();
  runtime.dispatch(initialize());
  runtime.dispatch(
    command(2, 0, {
      kind: "restartSkirmish",
      seed: 222,
      difficulty: "hard",
    }),
  );
  runtime.dispatch(
    command(1, 0, {
      kind: "restartSkirmish",
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
  runtime.dispatch({ protocolVersion: version, type: "resume" });
  assert.equal(runtime.advance(), 1);
  assert.equal(runtime.tick(), 1);
});

test("adapter matches direct simulation state for the same scheduled commands", () => {
  const direct = new Simulation(4_115, "skirmish", "normal");
  const runtime = new InProcessSimulationRuntime();
  runtime.dispatch(initialize({ snapshotCadenceTicks: 1 }));
  const scheduled = new Map([
    [0, [{ kind: "selectUnits", unitIds: [1, 2] }]],
    [1, [{ kind: "move", target: { x: 18, y: 18 } }]],
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
