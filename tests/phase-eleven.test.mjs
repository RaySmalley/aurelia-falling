import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({
  root,
  configFile: false,
  logLevel: "silent",
  server: { middlewareMode: true },
});
const pathfinding = await vite.ssrLoadModule("/app/game/pathfinding.ts");
const queueModule = await vite.ssrLoadModule(
  "/app/game/path-request-queue.ts",
);
const { createPathSearch, findPath } = pathfinding;
const { DeterministicPathRequestQueue } = queueModule;

test.after(() => vite.close());

test("incremental path searches preserve synchronous path outcomes", () => {
  const occupied = new Set([66, 67, 68, 69]);
  const expected = findPath(
    { x: 1, y: 1 },
    { x: 12, y: 8 },
    { occupied },
  );
  const search = createPathSearch(
    { x: 1, y: 1 },
    { x: 12, y: 8 },
    { occupied },
  );
  const expansions = [];

  while (search.status === "planning") {
    const result = search.advance(3);
    expansions.push(result.expansions);
    assert.ok(result.expansions <= 3);
  }

  assert.equal(search.status, "resolved");
  assert.deepEqual(search.path, expected);
  assert.ok(expansions.length > 1);
});

test("incremental path searches validate and honor zero budgets", () => {
  const search = createPathSearch({ x: 1, y: 1 }, { x: 5, y: 5 });

  assert.deepEqual(search.advance(0), {
    expansions: 0,
    status: "planning",
    path: null,
  });
  assert.throws(() => search.advance(-1), /non-negative integer/);
  assert.throws(() => search.advance(1.5), /non-negative integer/);
});

test("incremental path searches fail deterministically when no route exists", () => {
  const occupied = new Set(
    Array.from({ length: 64 }, (_, x) => 2 * 64 + x),
  );
  const search = createPathSearch(
    { x: 1, y: 1 },
    { x: 1, y: 3 },
    { occupied },
  );

  while (search.status === "planning") search.advance(7);

  assert.equal(search.status, "failed");
  assert.equal(search.path, null);
});

test("path request queues enforce budgets and explicit priority order", () => {
  const queue = new DeterministicPathRequestQueue();
  queue.enqueue({
    key: "background",
    start: { x: 1, y: 1 },
    goal: { x: 20, y: 20 },
    priority: "background",
  });
  queue.enqueue({
    key: "direct",
    start: { x: 2, y: 2 },
    goal: { x: 3, y: 2 },
    priority: "direct",
  });

  assert.equal(queue.stateOf("background"), "queued");
  const first = queue.advance(1);
  assert.equal(first.expansions, 1);
  assert.deepEqual(first.completed, []);
  assert.equal(queue.stateOf("direct"), "planning");
  assert.equal(queue.stateOf("background"), "queued");

  const second = queue.advance(1);
  assert.equal(second.expansions, 1);
  assert.deepEqual(second.completed.map((result) => result.key), ["direct"]);
  assert.equal(queue.stateOf("direct"), null);
});

test("path request queues replace and cancel requests deterministically", () => {
  const queue = new DeterministicPathRequestQueue();
  queue.enqueue({
    key: "unit:7",
    start: { x: 1, y: 1 },
    goal: { x: 30, y: 30 },
    priority: "ai",
  });
  queue.enqueue({
    key: "unit:7",
    start: { x: 1, y: 1 },
    goal: { x: 2, y: 1 },
    priority: "direct",
  });

  assert.equal(queue.size, 1);
  let completed = [];
  while (completed.length === 0) {
    const advanced = queue.advance(1);
    assert.ok(advanced.expansions <= 1);
    completed = advanced.completed;
  }
  assert.deepEqual(completed[0].path, [
    { x: 1, y: 1 },
    { x: 2, y: 1 },
  ]);
  assert.equal(queue.cancel("unit:7"), false);

  queue.enqueue({
    key: "unit:8",
    start: { x: 1, y: 1 },
    goal: { x: 4, y: 4 },
    priority: "combat",
  });
  assert.equal(queue.cancel("unit:8"), true);
  assert.equal(queue.size, 0);
});
