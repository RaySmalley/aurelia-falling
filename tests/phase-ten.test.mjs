import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { hashReplayState } from "../scripts/replay-state-hash.mjs";

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({
  root,
  configFile: false,
  logLevel: "silent",
  server: { middlewareMode: true },
});
const simulationModule = await vite.ssrLoadModule(
  "/app/game/simulation.ts",
);
const {
  SIMULATION_SYSTEMS,
  Simulation,
} = simulationModule;

test.after(() => vite.close());

test("step observers expose balanced system boundaries without changing state", () => {
  const observed = new Simulation(10_010, "skirmish");
  const control = new Simulation(10_010, "skirmish");
  const events = [];
  const observer = {
    begin(system, tick) {
      events.push({ phase: "begin", system, tick });
    },
    end(system, tick) {
      events.push({ phase: "end", system, tick });
    },
  };

  observed.step(observer);
  control.step();

  assert.deepEqual(observed.snapshot(), control.snapshot());
  assert.ok(events.length > 0);
  assert.equal(events.length % 2, 0);
  for (let index = 0; index < events.length; index += 2) {
    const begin = events[index];
    const end = events[index + 1];
    assert.equal(begin.phase, "begin");
    assert.equal(end.phase, "end");
    assert.equal(begin.system, end.system);
    assert.equal(begin.tick, end.tick);
    assert.ok(SIMULATION_SYSTEMS.includes(begin.system));
  }
});

test("step observers attribute restarted systems to the reset timeline", () => {
  const simulation = new Simulation(10_011, "skirmish");
  for (let tick = 0; tick < 5; tick += 1) simulation.step();
  simulation.enqueue({ kind: "restartCombat", seed: 10_012 });
  const events = [];
  const observer = {
    begin(system, tick) {
      events.push({ phase: "begin", system, tick });
    },
    end(system, tick) {
      events.push({ phase: "end", system, tick });
    },
  };

  simulation.step(observer);

  const commandEvents = events.filter((event) => event.system === "commands");
  const systemEvents = events.filter((event) => event.system !== "commands");
  assert.equal(commandEvents.length, 2);
  assert.equal(
    commandEvents.every((event) => event.tick === 5),
    true,
  );
  assert.ok(systemEvents.length > 0);
  assert.equal(
    systemEvents.every((event) => event.tick === 0),
    true,
  );
  assert.equal(simulation.snapshot().tick, 1);
  assert.equal(simulation.snapshot().seed, 10_012);
});

test("replay hashes cover hidden authoritative and RNG state", () => {
  const simulation = new Simulation(10_013, "skirmish");
  const playerSnapshot = JSON.stringify(simulation.snapshot());
  const initialHash = hashReplayState(simulation);
  const hiddenEnemy = simulation.units.find((unit) => unit.playerId === 2);
  hiddenEnemy.aiScout = !hiddenEnemy.aiScout;

  assert.equal(JSON.stringify(simulation.snapshot()), playerSnapshot);
  const hiddenStateHash = hashReplayState(simulation);
  assert.notEqual(hiddenStateHash, initialHash);

  simulation.rng.nextUint32();
  assert.equal(JSON.stringify(simulation.snapshot()), playerSnapshot);
  assert.notEqual(hashReplayState(simulation), hiddenStateHash);

  const exportedState = simulation.authoritativeState();
  exportedState.units[0].health = 0;
  assert.notEqual(simulation.units[0].health, 0);
});

test("the headless benchmark emits machine-readable percentile results", async () => {
  const { stdout } = await execFileAsync(
    process.execPath,
    [
      "scripts/run-simulation-benchmarks.mjs",
      "--counts",
      "20",
      "--warmup",
      "1",
      "--ticks",
      "3",
      "--seed",
      "10100",
    ],
    { cwd: root, maxBuffer: 4 * 1024 * 1024 },
  );
  const report = JSON.parse(stdout);
  const result = report.results[0];

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.runtime.node, process.version);
  assert.deepEqual(report.benchmark.counts, [20]);
  assert.equal(result.objectCounts.units, 20);
  assert.equal(result.measuredTicks, 3);
  assert.match(result.snapshot.sha256, /^[a-f0-9]{64}$/);
  for (const key of ["p50Ms", "p95Ms", "p99Ms", "worstMs"]) {
    assert.equal(typeof result.tickTiming[key], "number");
    assert.ok(result.tickTiming[key] >= 0);
  }
  assert.ok(result.systemTiming.separation);
});

test("versioned deterministic replay fixtures retain their expected hashes", async () => {
  const { stdout } = await execFileAsync(
    process.execPath,
    ["scripts/verify-simulation-replays.mjs"],
    { cwd: root, maxBuffer: 4 * 1024 * 1024, timeout: 60_000 },
  );
  const report = JSON.parse(stdout);

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.updated, false);
  assert.equal(report.verified, 6);
  assert.equal(report.results.length, 6);
  assert.ok(
    report.results.some((result) => result.id === "combat-restart-epochs"),
  );
});
