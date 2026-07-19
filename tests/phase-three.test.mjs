import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const vite = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)),
  configFile: false,
  server: { middlewareMode: true },
});
const [dataModule, simulationModule] = await Promise.all([
  vite.ssrLoadModule("/app/game/data.ts"),
  vite.ssrLoadModule("/app/game/simulation.ts"),
]);
const { gameData } = dataModule;
const { Simulation } = simulationModule;

test.after(() => vite.close());

const step = (simulation, ticks) => {
  for (let tick = 0; tick < ticks; tick += 1) simulation.step();
};

test("Phase 3 exposes all seven structures and the complete production tree", () => {
  assert.deepEqual(Object.keys(gameData.buildings).sort(), [
    "barracks",
    "citadel",
    "foundry",
    "operationsCenter",
    "reactor",
    "refinery",
    "turret",
  ]);
  assert.deepEqual(gameData.buildings.refinery.produces, ["midasHarvester"]);
  assert.deepEqual(gameData.buildings.barracks.produces, [
    "argusRifle",
    "cyclopsRocket",
  ]);
  assert.deepEqual(gameData.buildings.foundry.produces, [
    "hermesScout",
    "atlasTank",
    "gorgonWalker",
  ]);
  assert.ok(gameData.buildings.reactor.powerGenerated > 0);
  assert.ok(gameData.buildings.operationsCenter.powerConsumed > 0);
});

test("invalid placement attempts keep renderer and HUD placement modes aligned", async () => {
  const [bootstrap, shell] = await Promise.all([
    readFile(
      new URL("../app/game/bootstrap.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/phase-zero/PhaseZeroShell.tsx", import.meta.url),
      "utf8",
    ),
  ]);
  assert.doesNotMatch(bootstrap, /this\.pendingBuilding = null/);
  assert.match(shell, /placement === kind \? null : kind/);
});

test("Harvesters gather Aurelite, unload it, and regenerate fields deterministically", () => {
  const first = new Simulation(9_001, "economy");
  const second = new Simulation(9_001, "economy");
  const starting = first.snapshot();
  step(first, 700);
  step(second, 700);
  const result = first.snapshot();

  assert.ok(result.players[1].credits > starting.players[1].credits);
  assert.ok(result.fields[0].amount < starting.fields[0].amount);
  assert.deepEqual(result, second.snapshot());
  assert.equal(
    result.units.some(
      (unit) => unit.playerId === 1 && unit.kind === "midasHarvester",
    ),
    true,
  );
});

test("Harvesters honor explicit move, attack-move, and hold orders", () => {
  const simulation = new Simulation(9_002, "economy");
  simulation.enqueue({
    kind: "selectUnits",
    unitIds: [1],
    additive: false,
  });
  simulation.enqueue({
    kind: "move",
    target: { x: 20, y: 20 },
    mode: "move",
  });
  simulation.step();
  let harvester = simulation
    .snapshot()
    .units.find((unit) => unit.id === 1);
  assert.equal(harvester.order, "move");
  assert.ok(harvester.path.length > 0);

  simulation.enqueue({ kind: "hold" });
  simulation.step();
  const heldPosition = simulation
    .snapshot()
    .units.find((unit) => unit.id === 1).position;
  step(simulation, 20);
  harvester = simulation.snapshot().units.find((unit) => unit.id === 1);
  assert.equal(harvester.order, "hold");
  assert.deepEqual(harvester.position, heldPosition);

  simulation.enqueue({
    kind: "move",
    target: { x: 22, y: 20 },
    mode: "attackMove",
  });
  simulation.step();
  harvester = simulation.snapshot().units.find((unit) => unit.id === 1);
  assert.equal(harvester.order, "attackMove");
  assert.ok(harvester.path.length > 0);
});

test("Harvesters recover from move orders targeting their current tile", () => {
  const simulation = new Simulation(9_003, "economy");
  simulation.enqueue({
    kind: "selectUnits",
    unitIds: [1],
    additive: false,
  });
  simulation.enqueue({
    kind: "move",
    target: { x: 14, y: 15 },
    mode: "move",
  });

  simulation.step();
  let harvester = simulation
    .snapshot()
    .units.find((unit) => unit.id === 1);
  assert.equal(harvester.order, "idle");
  assert.equal(harvester.destination, null);
  assert.deepEqual(harvester.path, []);

  simulation.step();
  harvester = simulation.snapshot().units.find((unit) => unit.id === 1);
  assert.equal(harvester.order, "harvest");
  assert.ok(harvester.path.length > 0);
});

