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
const pathfinding = await vite.ssrLoadModule("/app/game/pathfinding.ts");
const queueModule = await vite.ssrLoadModule(
  "/app/game/path-request-queue.ts",
);
const simulationModule = await vite.ssrLoadModule(
  "/app/game/simulation.ts",
);
const { createPathSearch, findPath } = pathfinding;
const { DeterministicPathRequestQueue } = queueModule;
const {
  PATH_EXPANSIONS_PER_TICK,
  Simulation,
} = simulationModule;

test.after(() => vite.close());

test("incremental path searches preserve synchronous path outcomes", () => {
  const occupied = new Set([66, 67, 68, 69]);
  const expected = findPath(
    { x: 1, y: 1 },
    { x: 12, y: 8 },
    { occupied },
  );
  const search = createPathSearch(
    { x: 1, y: 1 },
    { x: 12, y: 8 },
    { occupied },
  );
  const expansions = [];

  while (search.status === "planning") {
    const result = search.advance(3);
    expansions.push(result.expansions);
    assert.ok(result.expansions <= 3);
  }

  assert.equal(search.status, "resolved");
  assert.deepEqual(search.path, expected);
  assert.ok(expansions.length > 1);
});

test("incremental path searches validate and honor zero budgets", () => {
  const search = createPathSearch({ x: 1, y: 1 }, { x: 5, y: 5 });

  assert.deepEqual(search.advance(0), {
    expansions: 0,
    status: "planning",
    path: null,
  });
  assert.throws(() => search.advance(-1), /non-negative integer/);
  assert.throws(() => search.advance(1.5), /non-negative integer/);
});

test("incremental path searches fail deterministically when no route exists", () => {
  const occupied = new Set(
    Array.from({ length: 64 }, (_, x) => 2 * 64 + x),
  );
  const search = createPathSearch(
    { x: 1, y: 1 },
    { x: 1, y: 3 },
    { occupied },
  );

  while (search.status === "planning") search.advance(7);

  assert.equal(search.status, "failed");
  assert.equal(search.path, null);
});

test("path request queues enforce budgets and explicit priority order", () => {
  const queue = new DeterministicPathRequestQueue();
  queue.enqueue({
    key: "background",
    start: { x: 1, y: 1 },
    goal: { x: 20, y: 20 },
    priority: "background",
  });
  queue.enqueue({
    key: "direct",
    start: { x: 2, y: 2 },
    goal: { x: 3, y: 2 },
    priority: "direct",
  });

  assert.equal(queue.stateOf("background"), "queued");
  const first = queue.advance(1);
  assert.equal(first.expansions, 1);
  assert.deepEqual(first.completed, []);
  assert.equal(queue.stateOf("direct"), "planning");
  assert.equal(queue.stateOf("background"), "queued");

  const second = queue.advance(1);
  assert.equal(second.expansions, 1);
  assert.deepEqual(second.completed.map((result) => result.key), ["direct"]);
  assert.equal(queue.stateOf("direct"), null);
});

test("path request queues replace and cancel requests deterministically", () => {
  const queue = new DeterministicPathRequestQueue();
  queue.enqueue({
    key: "unit:7",
    start: { x: 1, y: 1 },
    goal: { x: 30, y: 30 },
    priority: "ai",
  });
  queue.enqueue({
    key: "unit:7",
    start: { x: 1, y: 1 },
    goal: { x: 2, y: 1 },
    priority: "direct",
  });

  assert.equal(queue.size, 1);
  let completed = [];
  while (completed.length === 0) {
    const advanced = queue.advance(1);
    assert.ok(advanced.expansions <= 1);
    completed = advanced.completed;
  }
  assert.deepEqual(completed[0].path, [
    { x: 1, y: 1 },
    { x: 2, y: 1 },
  ]);
  assert.equal(queue.cancel("unit:7"), false);

  queue.enqueue({
    key: "unit:8",
    start: { x: 1, y: 1 },
    goal: { x: 4, y: 4 },
    priority: "combat",
  });
  assert.equal(queue.cancel("unit:8"), true);
  assert.equal(queue.size, 0);
});

test("live formation orders share one budgeted anchor request", () => {
  const simulation = new Simulation(11_001, "economy");
  const units = Array.from({ length: 200 }, (_, index) =>
    simulation.createUnitState(
      index + 1,
      1,
      "argusRifle",
      { x: 4 + (index % 10), y: 4 + Math.floor(index / 10) },
    ),
  );
  simulation.units = units;
  simulation.structures = [];
  simulation.rebuildEntityIndexes();

  simulation.issueFormationMoveFor(
    units,
    { x: 50, y: 50 },
    "move",
    "direct",
  );

  assert.equal(simulation.pathRequests.size, 1);
  assert.equal(simulation.pendingPathRequests.size, 1);
  assert.equal(
    units.every(
      (unit) => simulation.pathingStateOf(unit) === "queued",
    ),
    true,
  );
});

