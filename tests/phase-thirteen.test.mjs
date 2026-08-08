import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";

const vite = await createServer({
  configFile: false,
  logLevel: "silent",
  server: { middlewareMode: true },
});
const deltaModule = await vite.ssrLoadModule("/app/game/render-delta.ts");
const {
  RENDER_DELTA_PROTOCOL_VERSION,
  RenderSnapshotDeltaEncoder,
  RenderSnapshotDeltaStore,
} = deltaModule;

test.after(() => vite.close());

const unit = (id, overrides = {}) => ({
  id,
  callsign: `Unit ${id}`,
  playerId: 1,
  kind: "vanguard",
  displayName: "Vanguard",
  armor: "heavy",
  formationId: 0,
  position: { x: 10, y: 20 },
  destination: null,
  selected: false,
  order: "idle",
  pathingState: "idle",
  path: [{ x: 4, y: 5 }],
  health: 100,
  maxHealth: 100,
  weaponId: "rail-rifle",
  targetId: null,
  targetStructureId: null,
  cooldownTicks: 0,
  cargo: 0,
  cargoCapacity: 0,
  ...overrides,
});

const structure = (id, overrides = {}) => ({
  id,
  playerId: 1,
  kind: "reactor",
  displayName: "Reactor",
  tile: { x: 3, y: 4 },
  selected: false,
  health: 500,
  maxHealth: 500,
  constructionRemainingTicks: 0,
  constructionTotalTicks: 100,
  completed: true,
  powered: true,
  connected: true,
  repairing: false,
  powerGenerated: 100,
  powerConsumed: 0,
  buildRadius: 6,
  queue: [{ unitKind: "vanguard", remainingTicks: 10, totalTicks: 20 }],
  ...overrides,
});

const snapshot = (tick, units, structures) => ({ tick, units, structures });

test("initial render delta creates entities without paths or production queues", () => {
  const encoder = new RenderSnapshotDeltaEncoder();
  const delta = encoder.encode(snapshot(10, [unit(1)], [structure(2)]));

  assert.equal(delta.protocolVersion, RENDER_DELTA_PROTOCOL_VERSION);
  assert.equal(delta.sequence, 1);
  assert.equal(delta.baseSequence, null);
  assert.equal(delta.units.create.length, 1);
  assert.equal("path" in delta.units.create[0], false);
  assert.equal(delta.structures.create.length, 1);
  assert.equal("queue" in delta.structures.create[0], false);
});

test("unchanged snapshots have constant-size empty entity payloads", () => {
  const encoder = new RenderSnapshotDeltaEncoder();
  const state = snapshot(10, [unit(1)], [structure(2)]);
  encoder.encode(state);
  const delta = encoder.encode({ ...state, tick: 12 });

  assert.deepEqual(delta.units.create, []);
  assert.deepEqual(delta.units.update, []);
  assert.equal(delta.units.hotIds.length, 0);
  assert.equal(delta.units.hotValues.length, 0);
  assert.deepEqual(delta.structures.create, []);
  assert.deepEqual(delta.structures.update, []);
  assert.equal(delta.structures.hotIds.length, 0);
});

test("hot unit and structure changes use packed numeric arrays", () => {
  const encoder = new RenderSnapshotDeltaEncoder();
  encoder.encode(snapshot(1, [unit(7)], [structure(9)]));
  const delta = encoder.encode(
    snapshot(
      2,
      [unit(7, { position: { x: 11.5, y: 21.25 }, health: 75, cargo: 4 })],
      [structure(9, { health: 450, constructionRemainingTicks: 8 })],
    ),
  );

  assert.ok(delta.units.hotIds instanceof Uint32Array);
  assert.ok(delta.units.hotValues instanceof Float64Array);
  assert.deepEqual([...delta.units.hotIds], [7]);
  assert.deepEqual([...delta.units.hotValues], [11.5, 21.25, 75, 0, 4]);
  assert.deepEqual([...delta.structures.hotIds], [9]);
  assert.deepEqual([...delta.structures.hotValues], [450, 8]);
});

test("metadata updates cannot duplicate packed hot fields", () => {
  const encoder = new RenderSnapshotDeltaEncoder();
  encoder.encode(snapshot(1, [unit(7)], [structure(9)]));
  const delta = encoder.encode(
    snapshot(
      2,
      [unit(7, { selected: true, health: 75 })],
      [structure(9, { repairing: true, health: 450 })],
    ),
  );

  assert.equal(delta.units.update[0].selected, true);
  assert.equal("health" in delta.units.update[0], false);
  assert.equal("position" in delta.units.update[0], false);
  assert.equal(delta.structures.update[0].repairing, true);
  assert.equal("health" in delta.structures.update[0], false);
});

test("visibility transitions are distinct from authoritative destruction", () => {
  const encoder = new RenderSnapshotDeltaEncoder();
  encoder.encode(snapshot(1, [unit(1), unit(2)], []));
  const hidden = encoder.encode(snapshot(2, [unit(2)], []));
  const revealed = encoder.encode(snapshot(3, [unit(1), unit(2)], []));
  const destroyed = encoder.encode(snapshot(4, [unit(1)], []), {
    destroyedUnitIds: [2],
  });

  assert.deepEqual([...hidden.units.hide], [1]);
  assert.equal(revealed.units.reveal[0].id, 1);
  assert.deepEqual([...destroyed.units.destroy], [2]);
});

test("authoritative destruction removes entities that were already hidden", () => {
  const encoder = new RenderSnapshotDeltaEncoder();
  encoder.encode(snapshot(1, [unit(1)], [structure(2)]));
  encoder.encode(snapshot(2, [], []));
  const destroyed = encoder.encode(snapshot(3, [], []), {
    destroyedUnitIds: [1],
    destroyedStructureIds: [2],
  });

  assert.deepEqual([...destroyed.units.destroy], [1]);
  assert.deepEqual([...destroyed.structures.destroy], [2]);
});

test("delta store reconstructs visible state and rejects sequence gaps", () => {
  const encoder = new RenderSnapshotDeltaEncoder();
  const store = new RenderSnapshotDeltaStore();
  store.apply(encoder.encode(snapshot(1, [unit(3)], [structure(4)])));
  const state = store.apply(
    encoder.encode(
      snapshot(2, [unit(3, { health: 81, selected: true })], [structure(4)]),
    ),
  );

  assert.equal(state.sequence, 2);
  assert.equal(state.units[0].health, 81);
  assert.equal(state.units[0].selected, true);
  assert.throws(
    () => store.apply({ ...encoder.encode(snapshot(3, [], [])), sequence: 4 }),
    /sequence gap/,
  );
});
