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
    /pendingFogMemoryReset = true;[\s\S]*resetTargetingModes\(\);/,
  );
  assert.match(
    bootstrap,
    /if \(pendingFogMemoryReset\) \{\s*this\.clearStaleFogMemory\(\);\s*pendingFogMemoryReset = false;/,
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
  assert.match(bootstrap, /keyboard\.enabled = !formControlFocused/);
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
    ["scripts/validate-phase-six-assets.mjs"],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Phase 6 assets valid/);
});
