import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Phaser remains behind the client-only dynamic import boundary", async () => {
  const page = await read("app/page.tsx");
  const shell = await read("app/phase-zero/PhaseZeroShell.tsx");
  const bootstrap = await read("app/game/bootstrap.ts");

  assert.doesNotMatch(page, /phaser/i);
  assert.match(shell, /^"use client";/);
  assert.match(shell, /await import\("\.\.\/game\/bootstrap"\)/);
  assert.match(bootstrap, /await import\("phaser"\)/);
});

test("Phase 0 preserves command queue and fixed-step architecture", async () => {
  const simulation = await read("app/game/simulation.ts");
  const bootstrap = await read("app/game/bootstrap.ts");
  const shell = await read("app/phase-zero/PhaseZeroShell.tsx");

  assert.match(simulation, /commands: SimCommand\[\]/);
  assert.match(simulation, /TICKS_PER_SECOND = 20/);
  assert.match(bootstrap, /while \(accumulator >= SIM_STEP_MS\)/);
  assert.match(shell, /visibilitychange/);
  assert.match(shell, /pause\("hidden"\)/);
});

test("the economy command HUD stays hidden until the match starts", async () => {
  const shell = await read("app/phase-zero/PhaseZeroShell.tsx");

  assert.match(
    shell,
    /\{screen === "playing" && \(\s*<>[\s\S]*<section className="economy-deck"/,
  );
});
