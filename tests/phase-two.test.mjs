import assert from "node:assert/strict";
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
const { DeterministicRng, Simulation } = simulationModule;

test.after(() => vite.close());

test("all six Meridian units have data-driven armor and weapons", () => {
  assert.deepEqual(Object.keys(gameData.units).sort(), [
    "argusRifle",
    "atlasTank",
    "cyclopsRocket",
    "gorgonWalker",
    "hermesScout",
    "midasHarvester",
  ]);
  for (const definition of Object.values(gameData.units)) {
    assert.ok(definition.maxHealth > 0);
    assert.ok(definition.speedMilliPerTick > 0);
    assert.ok(gameData.weapons[definition.weaponId]);
  }
  assert.ok(
    gameData.weapons.argusRifle.armorMultipliers.infantry >
      gameData.weapons.argusRifle.armorMultipliers.heavy,
  );
  assert.ok(
    gameData.weapons.cyclopsRockets.armorMultipliers.heavy >
      gameData.weapons.cyclopsRockets.armorMultipliers.infantry,
  );
});

test("the seeded PRNG repeats exactly without Math.random", () => {
  const first = new DeterministicRng(73);
  const second = new DeterministicRng(73);
  const different = new DeterministicRng(74);
  const sample = (rng) =>
    Array.from({ length: 12 }, () => rng.nextUint32());

  const firstSequence = sample(first);
  assert.deepEqual(firstSequence, sample(second));
  assert.notDeepEqual(firstSequence, sample(different));
});

test("manual targeting stays queued and produces combat ordnance", () => {
  const simulation = new Simulation(451);
  simulation.enqueue({
    kind: "selectUnits",
    unitIds: [1, 2, 3, 4, 5, 6],
    additive: false,
  });
  simulation.enqueue({ kind: "attackUnit", targetUnitId: 7 });

  let sawProjectile = false;
  let sawDamage = false;
  for (let tick = 0; tick < 500; tick += 1) {
    simulation.step();
    const snapshot = simulation.snapshot();
    sawProjectile ||= snapshot.projectiles.length > 0;
    sawDamage ||= snapshot.units.some((unit) => unit.health < unit.maxHealth);
    if (sawProjectile && sawDamage) break;
  }

  assert.equal(sawProjectile, true);
  assert.equal(sawDamage, true);
});

test("a seeded combat-only match terminates with an identical result", () => {
  const run = () => {
    const simulation = new Simulation(12_345);
    simulation.enqueue({
      kind: "selectUnits",
      unitIds: [1, 2, 3, 4, 5, 6],
      additive: false,
    });
    simulation.enqueue({
      kind: "move",
      target: { x: 41, y: 31 },
      mode: "attackMove",
    });
    for (
      let tick = 0;
      tick < 2_000 && simulation.snapshot().status === "active";
      tick += 1
    ) {
      simulation.step();
    }
    return simulation.snapshot();
  };

  const first = run();
  const second = run();
  assert.notEqual(first.status, "active");
  assert.deepEqual(first, second);
  assert.equal(first.kills[1] + first.kills[2], 12);
});

test("combat snapshots are frozen read-only values", () => {
  const snapshot = new Simulation().snapshot();
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.units), true);
  assert.equal(Object.isFrozen(snapshot.units[0]), true);
  assert.equal(Object.isFrozen(snapshot.units[0].position), true);
  assert.throws(() => {
    snapshot.units[0].health = 0;
  }, TypeError);
});
