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
const [audioModule, dataModule, simulationModule] = await Promise.all([
  vite.ssrLoadModule("/app/game/audio.ts"),
  vite.ssrLoadModule("/app/game/data.ts"),
  vite.ssrLoadModule("/app/game/simulation.ts"),
]);
const { isContinuousAudioTransition } = audioModule;
const { gameData } = dataModule;
const { Simulation } = simulationModule;

test.after(() => vite.close());

const step = (simulation, ticks) => {
  for (let tick = 0; tick < ticks; tick += 1) simulation.step();
};

const addOracle = (simulation, playerId, id, tile) => {
  const oracle = simulation.createStructureState(
    id,
    playerId,
    "operationsCenter",
    tile,
    true,
  );
  simulation.structures.push(oracle);
  simulation.rebuildEntityIndexes();
  simulation.updateConnectivityAndPower();
  return oracle;
};

test("Solar Spear charge advances only with a powered Oracle and is lost before launch", () => {
  const simulation = new Simulation(5_001, "economy");
  const oracle = addOracle(simulation, 1, 90, { x: 8, y: 12 });
  simulation.solarSpears[1].chargeTicks =
    gameData.solarSpear.chargeTicks - 2;

  simulation.step();
  assert.equal(
    simulation.snapshot().solarSpears[1].chargeTicks,
    gameData.solarSpear.chargeTicks - 1,
  );

  simulation.structures = simulation.structures.filter(
    (structure) =>
      structure.playerId !== 1 || structure.kind !== "reactor",
  );
  simulation.step();
  assert.equal(oracle.powered, false);
  assert.equal(
    simulation.snapshot().solarSpears[1].chargeTicks,
    gameData.solarSpear.chargeTicks - 1,
  );

  oracle.health = 0;
  simulation.step();
  const snapshot = simulation.snapshot();
  assert.equal(snapshot.solarSpears[1].state, "unavailable");
  assert.equal(snapshot.solarSpears[1].chargeTicks, 0);
});

test("Solar Spear requires current vision, warns for four seconds, and survives Oracle destruction after launch", () => {
  const simulation = new Simulation(5_002, "skirmish");
  const oracle = addOracle(simulation, 1, 91, { x: 8, y: 12 });
  simulation.solarSpears[1].chargeTicks = gameData.solarSpear.chargeTicks;

  simulation.enqueue({
    kind: "launchSolarSpear",
    target: { x: 55, y: 54 },
  });
  simulation.step();
  assert.equal(simulation.snapshot().lastSolarFailure, "notVisible");
  assert.equal(simulation.snapshot().solarSpears[1].state, "ready");

  const enemyCitadel = simulation.structures.find(
    (structure) =>
      structure.playerId === 2 && structure.kind === "citadel",
  );
  enemyCitadel.tile = { x: 17, y: 15 };
  simulation.rebuildEntityIndexes();
  simulation.updateVisibility(true);
  simulation.enqueue({
    kind: "launchSolarSpear",
    target: { x: 17, y: 15 },
  });
  simulation.step();
  const launch = simulation.snapshot().solarSpears[1];
  assert.equal(launch.state, "warning");
  assert.equal(
    launch.impactTick - simulation.snapshot().tick,
    gameData.solarSpear.warningTicks - 1,
  );

  oracle.health = 0;
  simulation.step();
  assert.equal(simulation.snapshot().solarSpears[1].state, "warning");
  step(simulation, gameData.solarSpear.warningTicks - 2);
  assert.equal(simulation.snapshot().status, "active");
  assert.equal(simulation.snapshot().solarSpears[1].state, "warning");

  simulation.step();
  const result = simulation.snapshot();
  assert.equal(result.status, "victory");
  assert.equal(result.winner, 1);
  assert.equal(result.solarSpears[1].launches, 1);
  assert.deepEqual(result.solarSpears[1].lastImpact.target, {
    x: 17,
    y: 15,
  });
});

test("same-tick Solar Spear Citadel destruction resolves as a draw", () => {
  const simulation = new Simulation(5_003, "economy");
  addOracle(simulation, 1, 92, { x: 8, y: 12 });
  addOracle(simulation, 2, 93, { x: 55, y: 51 });
  simulation.solarSpears[1].chargeTicks = gameData.solarSpear.chargeTicks;
  simulation.solarSpears[2].chargeTicks = gameData.solarSpear.chargeTicks;

  assert.equal(
    simulation.launchSolarSpear(1, { x: 8, y: 9 }),
    true,
  );
  assert.equal(
    simulation.launchSolarSpear(2, { x: 55, y: 54 }, false),
    true,
  );
  step(simulation, gameData.solarSpear.warningTicks + 1);

  const result = simulation.snapshot();
  assert.equal(result.status, "draw");
  assert.equal(result.winner, null);
  assert.equal(result.solarSpears[1].lastImpact.tick, result.tick - 1);
  assert.equal(result.solarSpears[2].lastImpact.tick, result.tick - 1);
});

