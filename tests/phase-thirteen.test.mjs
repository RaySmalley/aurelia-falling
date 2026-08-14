import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createServer } from "vite";

const vite = await createServer({
  configFile: false,
  logLevel: "silent",
  server: { middlewareMode: true },
});
const deltaModule = await vite.ssrLoadModule("/app/game/render-delta.ts");
const protocolModule = await vite.ssrLoadModule("/app/game/runtime-protocol.ts");
const runtimeModule = await vite.ssrLoadModule("/app/game/simulation-runtime.ts");
const hostModule = await vite.ssrLoadModule("/app/game/simulation-worker-host.ts");
const bootstrapModule = await vite.ssrLoadModule("/app/game/bootstrap.ts");
const {
  RENDER_DELTA_PROTOCOL_VERSION,
  RenderSnapshotDeltaEncoder,
  RenderSnapshotDeltaStore,
} = deltaModule;
const { InProcessSimulationRuntime } = runtimeModule;
const { startSimulationWorkerHost } = hostModule;
const {
  VIEW_CULL_MARGIN_WORLD,
  pickUnitAtWorldPoint,
  worldPointWithinCameraMargin,
} = bootstrapModule;
const { SIMULATION_RUNTIME_PROTOCOL_VERSION: runtimeVersion } = protocolModule;

test.after(() => vite.close());

test("camera culling retains a safe interaction margin", () => {
  const view = { x: 100, y: 200, width: 800, height: 450 };

  assert.equal(VIEW_CULL_MARGIN_WORLD, 160);
  assert.equal(
    worldPointWithinCameraMargin({ x: -60, y: 200 }, view),
    true,
  );
  assert.equal(
    worldPointWithinCameraMargin({ x: 1_060, y: 650 }, view),
    true,
  );
  assert.equal(
    worldPointWithinCameraMargin({ x: -60.01, y: 200 }, view),
    false,
  );
  assert.equal(
    worldPointWithinCameraMargin({ x: 1_060.01, y: 650 }, view),
    false,
  );
});

test("culled presentation state does not remove units from hit testing", () => {
  const target = {
    id: 7,
    playerId: 2,
    position: { x: 10_000, y: 10_000 },
  };
  const point = { x: 0, y: 320 };
  const distantView = { x: 2_000, y: 2_000, width: 800, height: 450 };

  assert.equal(worldPointWithinCameraMargin(point, distantView), false);
  assert.equal(pickUnitAtWorldPoint([target], point, 2), target);
});

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

