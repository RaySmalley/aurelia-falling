import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const vite = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)),
  configFile: false,
  server: { middlewareMode: true },
});
const [dataModule, mapModule, simulationModule] = await Promise.all([
  vite.ssrLoadModule("/app/game/data.ts"),
  vite.ssrLoadModule("/app/game/map.ts"),
  vite.ssrLoadModule("/app/game/simulation.ts"),
]);
const { gameData } = dataModule;
const { isTerrainBlocked, tileKeyOf } = mapModule;
const { Simulation } = simulationModule;

test.after(() => vite.close());

const step = (simulation, ticks) => {
  for (let tick = 0; tick < ticks; tick += 1) simulation.step();
};

test("skirmish visibility starts local, stays dirty-stable, and expands with movement", () => {
  const simulation = new Simulation(4_001, "skirmish");
  const initial = simulation.snapshot();
  const initialExplored = initial.visibility.tiles.filter(
    (level) => level > 0,
  ).length;

  assert.equal(initial.visibility.enabled, true);
  assert.equal(initial.visibility.tiles.length, 64 * 64);
  assert.equal(initial.units.every((unit) => unit.playerId === 1), true);
  assert.equal(
    initial.structures.every((structure) => structure.playerId === 1),
    true,
  );
  assert.ok(initialExplored > 0);
  assert.ok(initialExplored < 64 * 64);

  simulation.step();
  assert.equal(
    simulation.snapshot().visibility.revision,
    initial.visibility.revision,
  );

  simulation.enqueue({
    kind: "selectUnits",
    unitIds: [1],
    additive: false,
  });
  simulation.enqueue({
    kind: "move",
    target: { x: 25, y: 22 },
    mode: "move",
  });
  step(simulation, 40);
  const moved = simulation.snapshot();
  assert.ok(moved.visibility.revision > initial.visibility.revision);
  assert.ok(
    moved.visibility.tiles.filter((level) => level > 0).length >
      initialExplored,
  );
});

test("hidden enemies cannot be targeted and visibility snapshots are immutable", () => {
  const simulation = new Simulation(4_002, "skirmish");
  simulation.enqueue({
    kind: "selectUnits",
    unitIds: [1],
    additive: false,
  });
  simulation.enqueue({ kind: "attackUnit", targetUnitId: 2 });
  simulation.step();

  const snapshot = simulation.snapshot();
  const harvester = snapshot.units.find((unit) => unit.id === 1);
  assert.equal(harvester.targetId, null);
  assert.equal(Object.isFrozen(snapshot.visibility), true);
  assert.equal(Object.isFrozen(snapshot.visibility.tiles), true);
  assert.equal(Object.isFrozen(snapshot.ai), true);
  assert.throws(() => {
    snapshot.visibility.tiles[0] = 2;
  }, TypeError);
});

test("combat targets are dropped as soon as they leave current vision", () => {
  const unitSimulation = new Simulation(4_021, "skirmish");
  const playerUnit = unitSimulation.units.find((unit) => unit.id === 1);
  const enemyUnit = unitSimulation.units.find((unit) => unit.id === 2);
  enemyUnit.position = { x: 16_000, y: 15_000 };
  unitSimulation.rebuildEntityIndexes();
  unitSimulation.updateVisibility(true);
  unitSimulation.enqueue({
    kind: "selectUnits",
    unitIds: [playerUnit.id],
    additive: false,
  });
  unitSimulation.enqueue({ kind: "attackUnit", targetUnitId: enemyUnit.id });
  unitSimulation.step();
  assert.equal(playerUnit.targetId, enemyUnit.id);

  enemyUnit.position = { x: 49_000, y: 48_000 };
  unitSimulation.rebuildEntityIndexes();
  unitSimulation.step();
  assert.equal(playerUnit.targetId, null);
  assert.equal(playerUnit.order, "idle");

  const structureSimulation = new Simulation(4_022, "skirmish");
  const structureAttacker = structureSimulation.units.find(
    (unit) => unit.id === 1,
  );
  const enemyStructure = structureSimulation.structures.find(
    (structure) => structure.id === 4,
  );
  structureAttacker.position = { x: 52_000, y: 54_000 };
  structureSimulation.rebuildEntityIndexes();
  structureSimulation.updateVisibility(true);
  structureSimulation.enqueue({
    kind: "selectUnits",
    unitIds: [structureAttacker.id],
    additive: false,
  });
  structureSimulation.enqueue({
    kind: "attackStructure",
    targetStructureId: enemyStructure.id,
  });
  structureSimulation.step();
  assert.equal(structureAttacker.targetStructureId, enemyStructure.id);

  structureAttacker.position = { x: 14_000, y: 15_000 };
  structureSimulation.rebuildEntityIndexes();
  structureSimulation.updateVisibility(true);
  structureSimulation.step();
  assert.equal(structureAttacker.targetStructureId, null);
  assert.equal(structureAttacker.order, "idle");
});

test("Aurelite fields expose live state only while currently visible", () => {
  const simulation = new Simulation(4_023, "skirmish");
  assert.deepEqual(
    simulation.snapshot().fields.map((field) => field.id),
    [1],
  );

  const harvester = simulation.units.find((unit) => unit.id === 1);
  harvester.position = { x: 28_000, y: 31_000 };
  simulation.rebuildEntityIndexes();
  simulation.updateVisibility(true);
  assert.equal(
    simulation.snapshot().fields.some((field) => field.id === 3),
    true,
  );

  harvester.position = { x: 14_000, y: 15_000 };
  simulation.rebuildEntityIndexes();
  simulation.updateVisibility(true);
  assert.equal(
    simulation.snapshot().fields.some((field) => field.id === 3),
    false,
  );
});