test("Placement enforces prerequisites, terrain, build radius, and credits", () => {
  const simulation = new Simulation(33, "economy");

  simulation.enqueue({
    kind: "placeBuilding",
    buildingKind: "foundry",
    tile: { x: 14, y: 11 },
  });
  simulation.step();
  assert.equal(simulation.snapshot().lastPlacementFailure, "missingPrerequisite");

  simulation.enqueue({
    kind: "placeBuilding",
    buildingKind: "barracks",
    tile: { x: 30, y: 6 },
  });
  simulation.step();
  assert.equal(simulation.snapshot().lastPlacementFailure, "blockedTerrain");

  simulation.enqueue({
    kind: "placeBuilding",
    buildingKind: "barracks",
    tile: { x: 24, y: 24 },
  });
  simulation.step();
  assert.equal(simulation.snapshot().lastPlacementFailure, "outsideBuildRadius");

  simulation.enqueue({
    kind: "placeBuilding",
    buildingKind: "barracks",
    tile: { x: 14, y: 11 },
  });
  simulation.step();
  const placed = simulation.snapshot().structures.find(
    (structure) => structure.kind === "barracks",
  );
  assert.ok(placed);
  assert.equal(simulation.snapshot().lastPlacementFailure, null);
  assert.equal(placed.completed, false);
});

test("Powered production queues complete and cancellation refunds credits", () => {
  const simulation = new Simulation(44, "economy");
  simulation.enqueue({
    kind: "placeBuilding",
    buildingKind: "barracks",
    tile: { x: 14, y: 11 },
  });
  simulation.step();
  const barracksId = simulation
    .snapshot()
    .structures.find((structure) => structure.kind === "barracks").id;
  step(simulation, gameData.buildings.barracks.buildTicks);

  simulation.enqueue({
    kind: "selectStructures",
    structureIds: [barracksId],
    additive: false,
  });
  simulation.enqueue({
    kind: "queueUnit",
    structureId: barracksId,
    unitKind: "argusRifle",
  });
  simulation.step();
  const afterQueue = simulation.snapshot();
  assert.equal(
    afterQueue.structures.find((structure) => structure.id === barracksId)
      .queue.length,
    1,
  );
  assert.equal(afterQueue.players[1].credits, 3_350);

  simulation.enqueue({
    kind: "cancelProduction",
    structureId: barracksId,
    queueIndex: 0,
  });
  simulation.step();
  assert.equal(simulation.snapshot().players[1].credits, 3_600);

  simulation.enqueue({
    kind: "queueUnit",
    structureId: barracksId,
    unitKind: "argusRifle",
  });
  simulation.step();
  step(simulation, gameData.units.argusRifle.buildTicks);
  assert.equal(
    simulation
      .snapshot()
      .units.some((unit) => unit.playerId === 1 && unit.kind === "argusRifle"),
    true,
  );
});

test("a completed Refinery includes one free replacement Harvester", () => {
  const simulation = new Simulation(55, "economy");
  const before = simulation.snapshot().units.length;
  simulation.enqueue({
    kind: "placeBuilding",
    buildingKind: "refinery",
    tile: { x: 14, y: 13 },
  });
  simulation.step();
  assert.equal(simulation.snapshot().lastPlacementFailure, null);
  step(simulation, gameData.buildings.refinery.buildTicks);
  assert.equal(simulation.snapshot().units.length, before + 1);
});

test("power allocation disables excess consumers in stable structure-id order", () => {
  const simulation = new Simulation(56, "economy");
  // White-box setup supplies credits only; every build still enters the queue
  // through the same public commands and completes on fixed simulation ticks.
  simulation.players[1].credits = 50_000;
  simulation.enqueue({
    kind: "placeBuilding",
    buildingKind: "barracks",
    tile: { x: 14, y: 11 },
  });
  simulation.step();
  step(simulation, gameData.buildings.barracks.buildTicks);
  const sites = [
    { x: 4, y: 7 },
    { x: 5, y: 6 },
    { x: 6, y: 5 },
    { x: 7, y: 5 },
    { x: 8, y: 5 },
    { x: 9, y: 5 },
    { x: 10, y: 5 },
    { x: 11, y: 5 },
    { x: 12, y: 5 },
    { x: 13, y: 6 },
    { x: 14, y: 7 },
  ];
  for (const tile of sites) {
    simulation.enqueue({
      kind: "placeBuilding",
      buildingKind: "turret",
      tile,
    });
  }
  simulation.step();
  assert.equal(
    simulation.snapshot().structures.filter(
      (structure) => structure.kind === "turret",
    ).length,
    sites.length,
  );
  step(simulation, gameData.buildings.turret.buildTicks);
  const snapshot = simulation.snapshot();
  const turrets = snapshot.structures.filter(
    (structure) => structure.kind === "turret",
  );
  assert.equal(snapshot.players[1].powerGenerated, 120);
  assert.equal(snapshot.players[1].powerConsumed, 140);
  assert.equal(snapshot.players[1].lowPower, true);
  assert.equal(turrets.filter((structure) => !structure.powered).length, 2);
  assert.equal(turrets.at(-1).powered, false);
});

