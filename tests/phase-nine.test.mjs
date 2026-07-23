import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

test("Phase 9 atlases preserve deterministic procedural fallbacks", async () => {
  const bootstrap = await readFile(
    new URL("../app/game/bootstrap.ts", import.meta.url),
    "utf8",
  );

  assert.match(bootstrap, /"structure-atlas"/);
  assert.match(bootstrap, /"battlefield-atlas"/);
  assert.match(bootstrap, /frameWidth: 256/);
  assert.match(bootstrap, /frameHeight: 288/);
  assert.match(bootstrap, /renderTexture\(FOG_LEFT, FOG_TOP/);
  assert.match(bootstrap, /\.stamp\("battlefield-atlas"/);
  assert.match(bootstrap, /\.setName\("procedural-terrain-fallback"\)/);
  assert.match(bootstrap, /\.setVisible\(!hasAtlas\)/);
  assert.match(bootstrap, /stale\s*\? 0x8c9998/);
});

test("Phase 9 cargo meters reveal only friendly Harvester capacity", async () => {
  const bootstrap = await readFile(
    new URL("../app/game/bootstrap.ts", import.meta.url),
    "utf8",
  );

  assert.match(bootstrap, /unit\.kind === "midasHarvester"/);
  assert.match(bootstrap, /unit\.playerId === current\.controlledPlayer/);
  assert.match(bootstrap, /\(unit\.selected \|\| unit\.cargo > 0\)/);
  assert.match(bootstrap, /unit\.cargo \/ unit\.cargoCapacity/);
  assert.match(bootstrap, /const segments = 5/);
  assert.match(bootstrap, /cargo\.fillStyle\(0xf0bf57/);
});

test("Phase 9 portraits and Aurelite icon use atlas-derived UI", async () => {
  const [shell, styles] = await Promise.all([
    readFile(
      new URL("../app/phase-zero/PhaseZeroShell.tsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(shell, /className="aurelite-icon"/);
  assert.match(shell, /structure-portrait portrait-/);
  assert.match(styles, /phase-nine\/battlefield-atlas\.webp/);
  assert.match(styles, /phase-nine\/structure-atlas\.webp/);
  assert.match(styles, /\.portrait-operationsCenter/);
  assert.match(styles, /background-size: 400% 200%/);
});

test("Phase 9 assets satisfy alpha, cell, dimension, and payload budgets", () => {
  const result = spawnSync(process.execPath, ["scripts/validate-assets.mjs"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Assets valid/);
});