test("live path planning never exceeds its per-tick expansion budget", () => {
  const simulation = new Simulation(11_002, "economy");
  const units = Array.from({ length: 80 }, (_, index) =>
    simulation.createUnitState(
      index + 1,
      1,
      "argusRifle",
      { x: 1 + (index % 8), y: 1 + Math.floor(index / 8) },
    ),
  );
  simulation.units = units;
  simulation.structures = [];
  simulation.rebuildEntityIndexes();
  for (const unit of units) {
    simulation.planPath(unit, { x: 60, y: 60 }, "direct");
  }

  simulation.lastPathExpansions = 0;
  simulation.processPathRequests(PATH_EXPANSIONS_PER_TICK);
  const snapshot = simulation.snapshot();

  assert.ok(snapshot.pathfinding.expansions <= PATH_EXPANSIONS_PER_TICK);
  assert.equal(snapshot.pathfinding.expansionBudget, PATH_EXPANSIONS_PER_TICK);
  assert.ok(snapshot.pathfinding.pendingRequests > 0);
  assert.equal(
    snapshot.units.some((unit) =>
      ["queued", "planning"].includes(unit.pathingState),
    ),
    true,
  );
});

test("stop commands cancel queued paths before planning runs", () => {
  const simulation = new Simulation(11_003, "economy");
  const unit = simulation.createUnitState(
    1,
    1,
    "argusRifle",
    { x: 2, y: 2 },
  );
  simulation.units = [unit];
  simulation.structures = [];
  simulation.fields = [];
  simulation.rebuildEntityIndexes();
  simulation.planPath(unit, { x: 60, y: 60 }, "direct");
  unit.selected = true;
  simulation.enqueue({ kind: "stop" });

  simulation.step();

  const snapshot = simulation.snapshot();
  const stopped = snapshot.units.find((candidate) => candidate.id === unit.id);
  assert.equal(snapshot.pathfinding.pendingRequests, 0);
  assert.equal(stopped.pathingState, "idle");
  assert.equal(stopped.order, "idle");
});

test("pending path searches participate in authoritative replay state", () => {
  const createPlanningSimulation = () => {
    const simulation = new Simulation(11_004, "economy");
    const unit = simulation.createUnitState(
      1,
      1,
      "argusRifle",
      { x: 2, y: 2 },
    );
    simulation.units = [unit];
    simulation.structures = [];
    simulation.fields = [];
    simulation.rebuildEntityIndexes();
    simulation.planPath(unit, { x: 60, y: 60 }, "direct");
    simulation.processPathRequests(3);
    return simulation;
  };
  const left = createPlanningSimulation();
  const right = createPlanningSimulation();

  assert.deepEqual(left.authoritativeState(), right.authoritativeState());
  assert.ok(left.authoritativeState().pathPlanning);

  right.processPathRequests(1);
  assert.notDeepEqual(left.authoritativeState(), right.authoritativeState());
});

test("pending move requests survive movement until their route resolves", () => {
  const simulation = new Simulation(11_005, "economy");
  const unit = simulation.createUnitState(
    1,
    1,
    "argusRifle",
    { x: 2, y: 2 },
  );
  simulation.units = [unit];
  simulation.structures = [];
  simulation.fields = [];
  simulation.rebuildEntityIndexes();
  unit.order = "move";
  simulation.planPath(unit, { x: 60, y: 60 }, "background");
  const requestKey = simulation.unitPendingPathRequests.get(unit.id);

  simulation.moveUnit(unit);

  assert.equal(simulation.unitPendingPathRequests.get(unit.id), requestKey);
  assert.equal(simulation.pathRequests.has(requestKey), true);
  assert.equal(unit.order, "move");
  assert.notEqual(unit.destination, null);
});

test("persistent planner history and presentation state affect replay state", () => {
  const left = new Simulation(11_006, "economy");
  const right = new Simulation(11_006, "economy");
  assert.deepEqual(left.authoritativeState(), right.authoritativeState());

  right.nextPathRequestId += 1;
  assert.notDeepEqual(left.authoritativeState(), right.authoritativeState());
  right.nextPathRequestId -= 1;
  right.unitPathingOverrides.set(1, "blocked");
  assert.notDeepEqual(left.authoritativeState(), right.authoritativeState());

  right.pathRequests.enqueue({
    key: "temporary",
    start: { x: 1, y: 1 },
    goal: { x: 2, y: 1 },
    priority: "background",
  });
  right.pathRequests.clear();
  assert.equal(
    right.pathRequests.authoritativeState().nextSequence,
    0,
  );
});