test("repairs spend credits on fixed ticks and restore structure integrity", () => {
  const simulation = new Simulation(57, "economy");
  const reactor = simulation.structures.find(
    (structure) => structure.playerId === 1 && structure.kind === "reactor",
  );
  reactor.health -= 100;
  const before = simulation.snapshot();
  simulation.enqueue({
    kind: "selectStructures",
    structureIds: [reactor.id],
    additive: false,
  });
  simulation.enqueue({
    kind: "setRepair",
    structureId: reactor.id,
    enabled: true,
  });
  simulation.step();
  const after = simulation.snapshot();
  assert.equal(
    after.structures.find((structure) => structure.id === reactor.id).health,
    before.structures.find((structure) => structure.id === reactor.id).health +
      gameData.economy.repairHealthPerCredit,
  );
  assert.equal(after.players[1].credits, before.players[1].credits - 1);
});

test("severed construction chains orphan radius without disabling structures", () => {
  const simulation = new Simulation(58, "economy");
  simulation.players[1].credits = 50_000;
  simulation.enqueue({
    kind: "placeBuilding",
    buildingKind: "reactor",
    tile: { x: 18, y: 9 },
  });
  simulation.step();
  step(simulation, gameData.buildings.reactor.buildTicks);
  simulation.enqueue({
    kind: "placeBuilding",
    buildingKind: "reactor",
    tile: { x: 24, y: 9 },
  });
  simulation.step();
  step(simulation, gameData.buildings.reactor.buildTicks);
  const chain = simulation.snapshot().structures.filter(
    (structure) =>
      structure.playerId === 1 &&
      structure.kind === "reactor" &&
      structure.id >= 7,
  );
  assert.equal(chain.length, 2);
  assert.equal(chain[1].connected, true);

  simulation.structures.find((structure) => structure.id === chain[0].id).health =
    0;
  simulation.step();
  const orphan = simulation
    .snapshot()
    .structures.find((structure) => structure.id === chain[1].id);
  assert.equal(orphan.connected, false);
  assert.equal(orphan.powered, true);
});

test("Citadel destruction decides victory and same-tick destruction is a draw", () => {
  const victory = new Simulation(59, "economy");
  victory.structures.find(
    (structure) => structure.playerId === 2 && structure.kind === "citadel",
  ).health = 0;
  victory.step();
  assert.equal(victory.snapshot().status, "victory");
  assert.equal(victory.snapshot().winner, 1);

  const draw = new Simulation(60, "economy");
  for (const structure of draw.structures.filter(
    (candidate) => candidate.kind === "citadel",
  )) {
    structure.health = 0;
  }
  draw.step();
  assert.equal(draw.snapshot().status, "draw");
  assert.equal(draw.snapshot().winner, null);
});

test("local debug control switches sides without allowing cross-side selection", () => {
  const simulation = new Simulation(66, "economy");
  simulation.enqueue({ kind: "switchPlayer", playerId: 2 });
  simulation.enqueue({
    kind: "selectUnits",
    unitIds: [1, 2],
    additive: false,
  });
  simulation.step();
  const snapshot = simulation.snapshot();
  assert.equal(snapshot.controlledPlayer, 2);
  assert.deepEqual(snapshot.selectedUnitIds, [2]);
});

test("economy snapshots deeply freeze new player, structure, field, and queue data", () => {
  const simulation = new Simulation(77, "economy");
  const snapshot = simulation.snapshot();
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.structures), true);
  assert.equal(Object.isFrozen(snapshot.structures[0]), true);
  assert.equal(Object.isFrozen(snapshot.structures[0].tile), true);
  assert.equal(Object.isFrozen(snapshot.fields[0]), true);
  assert.equal(Object.isFrozen(snapshot.players), true);
  assert.equal(Object.isFrozen(snapshot.players[1]), true);
  assert.throws(() => {
    snapshot.players[1].credits = 0;
  }, TypeError);
});
