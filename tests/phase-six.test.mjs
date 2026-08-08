import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({
  root,
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

test("Easy and Hard derive pacing behavior from the canonical Normal AI", () => {
  const { easy, normal, hard } = gameData.ai;

  assert.equal(normal.id, "normal");
  assert.equal(easy.buildOrder, normal.buildOrder);
  assert.equal(hard.buildOrder, normal.buildOrder);
  assert.equal(easy.unitMix, normal.unitMix);
  assert.equal(hard.unitMix, normal.unitMix);
  assert.ok(easy.reactionIntervalTicks > normal.reactionIntervalTicks);
  assert.ok(hard.reactionIntervalTicks < normal.reactionIntervalTicks);
  assert.ok(easy.attackUnitThreshold > normal.attackUnitThreshold);
  assert.ok(hard.attackUnitThreshold < normal.attackUnitThreshold);

  const simulation = new Simulation(6_001, "skirmish", "hard");
  assert.equal(simulation.snapshot().ai.profile, "hard");
  simulation.enqueue({
    kind: "restartSkirmish",
    seed: 6_002,
    difficulty: "easy",
  });
  simulation.step();
  assert.equal(simulation.snapshot().ai.profile, "easy");
});

test("structure selling is queued, rules-legal, and refunds queued units", () => {
  const simulation = new Simulation(6_003, "economy");
  const before = simulation.snapshot();
  const refinery = before.structures.find(
    (structure) => structure.playerId === 1 && structure.kind === "refinery",
  );
  const citadel = before.structures.find(
    (structure) => structure.playerId === 1 && structure.kind === "citadel",
  );
  assert.ok(refinery);
  assert.ok(citadel);

  simulation.enqueue({
    kind: "queueUnit",
    structureId: refinery.id,
    unitKind: "midasHarvester",
  });
  simulation.enqueue({ kind: "sellStructure", structureId: refinery.id });
  assert.equal(
    simulation.snapshot().structures.some(
      (structure) => structure.id === refinery.id,
    ),
    true,
  );
  simulation.step();

  const sold = simulation.snapshot();
  const sellRefund = Math.floor(
    (gameData.buildings.refinery.cost *
      gameData.economy.structureSellRefundBasisPoints) /
      10_000,
  );
  assert.equal(
    sold.players[1].credits,
    before.players[1].credits + sellRefund,
  );
  assert.equal(
    sold.structures.some((structure) => structure.id === refinery.id),
    false,
  );

  simulation.enqueue({ kind: "sellStructure", structureId: citadel.id });
  simulation.step();
  assert.equal(
    simulation.snapshot().structures.some(
      (structure) => structure.id === citadel.id,
    ),
    true,
  );
});

test("selling the sole vision source blocks later same-tick Solar Spear launches", () => {
  const simulation = new Simulation(6_004, "skirmish");
  const oracle = simulation.createStructureState(
    90,
    1,
    "operationsCenter",
    { x: 8, y: 12 },
    true,
  );
  const forwardReactor = simulation.createStructureState(
    91,
    1,
    "reactor",
    { x: 40, y: 40 },
    true,
  );
  simulation.structures.push(oracle, forwardReactor);
  simulation.rebuildEntityIndexes();
  simulation.updateConnectivityAndPower();
  simulation.updateVisibility(true);
  simulation.solarSpears[1].chargeTicks = gameData.solarSpear.chargeTicks;
  assert.equal(simulation.visibility[1].isVisible({ x: 40, y: 40 }), true);

  simulation.enqueue({
    kind: "sellStructure",
    structureId: forwardReactor.id,
  });
  simulation.enqueue({
    kind: "launchSolarSpear",
    target: { x: 40, y: 40 },
  });
  simulation.step();

  const result = simulation.snapshot();
  assert.equal(
    result.structures.some(
      (structure) => structure.id === forwardReactor.id,
    ),
    false,
  );
  assert.equal(result.lastSolarFailure, "notVisible");
  assert.equal(result.solarSpears[1].state, "ready");
  assert.equal(result.solarSpears[1].launches, 0);
});

test("Phase 6 presentation, keyboard focus, and retry hooks are integrated", async () => {
  const [bootstrap, shell, styles] = await Promise.all([
    readFile(new URL("../app/game/bootstrap.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../app/phase-zero/PhaseZeroShell.tsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(bootstrap, /load\.spritesheet\(/);
  assert.match(bootstrap, /frameWidth: 160/);
  assert.match(bootstrap, /maxRetries: 2/);
  assert.match(bootstrap, /procedural fallback/);
  assert.match(bootstrap, /staleStructureMemory/);
  assert.match(
    bootstrap,
    /pendingFogMemoryResetAtTick = intendedTick;[\s\S]*resetTargetingModes\(\);/,
  );
  assert.match(
    bootstrap,
    /event\.tick >= pendingFogMemoryResetAtTick[\s\S]*fogMemoryResetReady = true;/,
  );
  assert.match(
    bootstrap,
    /if \(fogMemoryResetReady\) \{\s*this\.clearStaleFogMemory\(\);\s*fogMemoryResetReady = false;/,
  );
  assert.match(
    bootstrap,
    /clearStaleFogMemory\(\)[\s\S]*staleStructureMemory\.clear\(\)[\s\S]*staleStructureViews\.clear\(\)[\s\S]*lastFogRevision = -1;/,
  );
  assert.match(bootstrap, /setFrame\(UNIT_ATLAS_FRAME/);
  assert.match(bootstrap, /setZoom\(cameraZoom\)/);
  assert.match(bootstrap, /reducedScreenShake/);
  assert.match(bootstrap, /disableGlobalCapture\(\)/);
  assert.match(bootstrap, /enableGlobalCapture\(\)/);
  assert.match(bootstrap, /resetKeys\(\)/);
  assert.match(bootstrap, /target\.matches\("input, select, textarea"\)/);
  assert.doesNotMatch(
    bootstrap,
    /target\.matches\([^)]*button[^)]*\)/,
  );
  assert.match(
    bootstrap,
    /keyboard\.enabled = gameplayInputEnabled && !textEntryFocused/,
  );
  assert.match(bootstrap, /addEventListener\("keydown", guardFormKey, true\)/);
  assert.match(bootstrap, /addEventListener\("keyup", guardFormKey, true\)/);
  assert.match(bootstrap, /detachKeyboardCaptureGuard\(\)/);
  assert.match(shell, /Retry tactical payload/);
  assert.match(shell, /kind: "sellStructure"/);
  assert.match(styles, /golden-scar-key-art\.webp/);
  assert.match(styles, /unit-facing-atlas\.webp/);
});

test("Phase 6 assets satisfy dimensions and transfer budgets", () => {
  const result = spawnSync(
    process.execPath,
    ["scripts/validate-assets.mjs"],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Assets valid/);
});
