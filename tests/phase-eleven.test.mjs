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
const {
  DeterministicPathRequestQueue,
  PATH_REQUESTS_PER_PRIORITY_AGING_STEP,
} = queueModule;
const {
  INITIAL_CONGESTED_PATH_EXPANSIONS_PER_TICK,
  PATH_EXPANSIONS_PER_TICK,
  PATH_REQUEST_CONGESTION_THRESHOLD,
  Simulation,
  toTile,
} = simulationModule;

test.after(() => vite.close());

const displaceUnitAcrossTile = (simulation, unit) => {
  const originalTile = toTile(unit.position);
  const pushingUnits = Array.from({ length: 25 }, (_, index) => {
    const pushingUnit = simulation.createUnitState(
      index + 2,
      unit.playerId,
      "argusRifle",
      originalTile,
    );
    pushingUnit.position = {
      x: unit.position.x + 1 - 24 * index,
      y: unit.position.y,
    };
    return pushingUnit;
  });
  simulation.units.push(...pushingUnits);
  simulation.rebuildEntityIndexes();
  simulation.applySeparationFor(unit);
  const displacedTile = toTile(unit.position);
  assert.notDeepEqual(displacedTile, originalTile);
  return displacedTile;
};

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

test("path request priority aging prevents background starvation", () => {
  const queue = new DeterministicPathRequestQueue();
  queue.enqueue({
    key: "background",
    start: { x: 1, y: 1 },
    goal: { x: 60, y: 60 },
    priority: "background",
  });

  const requestsUntilDirectPriority =
    PATH_REQUESTS_PER_PRIORITY_AGING_STEP * 4;
  for (let index = 0; index < requestsUntilDirectPriority; index += 1) {
    queue.enqueue({
      key: `direct:${index}`,
      start: { x: 2, y: 2 },
      goal: { x: 60, y: 60 },
      priority: "direct",
    });
    queue.advance(1);
  }

  const background = queue
    .authoritativeState()
    .requests.find((request) => request.key === "background");
  assert.equal(background.started, true);
  assert.equal(background.search.totalExpansions, 1);
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
  const queued = queue.authoritativeState().requests[0];
  assert.equal(queued.started, false);
  assert.equal(queued.search.status, "queued");
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

test("attack-move formations preserve pending and resolved shared routes", () => {
  const simulation = new Simulation(11_002, "economy");
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
  simulation.issueFormationMoveFor(
    [unit],
    { x: 50, y: 50 },
    "attackMove",
    "direct",
  );
  const formationRequestKey =
    simulation.unitPendingPathRequests.get(unit.id);

  simulation.updateCombatOrder(unit);
  assert.equal(
    simulation.unitPendingPathRequests.get(unit.id),
    formationRequestKey,
  );
  assert.equal(
    simulation.pendingPathRequests.get(formationRequestKey).kind,
    "formation",
  );
  assert.equal(simulation.pathRequests.size, 1);

  const completed = simulation.pathRequests.advance(
    PATH_EXPANSIONS_PER_TICK * 4,
  ).completed;
  assert.equal(completed.length, 1);
  simulation.completePathRequest(completed[0]);
  const sharedPath = unit.path.map((point) => ({ ...point }));
  assert.ok(sharedPath.length > 0);

  simulation.updateCombatOrder(unit);
  assert.equal(simulation.pathRequests.size, 0);
  assert.deepEqual(unit.path, sharedPath);
});

test("live path planning never exceeds its per-tick expansion budget", () => {
  const simulation = new Simulation(11_003, "economy");
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

  assert.equal(simulation.pathOccupancyCounts.size, 1);
  assert.equal(
    simulation.pathRequests
      .authoritativeState()
      .requests.every(
        (request) =>
          request.started === false &&
          request.search.status === "queued",
      ),
    true,
  );
  simulation.lastPathExpansions = 0;
  simulation.processPathRequests(PATH_EXPANSIONS_PER_TICK);
  const snapshot = simulation.snapshot();
  const diagnostics = simulation.pathfindingDiagnostics();

  assert.ok(diagnostics.expansions <= PATH_EXPANSIONS_PER_TICK);
  assert.equal(diagnostics.expansionBudget, PATH_EXPANSIONS_PER_TICK);
  assert.ok(diagnostics.pendingRequests > 0);
  assert.equal(Object.hasOwn(snapshot, "pathfinding"), false);
  assert.equal(
    snapshot.units.some((unit) =>
      ["queued", "planning"].includes(unit.pathingState),
    ),
    true,
  );
});

test("large path workloads use the deterministic congested budget", () => {
  const simulation = new Simulation(11_012, "economy");
  const units = Array.from(
    { length: PATH_REQUEST_CONGESTION_THRESHOLD },
    (_, index) =>
      simulation.createUnitState(
        index + 1,
        1,
        "argusRifle",
        {
          x: 1 + (index % 16),
          y: 1 + Math.floor(index / 16),
        },
      ),
  );
  simulation.units = units;
  simulation.structures = [];
  simulation.fields = [];
  simulation.rebuildEntityIndexes();
  for (const unit of units) {
    simulation.planPath(unit, { x: 60, y: 60 }, "direct");
  }

  simulation.lastPathExpansions = 0;
  simulation.lastPathExpansionBudget = PATH_EXPANSIONS_PER_TICK;
  simulation.processPathRequests(PATH_EXPANSIONS_PER_TICK);

  const diagnostics = simulation.pathfindingDiagnostics();
  assert.equal(
    diagnostics.expansionBudget,
    INITIAL_CONGESTED_PATH_EXPANSIONS_PER_TICK,
  );
  assert.ok(
    diagnostics.expansions <=
      INITIAL_CONGESTED_PATH_EXPANSIONS_PER_TICK,
  );
  assert.ok(diagnostics.pendingRequests > 0);
  assert.equal(
    simulation.authoritativeState().pathPlanning.congested,
    true,
  );

  const formation = new Simulation(11_013, "economy");
  formation.units = units.map((unit) =>
    formation.createUnitState(
      unit.id,
      unit.playerId,
      unit.kind,
      toTile(unit.position),
    ),
  );
  formation.structures = [];
  formation.fields = [];
  formation.rebuildEntityIndexes();
  formation.issueFormationMoveFor(
    formation.units,
    { x: 60, y: 60 },
    "move",
    "direct",
  );
  formation.processPathRequests(PATH_EXPANSIONS_PER_TICK);

  assert.equal(
    formation.pathfindingDiagnostics().expansionBudget,
    INITIAL_CONGESTED_PATH_EXPANSIONS_PER_TICK,
  );
  assert.ok(
    formation.pathfindingDiagnostics().expansions <=
      INITIAL_CONGESTED_PATH_EXPANSIONS_PER_TICK,
  );
});

test("stop commands cancel queued paths before planning runs", () => {
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
  unit.selected = true;
  simulation.enqueue({ kind: "stop" });

  simulation.step();

  const snapshot = simulation.snapshot();
  const stopped = snapshot.units.find((candidate) => candidate.id === unit.id);
  assert.equal(simulation.pathfindingDiagnostics().pendingRequests, 0);
  assert.equal(stopped.pathingState, "idle");
  assert.equal(stopped.order, "idle");
});

test("player snapshots do not expose hidden global planner activity", () => {
  const simulation = new Simulation(11_011, "skirmish");
  const enemy = simulation.units.find((unit) => unit.playerId === 2);
  assert.notEqual(enemy, undefined);

  simulation.planPath(enemy, { x: 2, y: 2 }, "ai");

  assert.ok(simulation.pathfindingDiagnostics().pendingRequests > 0);
  assert.equal(Object.hasOwn(simulation.snapshot(), "pathfinding"), false);
});

test("pending path searches participate in authoritative replay state", () => {
  const createPlanningSimulation = () => {
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
  const simulation = new Simulation(11_006, "economy");
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

test("pending attack-move formations retain their destination through combat", () => {
  const simulation = new Simulation(11_007, "economy");
  const unit = simulation.createUnitState(
    1,
    1,
    "argusRifle",
    { x: 2, y: 2 },
  );
  const enemy = simulation.createUnitState(
    2,
    2,
    "argusRifle",
    { x: 3, y: 2 },
  );
  simulation.units = [unit, enemy];
  simulation.structures = [];
  simulation.fields = [];
  simulation.rebuildEntityIndexes();

  simulation.issueFormationMoveFor(
    [unit],
    { x: 50, y: 50 },
    "attackMove",
    "direct",
  );
  const intendedDestination = { ...unit.attackMoveDestination };
  assert.notEqual(unit.attackMoveDestination, null);

  simulation.updateCombatOrder(unit);
  assert.equal(simulation.unitPendingPathRequests.has(unit.id), false);
  assert.deepEqual(unit.attackMoveDestination, intendedDestination);

  enemy.health = 0;
  simulation.updateCombatOrder(unit);
  const resumedRequestKey = simulation.unitPendingPathRequests.get(unit.id);
  const resumedRequest = simulation.pendingPathRequests.get(
    resumedRequestKey,
  );
  assert.equal(resumedRequest.kind, "unit");
  assert.deepEqual(resumedRequest.destination, intendedDestination);
});

test("delayed replans pause paths anchored to the unit's current tile", () => {
  const simulation = new Simulation(11_008, "economy");
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
  unit.path = [{ x: 3, y: 2 }];
  unit.destination = { x: 3, y: 2 };

  simulation.planPath(unit, { x: 60, y: 60 }, "background");
  const positionBeforeMovement = { ...unit.position };
  simulation.moveUnit(unit);

  assert.deepEqual(unit.path, []);
  assert.equal(unit.pathIndex, 0);
  assert.deepEqual(unit.position, positionBeforeMovement);
  assert.equal(simulation.unitPendingPathRequests.has(unit.id), true);
});

test("formation completion rebases units displaced by separation", () => {
  const simulation = new Simulation(11_009, "economy");
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
  simulation.issueFormationMoveFor(
    [unit],
    { x: 50, y: 50 },
    "move",
    "direct",
  );

  const displacedStart = displaceUnitAcrossTile(simulation, unit);

  const completed = simulation.pathRequests.advance(
    PATH_EXPANSIONS_PER_TICK * 4,
  ).completed;
  assert.equal(completed.length, 1);
  simulation.completePathRequest(completed[0]);

  const rebasedRequestKey =
    simulation.unitPendingPathRequests.get(unit.id);
  const rebasedQueueRequest = simulation
    .pathRequests
    .authoritativeState()
    .requests.find((request) => request.key === rebasedRequestKey);
  assert.deepEqual(rebasedQueueRequest.search.start, displacedStart);
});

test("individual completion rebases units displaced by separation", () => {
  const simulation = new Simulation(11_010, "economy");
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
  simulation.planPath(unit, { x: 50, y: 50 }, "background");
  const displacedStart = displaceUnitAcrossTile(simulation, unit);

  const completed = simulation.pathRequests.advance(
    PATH_EXPANSIONS_PER_TICK * 4,
  ).completed;
  assert.equal(completed.length, 1);
  simulation.completePathRequest(completed[0]);

  const rebasedRequestKey =
    simulation.unitPendingPathRequests.get(unit.id);
  const rebasedQueueRequest = simulation
    .pathRequests
    .authoritativeState()
    .requests.find((request) => request.key === rebasedRequestKey);
  assert.equal(rebasedQueueRequest.priority, "background");
  assert.deepEqual(rebasedQueueRequest.search.start, displacedStart);
});

test("persistent planner history and presentation state affect replay state", () => {
  const left = new Simulation(11_011, "economy");
  const right = new Simulation(11_011, "economy");
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
