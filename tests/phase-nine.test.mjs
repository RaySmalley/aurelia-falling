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
const { pickStructureAtWorldPoint, structureContainsWorldPoint } =
  await vite.ssrLoadModule("/app/game/bootstrap.ts");

test.after(() => vite.close());

test("Phase 9 structure hit tests follow rendered atlas bounds", () => {
  const citadel = { kind: "citadel", tile: { x: 10, y: 10 } };
  const anchor = { x: 0, y: 320 };

  assert.equal(
    structureContainsWorldPoint(citadel, { x: 55, y: anchor.y }, true),
    true,
    "the visible side of the 112px-wide Citadel should be clickable",
  );
  assert.equal(
    structureContainsWorldPoint(citadel, { x: 0, y: 228 }, true),
    true,
    "the visible roof should be clickable with the 0.8 atlas origin",
  );
  assert.equal(
    structureContainsWorldPoint(citadel, { x: 57, y: anchor.y }, true),
    false,
    "points beyond the atlas width should not select the structure",
  );
  assert.equal(
    structureContainsWorldPoint(citadel, { x: 0, y: 355 }, true),
    false,
    "points below the rendered sprite should not select the structure",
  );
  assert.equal(
    structureContainsWorldPoint(citadel, { x: 55, y: anchor.y }, false),
    false,
    "the procedural fallback should retain its compact legacy radius",
  );
});

test("Phase 9 overlapping structure hits follow rendered depth", () => {
  const citadel = {
    id: 1,
    kind: "citadel",
    playerId: 1,
    tile: { x: 10, y: 10 },
  };
  const reactor = {
    id: 2,
    kind: "reactor",
    playerId: 1,
    tile: { x: 10, y: 9 },
  };
  const roofPoint = { x: 0, y: 228 };

  assert.equal(
    structureContainsWorldPoint(citadel, roofPoint, true),
    true,
  );
  assert.equal(
    structureContainsWorldPoint(reactor, roofPoint, true),
    true,
  );
  assert.equal(
    pickStructureAtWorldPoint(
      [citadel, reactor],
      roofPoint,
      1,
      true,
    ),
    citadel,
    "the lower-screen Citadel is rendered above the closer Reactor",
  );
});

test("Phase 9 same-depth hits follow snapshot display order", () => {
  const earlierCitadel = {
    id: 1,
    kind: "citadel",
    playerId: 1,
    tile: { x: 10, y: 10 },
  };
  const laterReactor = {
    id: 2,
    kind: "reactor",
    playerId: 1,
    tile: { x: 11, y: 9 },
  };
  const overlapPoint = { x: 20, y: 300 };

  assert.equal(
    structureContainsWorldPoint(earlierCitadel, overlapPoint, true),
    true,
  );
  assert.equal(
    structureContainsWorldPoint(laterReactor, overlapPoint, true),
    true,
  );
  assert.equal(
    pickStructureAtWorldPoint(
      [earlierCitadel, laterReactor],
      overlapPoint,
      1,
      true,
    ),
    laterReactor,
    "the later snapshot entry is drawn above same-depth structures",
  );
});

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
  // This test reads the TSX source, so the template expression is intentionally
  // matched literally rather than looking for a rendered screen state.
  assert.match(shell, /screen-\$\{screen\}/);
  assert.match(shell, /structure-portrait portrait-/);
  assert.match(styles, /phase-nine\/battlefield-atlas\.webp/);
  assert.match(
    styles,
    /\.battlefield-frame\s*\{[^}]*position: absolute;[^}]*inset: 0;/s,
  );
  assert.match(styles, /\.economy-deck\s*\{[^}]*position: absolute;/s);
  assert.match(styles, /phase-nine\/structure-atlas\.webp/);
  assert.match(styles, /\.portrait-operationsCenter/);
  assert.match(styles, /background-size: 400% 200%/);
});

test("Phase 9A persistent HUD defines compact safe regions and primary controls", async () => {
  const [shell, styles] = await Promise.all([
    readFile(
      new URL("../app/phase-zero/PhaseZeroShell.tsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(shell, /aria-label="Match status HUD"/);
  assert.match(shell, /aria-label="Primary command HUD"/);
  assert.match(shell, /className="selection-summary"/);
  assert.match(styles, /--hud-safe-top: max\([^;]+safe-area-inset-top/);
  assert.match(styles, /--hud-safe-bottom: max\([^;]+safe-area-inset-bottom/);
  assert.match(styles, /--hud-hit-target: 2\.75rem/);
  assert.match(shell, /const HUD_HIT_TARGET_PX = 44/);
  assert.match(
    shell,
    /"--hud-hit-target": `\$\{HUD_HIT_TARGET_PX \/ settings\.uiScale\}px`/,
  );
  assert.match(
    styles,
    /--command-dock-max-height: clamp\(4\.75rem, 15dvh, 5\.8rem\)/,
  );
  assert.match(styles, /button:focus-visible\s*\{[^}]*outline: 2px solid/s);
  assert.match(
    styles,
    /\.economy-deck button\s*\{[^}]*min-height: var\(--hud-hit-target\)/s,
  );
  assert.match(shell, /useState<ContextPanel \| null>\(null\)/);
  assert.match(shell, /role="dialog"/);
  assert.match(shell, /data-context-panel-close/);
  assert.match(styles, /\.context-panel\s*\{[^}]*position: absolute;/s);
  assert.match(
    styles,
    /\.context-panel-scroll\s*\{[^}]*overflow: auto;/s,
  );
});

test("Phase 9A release overlays expose safe-region and accessibility contracts", async () => {
  const [shell, styles] = await Promise.all([
    readFile(
      new URL("../app/phase-zero/PhaseZeroShell.tsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(shell, /const MINIMUM_VIEWPORT = \{ width: 1024, height: 640 \}/);
  assert.match(shell, /role="alertdialog"/);
  assert.match(shell, /aria-labelledby="viewport-notice-title"/);
  assert.match(shell, /aria-labelledby="runtime-error-title"/);
  assert.match(shell, /aria-labelledby="pause-title"/);
  assert.match(shell, /aria-labelledby="match-result-title"/);
  assert.match(shell, /aria-labelledby="settings-title"/);
  assert.match(shell, /data-overlay-autofocus/);
  assert.match(shell, /event\.key === "Escape"/);
  assert.match(shell, /event\.key !== "Tab"/);
  assert.match(
    styles,
    /\.onboarding-card\s*\{[^}]*top: calc\(var\(--hud-safe-top\) \+ 4\.25rem\);/s,
  );
  assert.match(
    styles,
    /\.solar-warning\s*\{[^}]*right: var\(--hud-safe-right\);/s,
  );
  assert.match(
    styles,
    /@media \(prefers-reduced-motion: reduce\)/,
  );
});

test("Phase 9 assets satisfy alpha, cell, dimension, and payload budgets", () => {
  const result = spawnSync(process.execPath, ["scripts/validate-assets.mjs"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Assets valid/);
});

test("Phase 9 preloaded atlases count toward the menu payload", async () => {
  const manifest = JSON.parse(
    await readFile(
      new URL("../public/assets/asset-manifest.json", import.meta.url),
      "utf8",
    ),
  );
  const phaseNineAtlases = manifest.assets.filter((asset) =>
    asset.path.startsWith("public/assets/phase-nine/"),
  );

  assert.equal(phaseNineAtlases.length, 2);
  for (const atlas of phaseNineAtlases) {
    assert.ok(
      atlas.scopes.includes("menu"),
      `${atlas.path} is preloaded before startMatch and must count toward the menu budget`,
    );
  }
});