test("onboarding progress comes from accepted simulation commands and completed construction", () => {
  const simulation = new Simulation(5_004, "economy");
  simulation.enqueue({
    kind: "selectUnits",
    unitIds: [1],
    additive: false,
  });
  simulation.enqueue({ kind: "assignControlGroup", group: 1 });
  simulation.enqueue({
    kind: "move",
    target: { x: 18, y: 18 },
    mode: "attackMove",
  });
  simulation.enqueue({
    kind: "queueUnit",
    structureId: 3,
    unitKind: "midasHarvester",
  });
  simulation.enqueue({
    kind: "placeBuilding",
    buildingKind: "reactor",
    tile: { x: 8, y: 12 },
  });
  simulation.step();

  const reactor = simulation.structures.find(
    (structure) => structure.id === 7,
  );
  assert.ok(reactor);
  reactor.constructionRemainingTicks = 1;
  simulation.step();

  const onboarding = simulation.snapshot().onboarding;
  assert.equal(onboarding.selection, true);
  assert.equal(onboarding.controlGroup, true);
  assert.equal(onboarding.attackMove, true);
  assert.equal(onboarding.production, true);
  assert.equal(onboarding.reactor, true);
  assert.equal(Object.isFrozen(onboarding), true);
});

test("surrender and seeded restart stay inside the fixed-step command queue", () => {
  const simulation = new Simulation(5_005, "skirmish");
  simulation.enqueue({ kind: "surrender" });
  assert.equal(simulation.snapshot().status, "active");
  simulation.step();
  assert.equal(simulation.snapshot().status, "defeat");
  assert.equal(simulation.snapshot().winner, 2);

  simulation.enqueue({ kind: "restartSkirmish", seed: 5_006 });
  simulation.step();
  const restarted = simulation.snapshot();
  assert.equal(restarted.status, "active");
  assert.equal(restarted.seed, 5_006);
  assert.equal(restarted.tick, 1);
  assert.equal(restarted.solarSpears[1].launches, 0);
});

test("audio observation skips snapshot discontinuities across restarts", () => {
  const simulation = new Simulation(5_007, "skirmish");
  const initial = simulation.snapshot();
  simulation.step();
  const continuous = simulation.snapshot();
  assert.equal(isContinuousAudioTransition(initial, continuous), true);

  step(simulation, 4);
  const previousMatch = simulation.snapshot();
  simulation.enqueue({ kind: "restartSkirmish", seed: 5_007 });
  simulation.step();
  const sameSeedRestart = simulation.snapshot();
  assert.equal(
    isContinuousAudioTransition(previousMatch, sameSeedRestart),
    false,
  );

  simulation.enqueue({ kind: "restartSkirmish", seed: 5_008 });
  simulation.step();
  const newSeedRestart = simulation.snapshot();
  assert.equal(
    isContinuousAudioTransition(sameSeedRestart, newSeedRestart),
    false,
  );
});

test("runtime targeting state stays synchronized across clicks and restarts", async () => {
  const [bootstrap, shell, types] = await Promise.all([
    readFile(new URL("../app/game/bootstrap.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../app/phase-zero/PhaseZeroShell.tsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../app/game/types.ts", import.meta.url), "utf8"),
  ]);

  assert.match(types, /pendingBuilding: BuildingKind \| null;/);
  assert.match(types, /solarTargeting: boolean;/);
  assert.match(types, /clearTargetingModes\(\): void;/);
  assert.match(
    bootstrap,
    /if \(solarTargeting\)[\s\S]*setTargetingModes\(pendingBuilding, false\);/,
  );
  assert.match(
    bootstrap,
    /command\.kind === "restartSkirmish"[\s\S]*resetTargetingModes\(\);/,
  );
  assert.match(shell, /const placement = snapshot\.pendingBuilding;/);
  assert.match(shell, /const solarTargeting = snapshot\.solarTargeting;/);
  assert.match(
    shell,
    /const restartMatch = \(\) => \{\s*runtimeRef\.current\?\.clearTargetingModes\(\);/,
  );
  assert.doesNotMatch(shell, /setPlacement|setSolarTargeting/);
});

test("Phase 5 shell persists settings and synthesizes audio without simulation randomness", async () => {
  const [audio, bootstrap, shell, simulation] = await Promise.all([
    readFile(new URL("../app/game/audio.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/game/bootstrap.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../app/phase-zero/PhaseZeroShell.tsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../app/game/simulation.ts", import.meta.url), "utf8"),
  ]);

  assert.match(audio, /createOscillator\(\)/);
  assert.match(audio, /createBuffer\(/);
  assert.match(audio, /startAmbient\(\)/);
  assert.match(bootstrap, /isContinuousAudioTransition/);
  assert.match(
    bootstrap,
    /else \{\s*previousSnapshot = lastSnapshot;\s*\}/,
  );
  assert.match(bootstrap, /beginSolarTargeting/);
  assert.match(bootstrap, /proceduralAudio\.observe/);
  assert.match(shell, /localStorage\.setItem\(SETTINGS_KEY/);
  assert.match(shell, /MATCH SETUP/);
  assert.match(shell, /Dismiss guidance/);
  assert.doesNotMatch(simulation, /Math\.random/);
});