test("hidden enemy structures remain physical pathfinding blockers", () => {
  const simulation = new Simulation(4_024, "skirmish");
  const hiddenCitadel = simulation.structures.find(
    (structure) => structure.id === 4,
  );
  assert.equal(
    simulation.snapshot().structures.some(
      (structure) => structure.id === hiddenCitadel.id,
    ),
    false,
  );

  simulation.enqueue({
    kind: "selectUnits",
    unitIds: [1],
    additive: false,
  });
  simulation.enqueue({
    kind: "move",
    target: { ...hiddenCitadel.tile },
    mode: "move",
  });
  simulation.step();

  const harvester = simulation.units.find((unit) => unit.id === 1);
  assert.notDeepEqual(harvester.destination, hiddenCitadel.tile);
  assert.equal(
    harvester.path.some(
      (point) => tileKeyOf(point) === tileKeyOf(hiddenCitadel.tile),
    ),
    false,
  );
  assert.equal(
    simulation.snapshot().structures.some(
      (structure) => structure.id === hiddenCitadel.id,
    ),
    false,
  );
});

test("the Normal AI builds, scouts, expands, and spends only legal resources", () => {
  const simulation = new Simulation(4_003, "skirmish");
  let minimumCredits = simulation.players[2].credits;
  for (let tick = 0; tick < 12_000; tick += 1) {
    simulation.step();
    minimumCredits = Math.min(minimumCredits, simulation.players[2].credits);
  }

  const aiStructures = simulation.structures.filter(
    (structure) => structure.playerId === 2,
  );
  const aiUnits = simulation.units.filter((unit) => unit.playerId === 2);
  const occupied = new Set();
  const fields = new Set(simulation.fields.map((field) => tileKeyOf(field.tile)));
  for (const structure of aiStructures) {
    const key = tileKeyOf(structure.tile);
    assert.equal(isTerrainBlocked(structure.tile), false);
    assert.equal(fields.has(key), false);
    assert.equal(occupied.has(key), false);
    occupied.add(key);
  }

  assert.equal(minimumCredits >= 0, true);
  assert.equal(simulation.snapshot().ai.cheats, false);
  assert.equal(
    ["barracks", "foundry", "operationsCenter"].every((kind) =>
      aiStructures.some((structure) => structure.kind === kind),
    ),
    true,
  );
  assert.ok(
    aiStructures.filter((structure) => structure.kind === "refinery").length >=
      2,
  );
  assert.ok(aiUnits.some((unit) => unit.kind === "hermesScout"));
  assert.ok(simulation.snapshot().ai.knownEnemyStructures > 0);
});

test("the Normal AI reacts to visible threats and rebuilds destroyed tech", () => {
  const simulation = new Simulation(4_004, "skirmish");
  step(simulation, 12_000);

  const barracks = simulation.structures.find(
    (structure) => structure.playerId === 2 && structure.kind === "barracks",
  );
  assert.ok(barracks);
  barracks.health = 0;

  const playerHarvester = simulation.units.find((unit) => unit.id === 1);
  playerHarvester.position = { x: 52_000, y: 52_000 };
  simulation.rebuildEntityIndexes();
  playerHarvester.order = "hold";
  playerHarvester.path = [];
  let sawDefenseOrder = false;
  for (let tick = 0; tick < 2_500; tick += 1) {
    simulation.step();
    sawDefenseOrder ||= simulation.units.some(
      (unit) =>
        unit.playerId === 2 &&
        unit.kind !== "midasHarvester" &&
        (unit.targetId === 1 || unit.order === "attack"),
    );
  }

  assert.ok(
    simulation.structures.some(
      (structure) =>
        structure.playerId === 2 &&
        structure.kind === "barracks" &&
        structure.id !== barracks.id,
    ),
  );
  assert.equal(sawDefenseOrder, true);
});

test("a seeded passive-player skirmish terminates deterministically in the target window", () => {
  const run = () => {
    const simulation = new Simulation(4_444, "skirmish");
    const hashes = [];
    for (
      let tick = 0;
      tick < 36_000 && simulation.status === "active";
      tick += 1
    ) {
      simulation.step();
      if (simulation.tick % 6_000 === 0) {
        hashes.push(
          createHash("sha256")
            .update(JSON.stringify(simulation.snapshot()))
            .digest("hex"),
        );
      }
    }
    hashes.push(
      createHash("sha256")
        .update(JSON.stringify(simulation.snapshot()))
        .digest("hex"),
    );
    return {
      hashes,
      status: simulation.status,
      tick: simulation.tick,
      winner: simulation.winner,
    };
  };

  const first = run();
  const second = run();
  assert.deepEqual(first, second);
  assert.equal(first.status, "defeat");
  assert.equal(first.winner, 2);
  assert.ok(first.tick >= 20 * 60 * 20);
  assert.ok(first.tick <= 30 * 60 * 20);
});

test("the Phaser fog texture updates only from visibility revisions", async () => {
  const bootstrap = await readFile(
    new URL("../app/game/bootstrap.ts", import.meta.url),
    "utf8",
  );
  assert.match(bootstrap, /add\s*\.\s*renderTexture\(/);
  assert.match(bootstrap, /visibility\.revision === this\.lastFogRevision/);
  assert.match(bootstrap, /this\.fogTexture\.render\(\)/);
  assert.doesNotMatch(bootstrap, /Math\.random/);
  assert.equal(gameData.ai.normal.id, "normal");
  assert.ok(gameData.ai.normal.attackStartTick >= 20 * 60 * 20 - 2_000);
});