test("initial render delta retains selected routes but omits production queues", () => {
  const encoder = new RenderSnapshotDeltaEncoder();
  const delta = encoder.encode(
    snapshot(10, [unit(1), unit(3, { selected: true })], [structure(2)]),
  );

  assert.equal(delta.protocolVersion, RENDER_DELTA_PROTOCOL_VERSION);
  assert.equal(delta.sequence, 1);
  assert.equal(delta.baseSequence, null);
  assert.equal(delta.units.create.length, 2);
  assert.deepEqual(delta.units.create[0].path, []);
  assert.deepEqual(delta.units.create[1].path, [{ x: 4, y: 5 }]);
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

test("unchanged entities do not rematerialize omitted render data", () => {
  const encoder = new RenderSnapshotDeltaEncoder();
  const sourceUnit = unit(1);
  const sourceStructure = structure(2);
  let pathReads = 0;
  let queueReads = 0;
  Object.defineProperty(sourceUnit, "path", {
    enumerable: true,
    get() {
      pathReads += 1;
      return [];
    },
  });
  Object.defineProperty(sourceStructure, "queue", {
    enumerable: true,
    get() {
      queueReads += 1;
      return [];
    },
  });

  encoder.encode(snapshot(1, [sourceUnit], [sourceStructure]));
  assert.equal(pathReads, 1);
  assert.equal(queueReads, 1);
  encoder.encode(snapshot(2, [sourceUnit], [sourceStructure]));
  assert.equal(pathReads, 1);
  assert.equal(queueReads, 1);
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
  assert.deepEqual(state.units[0].path, [{ x: 4, y: 5 }]);
  assert.throws(
    () => store.apply({ ...encoder.encode(snapshot(3, [], [])), sequence: 4 }),
    /sequence gap/,
  );
});

test("selected route changes are value-compared and reconstructed", () => {
  const encoder = new RenderSnapshotDeltaEncoder();
  const store = new RenderSnapshotDeltaStore();
  store.apply(
    encoder.encode(snapshot(1, [unit(3, { selected: true })], [])),
  );

  const unchanged = encoder.encode(
    snapshot(2, [unit(3, { selected: true, path: [{ x: 4, y: 5 }] })], []),
  );
  assert.deepEqual(unchanged.units.update, []);

  const changed = encoder.encode(
    snapshot(3, [unit(3, { selected: true, path: [{ x: 8, y: 9 }] })], []),
  );
  assert.deepEqual(changed.units.update[0].path, [{ x: 8, y: 9 }]);
  assert.deepEqual(store.apply(unchanged).units[0].path, [{ x: 4, y: 5 }]);
  assert.deepEqual(store.apply(changed).units[0].path, [{ x: 8, y: 9 }]);
});

test("delta store accepts a fresh base after a runtime restart", () => {
  const firstEncoder = new RenderSnapshotDeltaEncoder();
  const store = new RenderSnapshotDeltaStore();
  store.apply(firstEncoder.encode(snapshot(1, [unit(1)], [])));

  const restartedEncoder = new RenderSnapshotDeltaEncoder();
  const state = store.apply(
    restartedEncoder.encode(snapshot(1, [unit(9)], [structure(10)])),
  );

  assert.deepEqual(state.units.map(({ id }) => id), [9]);
  assert.deepEqual(state.structures.map(({ id }) => id), [10]);
});

test("metadata updates cannot implicitly reveal hidden entities", () => {
  const encoder = new RenderSnapshotDeltaEncoder();
  const store = new RenderSnapshotDeltaStore();
  store.apply(encoder.encode(snapshot(1, [unit(1)], [])));
  store.apply(encoder.encode(snapshot(2, [], [])));
  const reveal = encoder.encode(snapshot(3, [unit(1, { selected: true })], []));
  const invalidUpdate = {
    ...reveal,
    units: {
      ...reveal.units,
      update: reveal.units.reveal,
      reveal: [],
    },
  };

  assert.throws(() => store.apply(invalidUpdate), /cannot be updated before reveal/);
  assert.deepEqual(store.snapshot().units, []);
});

test("runtime snapshot events carry sequence-checked render deltas", () => {
  const runtime = new InProcessSimulationRuntime();
  const events = [];
  runtime.subscribe((event) => {
    if (event.type === "snapshot") events.push(event);
  });
  runtime.dispatch({
    protocolVersion: runtimeVersion,
    type: "initialize",
    seed: 4_115,
    scenario: "skirmish",
    difficulty: "normal",
    snapshotCadenceTicks: 1,
  });
  runtime.advance();

  const store = new RenderSnapshotDeltaStore();
  const initial = store.apply(events[0].renderDelta);
  const next = store.apply(events[1].renderDelta);
  assert.equal(initial.tick, events[0].snapshot.tick);
  assert.equal(next.tick, events[1].snapshot.tick);
  assert.ok(next.units.length > 0);
  assert.equal("units" in events[1].snapshot, false);
  assert.equal("structures" in events[1].snapshot, false);
});

test("UI snapshots are bounded summaries without entity collections", () => {
  const runtime = new InProcessSimulationRuntime();
  let fullSnapshot;
  runtime.subscribe((event) => {
    if (event.type === "uiSnapshot" && !fullSnapshot) {
      fullSnapshot = event.snapshot;
    }
  });
  runtime.dispatch({
    protocolVersion: runtimeVersion,
    type: "initialize",
    seed: 4_115,
    scenario: "skirmish",
    difficulty: "normal",
  });

  assert.equal("units" in fullSnapshot, false);
  assert.equal("structures" in fullSnapshot, false);
  assert.equal("visibility" in fullSnapshot, false);
  assert.equal(Object.isFrozen(fullSnapshot), true);
  assert.equal(typeof fullSnapshot.friendlyUnitCount, "number");
  assert.equal(typeof fullSnapshot.visibleEnemyCount, "number");
});

test("UI presentation cadence is independent from render cadence", () => {
  const runtime = new InProcessSimulationRuntime();
  const renderTicks = [];
  const uiTicks = [];
  runtime.subscribe((event) => {
    if (event.type === "snapshot") renderTicks.push(event.tick);
    if (event.type === "uiSnapshot") uiTicks.push(event.tick);
  });
  runtime.dispatch({
    protocolVersion: runtimeVersion,
    type: "initialize",
    seed: 4_115,
    scenario: "skirmish",
    difficulty: "normal",
    snapshotCadenceTicks: 2,
    uiCadenceTicks: 10,
  });
  runtime.advance(10);

  assert.deepEqual(renderTicks, [0, 2, 4, 6, 8, 10]);
  assert.deepEqual(uiTicks, [0, 10]);
});

test("accepted player commands force prompt bounded UI feedback", () => {
  const runtime = new InProcessSimulationRuntime();
  const uiTicks = [];
  runtime.subscribe((event) => {
    if (event.type === "uiSnapshot") uiTicks.push(event.tick);
  });
  runtime.dispatch({
    protocolVersion: runtimeVersion,
    type: "initialize",
    seed: 4_115,
    scenario: "skirmish",
    difficulty: "normal",
    snapshotCadenceTicks: 2,
    uiCadenceTicks: 10,
  });
  runtime.dispatch({
    protocolVersion: runtimeVersion,
    type: "command",
    sequence: 0,
    intendedTick: 0,
    command: { kind: "selectUnits", unitIds: [1], additive: false },
  });
  runtime.advance();

  assert.deepEqual(uiTicks, [0, 1]);
});

test("React publication follows UI snapshots instead of render snapshots", async () => {
  const source = await readFile(
    new URL("../app/game/bootstrap.ts", import.meta.url),
    "utf8",
  );
  const renderBranch = source.match(
    /if \(event\.type === "snapshot"\) \{([\s\S]*?)\n    \}/,
  )?.[1];
  const uiBranch = source.match(
    /if \(event\.type === "uiSnapshot"\) \{([\s\S]*?)\n    \}/,
  )?.[1];

  assert.ok(renderBranch);
  assert.equal(renderBranch.includes("emit();"), false);
  assert.match(uiBranch, /lastUiSnapshot = event\.snapshot;[\s\S]*emit\(\);/);
});

test("worker host transfers every packed render-delta buffer", () => {
  let receive = () => {};
  const posted = [];
  const host = startSimulationWorkerHost(
    {
      postMessage: (event, transfer) => posted.push({ event, transfer }),
      subscribe(listener) {
        receive = listener;
        return () => {};
      },
    },
    { start() {}, stop() {} },
  );
  receive({
    protocolVersion: runtimeVersion,
    type: "initialize",
    seed: 4_115,
    scenario: "skirmish",
    difficulty: "normal",
  });

  const published = posted.find(({ event }) => event.type === "snapshot");
  assert.equal(published.transfer.length, 8);
  assert.ok(
    published.transfer.includes(published.event.renderDelta.units.hotValues.buffer),
  );
  host.stop();
});
