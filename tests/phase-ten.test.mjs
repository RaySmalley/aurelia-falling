import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { hashReplayState } from "../scripts/replay-state-hash.mjs";
import {
  runFixture,
  validateFixture,
} from "../scripts/verify-simulation-replays.mjs";
import { parseArguments } from "../scripts/run-simulation-benchmarks.mjs";

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
const spatialIndexModule = await vite.ssrLoadModule(
  "/app/game/spatial-index.ts",
);
const {
  SIMULATION_SYSTEMS,
  Simulation,
} = simulationModule;
const { DeterministicSpatialIndex } = spatialIndexModule;

test.after(() => vite.close());

test("deterministic spatial indices track insert, move, remove, and ordered queries", () => {
  const index = new DeterministicSpatialIndex(1_000);
  index.insert(9, { x: 1_010, y: 1_010 });
  index.insert(2, { x: 999, y: 999 });
  index.insert(5, { x: -1, y: -1 });

  assert.deepEqual(index.query({ x: 1_000, y: 1_000 }, 20), [2, 9]);
  assert.deepEqual(index.query({ x: 0, y: 0 }, 2), [5]);
  assert.throws(
    () => index.insert(9, { x: 0, y: 0 }),
    /already contains entity 9/,
  );

  index.move(9, { x: 2_100, y: 1_010 });
  assert.deepEqual(index.query({ x: 1_000, y: 1_000 }, 20), [2]);
  assert.deepEqual(index.query({ x: 2_000, y: 1_000 }, 101), [9]);
  assert.equal(index.remove(2), true);
  assert.equal(index.remove(2), false);
  assert.deepEqual(index.query({ x: 1_000, y: 1_000 }, 20), []);
  assert.throws(
    () => index.move(2, { x: 0, y: 0 }),
    /does not contain entity 2/,
  );
});

test("spatial target acquisition preserves distance-then-id selection", () => {
  const simulation = new Simulation(10_009, "combat");
  const attacker = simulation.createUnitState(
    1,
    1,
    "argusRifle",
    { x: 10, y: 10 },
  );
  const higherId = simulation.createUnitState(
    8,
    2,
    "argusRifle",
    { x: 11, y: 10 },
  );
  const lowerId = simulation.createUnitState(
    7,
    2,
    "argusRifle",
    { x: 9, y: 10 },
  );
  simulation.units = [attacker, higherId, lowerId];
  simulation.structures = [];
  simulation.rebuildEntityIndexes();

  assert.equal(simulation.acquireUnitTarget(attacker, 2_000), lowerId);

  lowerId.position = { x: 20_000, y: 20_000 };
  simulation.rebuildEntityIndexes();
  assert.equal(simulation.acquireUnitTarget(attacker, 2_000), higherId);
});

test("dense separation refreshes neighbors after moving the left unit", () => {
  const simulation = new Simulation(10_008, "combat");
  const left = simulation.createUnitState(
    1,
    1,
    "argusRifle",
    { x: 0, y: 0 },
  );
  left.position = { x: 0, y: 0 };
  const pushingUnits = Array.from({ length: 25 }, (_, index) => {
    const unit = simulation.createUnitState(
      index + 2,
      1,
      "argusRifle",
      { x: 0, y: 0 },
    );
    unit.position = { x: 1 - 24 * index, y: 0 };
    return unit;
  });
  const initiallyExcluded = simulation.createUnitState(
    27,
    1,
    "argusRifle",
    { x: 0, y: 0 },
  );
  initiallyExcluded.position = { x: -1_001, y: 0 };
  simulation.units = [left, ...pushingUnits, initiallyExcluded];
  simulation.structures = [];
  simulation.rebuildEntityIndexes();

  simulation.applySeparationFor(left);

  assert.equal(initiallyExcluded.position.x, -1_025);
  assert.equal(left.position.x, -576);
});

test("area damage and spawn checks use bounded spatial queries", () => {
  const simulation = new Simulation(10_014, "economy");
  const nearUnit = simulation.createUnitState(
    1,
    1,
    "argusRifle",
    { x: 10, y: 10 },
  );
  const farUnit = simulation.createUnitState(
    2,
    2,
    "argusRifle",
    { x: 30, y: 30 },
  );
  const nearStructure = simulation.createStructureState(
    1,
    1,
    "barracks",
    { x: 11, y: 10 },
    true,
  );
  const farStructure = simulation.createStructureState(
    2,
    2,
    "barracks",
    { x: 30, y: 30 },
    true,
  );
  simulation.units = [nearUnit, farUnit];
  simulation.structures = [nearStructure, farStructure];
  simulation.rebuildEntityIndexes();

  const unitRadii = [];
  const unitTileRadii = [];
  const structureRadii = [];
  const queryUnits = simulation.unitSpatialIndex.query.bind(
    simulation.unitSpatialIndex,
  );
  const queryUnitTiles = simulation.unitTileSpatialIndex.query.bind(
    simulation.unitTileSpatialIndex,
  );
  const queryStructures = simulation.structureSpatialIndex.query.bind(
    simulation.structureSpatialIndex,
  );
  simulation.unitSpatialIndex.query = (position, radius) => {
    unitRadii.push(radius);
    return queryUnits(position, radius);
  };
  simulation.unitTileSpatialIndex.query = (position, radius) => {
    unitTileRadii.push(radius);
    return queryUnitTiles(position, radius);
  };
  simulation.structureSpatialIndex.query = (position, radius) => {
    structureRadii.push(radius);
    return queryStructures(position, radius);
  };

  const nearUnitHealth = nearUnit.health;
  const farUnitHealth = farUnit.health;
  const nearStructureHealth = nearStructure.health;
  const farStructureHealth = farStructure.health;
  simulation.solarSpears[1].target = { x: 10, y: 10 };
  simulation.solarSpears[1].impactTick = simulation.tick;
  simulation.updateSolarSpears();

  assert.ok(nearUnit.health < nearUnitHealth);
  assert.equal(farUnit.health, farUnitHealth);
  assert.ok(nearStructure.health < nearStructureHealth);
  assert.equal(farStructure.health, farStructureHealth);
  assert.ok(unitRadii.includes(5_000));
  assert.ok(structureRadii.includes(5_000));

  simulation.occupiedTiles = () => {
    throw new Error("spawn checks must not build a map-wide occupied tile set");
  };
  assert.ok(simulation.nearestSpawnTile({ x: 10, y: 10 }, 1));
  assert.ok(unitTileRadii.some((radius) => radius === 0));
  assert.ok(structureRadii.some((radius) => radius === 0));
});

