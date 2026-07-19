import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const vite = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)),
  configFile: false,
  server: { middlewareMode: true },
});
const [mapModule, pathfindingModule, simulationModule] = await Promise.all([
  vite.ssrLoadModule("/app/game/map.ts"),
  vite.ssrLoadModule("/app/game/pathfinding.ts"),
  vite.ssrLoadModule("/app/game/simulation.ts"),
]);
const { MAP_SIZE, tileKeyOf } = mapModule;
const { findPath, nearestWalkable, translateSharedPath } = pathfindingModule;
const { Simulation } = simulationModule;

test.after(() => vite.close());

test("Golden Scar pathfinding is deterministic and avoids blocked terrain", () => {
  const first = findPath({ x: 8, y: 8 }, { x: 52, y: 52 });
  const second = findPath({ x: 8, y: 8 }, { x: 52, y: 52 });

  assert.deepEqual(first, second);
  assert.deepEqual(first[0], { x: 8, y: 8 });
  assert.deepEqual(first.at(-1), { x: 52, y: 52 });
  assert.ok(first.every((point) => point.x >= 0 && point.x < MAP_SIZE));
  assert.ok(first.every((point) => point.y >= 0 && point.y < MAP_SIZE));
});

test("blocked and occupied destinations fall back to the nearest legal tile", () => {
  const occupied = new Set([tileKeyOf({ x: 30, y: 20 })]);
  const destination = nearestWalkable(
    { x: 30, y: 20 },
    { occupied },
  );

  assert.ok(destination);
  assert.notDeepEqual(destination, { x: 30, y: 20 });
  assert.equal(occupied.has(tileKeyOf(destination)), false);
});

test("shared formation routes translate without mutating the anchor path", () => {
  const anchor = findPath({ x: 8, y: 8 }, { x: 20, y: 20 });
  const translated = translateSharedPath(anchor, { x: 1, y: 0 });

  assert.ok(translated.length > 0);
  assert.deepEqual(translated[0], {
    x: anchor[0].x + 1,
    y: anchor[0].y,
  });
  assert.deepEqual(anchor[0], { x: 8, y: 8 });
});

test("queued formation commands produce stable fixed-point snapshots", () => {
  const run = () => {
    const simulation = new Simulation();
    simulation.enqueue({
      kind: "selectUnits",
      unitIds: [1, 2, 3, 4, 5, 6],
      additive: false,
    });
    simulation.enqueue({
      kind: "move",
      target: { x: 22, y: 21 },
      mode: "move",
    });
    for (let tick = 0; tick < 240; tick += 1) simulation.step();
    return simulation.snapshot();
  };

  const first = run();
  const second = run();
  assert.deepEqual(first, second);
  assert.equal(first.tick, 240);
  assert.equal(first.selectedUnitIds.length, 6);
  assert.ok(
    first.units.every(
      (unit) =>
        Number.isInteger(unit.position.x) && Number.isInteger(unit.position.y),
    ),
  );
  assert.ok(first.units.some((unit) => unit.position.x > 10_000));
});

test("stop, hold, rally, and control groups stay inside the command queue", () => {
  const simulation = new Simulation();
  simulation.enqueue({
    kind: "selectUnits",
    unitIds: [7, 8, 9],
    additive: false,
  });
  simulation.enqueue({ kind: "assignControlGroup", group: 2 });
  simulation.enqueue({ kind: "setRally", target: { x: 44, y: 45 } });
  simulation.enqueue({ kind: "hold" });
  simulation.step();
  simulation.enqueue({
    kind: "selectUnits",
    unitIds: [],
    additive: false,
  });
  simulation.enqueue({ kind: "recallControlGroup", group: 2 });
  simulation.step();

  const snapshot = simulation.snapshot();
  assert.deepEqual(snapshot.selectedUnitIds, [7, 8, 9]);
  assert.equal(snapshot.rallies.length, 1);
  assert.ok(
    snapshot.units
      .filter((unit) => snapshot.selectedUnitIds.includes(unit.id))
      .every((unit) => unit.order === "hold"),
  );
});