test("logical tile occupancy tracks units pushed beyond map edges", () => {
  const simulation = new Simulation(10_015, "combat");
  const unit = simulation.createUnitState(
    1,
    1,
    "argusRifle",
    { x: 10, y: 10 },
  );
  simulation.units = [unit];
  simulation.structures = [];
  simulation.rebuildEntityIndexes();

  unit.position = { x: -2_000, y: 10_000 };
  simulation.moveUnitIndexes(unit);
  assert.equal(simulation.tileHasEntity({ x: 0, y: 10 }), true);
  assert.deepEqual(
    simulation.unitTileSpatialIndex.query({ x: 0, y: 10_000 }, 0),
    [unit.id],
  );

  unit.position = { x: 66_000, y: 10_000 };
  simulation.moveUnitIndexes(unit);
  assert.equal(simulation.tileHasEntity({ x: 0, y: 10 }), false);
  assert.equal(simulation.tileHasEntity({ x: 63, y: 10 }), true);
});

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

test("replay fixture validation rejects ambiguous or unreachable epochs", () => {
  const fixture = {
    id: "validation",
    end: { epoch: 0, tick: 10 },
    commands: [],
    checkpoints: [{ epoch: 0, tick: 10 }],
  };

  assert.doesNotThrow(() => validateFixture(fixture));
  assert.throws(
    () =>
      validateFixture({
        ...fixture,
        checkpoints: [{ epoch: 0, tick: 11 }],
      }),
    /checkpoint 0:11 is unreachable/,
  );
  assert.throws(
    () =>
      validateFixture({
        ...fixture,
        checkpoints: [
          { epoch: 0, tick: 10 },
          { epoch: 0, tick: 10 },
        ],
      }),
    /duplicate checkpoint 0:10/,
  );
  assert.throws(
    () =>
      validateFixture({
        ...fixture,
        end: { epoch: 1, tick: 10 },
        commands: [
          {
            epoch: 1,
            tick: 1,
            command: { kind: "selectUnits", unitIds: [], additive: false },
          },
        ],
      }),
    /must target epoch 0/,
  );
});

test("replay execution rejects checkpoints skipped at runtime", () => {
  class SkippingSimulation {
    constructor() {
      this.tick = 0;
    }

    snapshot() {
      return { tick: this.tick };
    }

    enqueue() {}

    step() {
      this.tick += 2;
    }

    authoritativeState() {
      return { tick: this.tick };
    }
  }

  assert.throws(
    () =>
      runFixture(SkippingSimulation, {}, {
        id: "skipped-checkpoint",
        end: { epoch: 0, tick: 2 },
        commands: [],
        checkpoints: [{ epoch: 0, tick: 1 }],
      }),
    /did not reach checkpoint\(s\): 0:1/,
  );
});

test("benchmark arguments reject partial numbers and preserve zero seed", () => {
  assert.deepEqual(
    parseArguments([
      "--counts",
      "20,40",
      "--ticks",
      "3",
      "--warmup",
      "0",
      "--seed",
      "0",
    ]),
    {
      counts: [20, 40],
      measuredTicks: 3,
      output: null,
      seed: 0,
      warmupTicks: 0,
    },
  );
  for (const value of ["3ms", "1.5", "1e3", "-1"]) {
    assert.throws(
      () => parseArguments(["--ticks", value]),
      /must be a positive integer/,
    );
  }
  assert.throws(
    () => parseArguments(["--counts", "20,,40"]),
    /must be a positive integer/,
  );
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

  assert.equal(report.schemaVersion, 2);
  assert.equal(report.updated, false);
  assert.equal(report.verified, 6);
  assert.equal(report.results.length, 6);
  assert.ok(
    report.results.some((result) => result.id === "combat-restart-epochs"),
  );
  const restartResult = report.results.find(
    (result) => result.id === "combat-restart-epochs",
  );
  assert.deepEqual(Object.keys(restartResult.checkpoints), ["0:10", "1:10"]);
});
