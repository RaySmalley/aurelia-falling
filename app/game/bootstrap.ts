import { BLOCKED_TILES, MAP_SIZE, TILE_MILLI } from "./map";
import { gameData } from "./data";
import {
  isContinuousAudioTransition,
  ProceduralAudio,
} from "./audio";
import { createBrowserSimulationWorkerRuntime } from "./browser-simulation-worker-runtime";
import {
  SIMULATION_TICK_INTERVAL_MS,
  SimulationWorkerSession,
} from "./simulation-worker-session";
import { DEFAULT_SNAPSHOT_CADENCE_TICKS } from "./runtime-protocol";
import type {
  RenderStructureSnapshot,
  RenderUnitSnapshot,
} from "./render-delta";
import type {
  AudioCueSnapshot,
  AudioSettings,
  AureliteFieldSnapshot,
  BuildingKind,
  GameRuntime,
  RuntimeListener,
  RuntimeSnapshot,
  SimCommand,
  SimulationRenderFrame,
  SimulationSnapshot,
  SimulationUiSnapshot,
  StructureSnapshot,
  UnitSnapshot,
  Vec2,
} from "./types";
import { BoundedKeyedPool } from "./view-pool";

const TILE_WIDTH = 64;
const TILE_HEIGHT = 32;
const CAMERA_CENTER = Object.freeze({ x: 0, y: 390 });
const FOG_LEFT = -(MAP_SIZE * TILE_WIDTH) / 2;
const FOG_TOP = -TILE_HEIGHT / 2;
const FOG_WIDTH = MAP_SIZE * TILE_WIDTH;
const FOG_HEIGHT = MAP_SIZE * TILE_HEIGHT;
const UNIT_ATLAS_FRAME = Object.freeze({
  midasHarvester: 0,
  argusRifle: 8,
  cyclopsRocket: 16,
  hermesScout: 24,
  atlasTank: 32,
  gorgonWalker: 40,
} satisfies Record<UnitSnapshot["kind"], number>);
const UNIT_ATLAS_SIZE = Object.freeze({
  midasHarvester: [78, 101],
  argusRifle: [58, 75],
  cyclopsRocket: [62, 81],
  hermesScout: [72, 94],
  atlasTank: [80, 104],
  gorgonWalker: [86, 112],
} satisfies Record<UnitSnapshot["kind"], readonly [number, number]>);
const STRUCTURE_ATLAS_FRAME = Object.freeze({
  citadel: 0,
  reactor: 1,
  refinery: 2,
  barracks: 3,
  foundry: 4,
  operationsCenter: 5,
  turret: 6,
} satisfies Record<BuildingKind, number>);
const STRUCTURE_ATLAS_SIZE = Object.freeze({
  citadel: [112, 126],
  reactor: [104, 117],
  refinery: [112, 126],
  barracks: [102, 115],
  foundry: [108, 122],
  operationsCenter: [106, 126],
  turret: [96, 108],
} satisfies Record<BuildingKind, readonly [number, number]>);
const STRUCTURE_ATLAS_OFFSET_Y = 8;
const STRUCTURE_ATLAS_ORIGIN_Y = 0.8;
const PROCEDURAL_STRUCTURE_HIT_RADIUS = 38;
export const VIEW_CULL_MARGIN_WORLD = 160;
export const UNIT_VIEW_POOL_CAPACITY = 128;
export const STRUCTURE_VIEW_POOL_CAPACITY = 64;
const BATTLEFIELD_ATLAS_FRAME = Object.freeze({
  groundA: 0,
  groundB: 1,
  blockedA: 2,
  blockedB: 3,
  crater: 4,
  fracture: 5,
  aureliteField: 6,
  aureliteIcon: 7,
});

function gridToWorld(point: Vec2) {
  return {
    x: (point.x - point.y) * (TILE_WIDTH / 2),
    y: (point.x + point.y) * (TILE_HEIGHT / 2),
  };
}

function structureRenderDepth(tile: Vec2) {
  return 9 + gridToWorld(tile).y / 10_000;
}

function fixedToWorld(point: Vec2) {
  return gridToWorld({
    x: point.x / TILE_MILLI,
    y: point.y / TILE_MILLI,
  });
}

type CameraWorldView = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;

function healthColor(ratio: number) {
  return ratio > 0.55 ? 0x79e0d3 : ratio > 0.25 ? 0xe6a63f : 0xf06d5c;
}

export function unitOverlayStyle(
  unit: UnitSnapshot,
  controlledPlayer: SimulationSnapshot["controlledPlayer"],
) {
  const heavy = unit.armor === "heavy" || unit.armor === "siege";
  const cargoVisible =
    unit.kind === "midasHarvester" &&
    unit.playerId === controlledPlayer &&
    (unit.selected || unit.cargo > 0);
  return {
    healthWidth: heavy ? 40 : 34,
    healthRatio: unit.health / unit.maxHealth,
    selectionSize: heavy ? ([52, 24] as const) : ([45, 20] as const),
    cargoRatio:
      cargoVisible && unit.cargoCapacity > 0
        ? Math.min(1, unit.cargo / unit.cargoCapacity)
        : cargoVisible
          ? 0
          : null,
  };
}

export function structureStatusValuesEqual(
  left: StructureSnapshot,
  right: StructureSnapshot,
) {
  return (
    left.health === right.health &&
    left.maxHealth === right.maxHealth &&
    left.playerId === right.playerId &&
    left.completed === right.completed &&
    left.constructionRemainingTicks === right.constructionRemainingTicks &&
    left.constructionTotalTicks === right.constructionTotalTicks &&
    left.powered === right.powered &&
    left.connected === right.connected
  );
}

export function structureOverlayStyle(structure: StructureSnapshot) {
  const healthRatio = structure.health / structure.maxHealth;
  return {
    healthRatio,
    healthColor: healthColor(healthRatio),
    constructionRatio: structure.completed
      ? null
      : 1 -
        structure.constructionRemainingTicks /
          Math.max(1, structure.constructionTotalTicks),
    warning: !structure.completed
      ? null
      : !structure.powered
        ? "unpowered"
        : !structure.connected
          ? "disconnected"
          : null,
  } as const;
}

export function fieldAmountValuesEqual(
  left: AureliteFieldSnapshot,
  right: AureliteFieldSnapshot,
) {
  return (
    left.amount === right.amount &&
    left.capacity === right.capacity &&
    left.contested === right.contested
  );
}

function cameraWorldViewsEqual(
  left: CameraWorldView | null,
  right: CameraWorldView,
) {
  return (
    left !== null &&
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  );
}

export function worldPointWithinCameraMargin(
  point: Vec2,
  view: CameraWorldView,
  margin = VIEW_CULL_MARGIN_WORLD,
) {
  return (
    point.x >= view.x - margin &&
    point.x <= view.x + view.width + margin &&
    point.y >= view.y - margin &&
    point.y <= view.y + view.height + margin
  );
}

function withRenderEntities(
  snapshot: SimulationRenderFrame,
  render: Readonly<{
    units: readonly RenderUnitSnapshot[];
    structures: readonly RenderStructureSnapshot[];
  }>,
): SimulationSnapshot {
  return {
    ...snapshot,
    units: render.units,
    structures: render.structures.map((structure) => ({
      ...structure,
      queue: [],
    })),
  };
}

export function structureContainsWorldPoint(
  structure: Pick<StructureSnapshot, "kind" | "tile">,
  point: Vec2,
  atlasAvailable: boolean,
) {
  const world = gridToWorld(structure.tile);
  const dx = point.x - world.x;
  const dy = point.y - world.y;
  if (!atlasAvailable) {
    return (
      dx * dx + dy * dy <=
      PROCEDURAL_STRUCTURE_HIT_RADIUS * PROCEDURAL_STRUCTURE_HIT_RADIUS
    );
  }

  const [width, height] = STRUCTURE_ATLAS_SIZE[structure.kind];
  const spriteY = world.y + STRUCTURE_ATLAS_OFFSET_Y;
  const localY = point.y - spriteY;
  return (
    Math.abs(dx) <= width / 2 &&
    localY >= -height * STRUCTURE_ATLAS_ORIGIN_Y &&
    localY <= height * (1 - STRUCTURE_ATLAS_ORIGIN_Y)
  );
}

type StructureHitTarget = Pick<
  StructureSnapshot,
  "id" | "kind" | "playerId" | "tile"
>;

type UnitHitTarget = Pick<UnitSnapshot, "id" | "playerId" | "position">;

export function pickUnitAtWorldPoint<T extends UnitHitTarget>(
  units: readonly T[],
  point: Vec2,
  playerId: UnitSnapshot["playerId"],
  radius = 34,
) {
  return units
    .filter((unit) => unit.playerId === playerId)
    .map((unit) => {
      const world = fixedToWorld(unit.position);
      const dx = world.x - point.x;
      const dy = world.y - point.y;
      return { unit, distanceSquared: dx * dx + dy * dy };
    })
    .filter((candidate) => candidate.distanceSquared <= radius * radius)
    .sort(
      (left, right) =>
        left.distanceSquared - right.distanceSquared ||
        left.unit.id - right.unit.id,
    )[0]?.unit;
}

export function pickStructureAtWorldPoint<T extends StructureHitTarget>(
  structures: readonly T[],
  point: Vec2,
  playerId: StructureSnapshot["playerId"],
  atlasAvailable: boolean,
) {
  return structures
    .filter((structure) => structure.playerId === playerId)
    .map((structure, snapshotOrder) => {
      const world = gridToWorld(structure.tile);
      const dx = world.x - point.x;
      const dy = world.y - point.y;
      return {
        structure,
        renderDepth: structureRenderDepth(structure.tile),
        snapshotOrder,
        distanceSquared: dx * dx + dy * dy,
      };
    })
    .filter((candidate) =>
      structureContainsWorldPoint(
        candidate.structure,
        point,
        atlasAvailable,
      ),
    )
    .sort((left, right) => {
      const depthOrder = atlasAvailable
        ? right.renderDepth - left.renderDepth
        : 0;
      const displayOrder = atlasAvailable
        ? right.snapshotOrder - left.snapshotOrder
        : 0;
      return (
        depthOrder ||
        displayOrder ||
        left.distanceSquared - right.distanceSquared ||
        left.structure.id - right.structure.id
      );
    })[0]?.structure;
}

function canCreateWebGLContext() {
  try {
    return Boolean(document.createElement("canvas").getContext("webgl"));
  } catch {
    return false;
  }
}

function worldToGrid(point: Vec2): Vec2 {
  return {
    x: point.x / TILE_WIDTH + point.y / TILE_HEIGHT,
    y: point.y / TILE_HEIGHT - point.x / TILE_WIDTH,
  };
}

export async function createGameRuntime(
  host: HTMLDivElement,
): Promise<GameRuntime> {
  const workerSession = new SimulationWorkerSession(
    createBrowserSimulationWorkerRuntime(),
    {
      seed: 4_115,
      scenario: "skirmish",
      difficulty: "normal",
    },
  );
  let Phaser: typeof import("phaser");
  let initialUiSnapshot: SimulationUiSnapshot;
  try {
    [Phaser, initialUiSnapshot] = await Promise.all([
      import("phaser"),
      workerSession.initialize(),
    ]);
  } catch (error) {
    workerSession.terminate();
    throw error;
  }
  const listeners = new Set<RuntimeListener>();
  const initialRenderFrame = workerSession.renderFrame();
  if (!initialRenderFrame) {
    workerSession.terminate();
    throw new Error("Simulation worker did not publish an initial render frame.");
  }
  let paused = false;
  let pauseReason: RuntimeSnapshot["pauseReason"] = null;
  let audioReady = false;
  let cameraMoved = false;
  let cameraZoom = 1;
  let reducedScreenShake = false;
  let pendingBuilding: BuildingKind | null = null;
  let solarTargeting = false;
  let audioCue: AudioCueSnapshot | null = null;
  let nextAudioCueId = 1;
  let renderer = "initializing";
  let runtimeError: string | null = null;
  let lastUiSnapshot = initialUiSnapshot;
  let lastRenderSnapshot = withRenderEntities(
    initialRenderFrame,
    workerSession.renderSnapshot(),
  );
  let lastSnapshot = lastRenderSnapshot;
  let previousRenderSnapshot = lastRenderSnapshot;
  let lastSnapshotReceivedAt = performance.now();
  let detachKeyboardCaptureGuard = () => {};
  let refreshKeyboardInput = () => {};
  let gameplayInputEnabled = false;
  let pendingFogMemoryResetAtTick: number | null = null;
  let fogMemoryResetReady = false;

  const emit = () => {
    const snapshot: RuntimeSnapshot = {
      simulation: lastUiSnapshot,
      paused,
      pauseReason,
      audioReady,
      cameraMoved,
      pendingBuilding,
      solarTargeting,
      audioCue,
      renderer,
      cameraZoom,
      runtimeError,
    };
    listeners.forEach((listener) => listener(snapshot));
  };
  const setTargetingModes = (
    nextBuilding: BuildingKind | null,
    nextSolarTargeting: boolean,
  ) => {
    if (
      pendingBuilding === nextBuilding &&
      solarTargeting === nextSolarTargeting
    ) {
      return;
    }
    pendingBuilding = nextBuilding;
    solarTargeting = nextSolarTargeting;
    emit();
  };
  const resetTargetingModes = () => setTargetingModes(null, false);
  const proceduralAudio = new ProceduralAudio((text) => {
    audioCue = Object.freeze({ id: nextAudioCueId, text });
    nextAudioCueId += 1;
    emit();
  });
  const unsubscribeWorkerSession = workerSession.subscribe((event) => {
    if (event.type === "snapshot") {
      const nextRenderSnapshot = withRenderEntities(
        event.snapshot,
        workerSession.renderSnapshot(),
      );
      if (
        pendingFogMemoryResetAtTick !== null &&
        event.tick >= pendingFogMemoryResetAtTick
      ) {
        previousRenderSnapshot = nextRenderSnapshot;
        pendingFogMemoryResetAtTick = null;
        fogMemoryResetReady = true;
      } else if (
        isContinuousAudioTransition(
          lastSnapshot,
          nextRenderSnapshot,
          DEFAULT_SNAPSHOT_CADENCE_TICKS,
        )
      ) {
        previousRenderSnapshot = lastRenderSnapshot;
        proceduralAudio.observe(lastSnapshot, nextRenderSnapshot);
      } else {
        previousRenderSnapshot = nextRenderSnapshot;
      }
      lastSnapshot = nextRenderSnapshot;
      lastRenderSnapshot = nextRenderSnapshot;
      lastSnapshotReceivedAt = performance.now();
      return;
    }
    if (event.type === "uiSnapshot") {
      lastUiSnapshot = event.snapshot;
      emit();
      return;
    }
    if (event.type === "pauseChanged") {
      paused = event.paused;
      pauseReason = event.reasons.includes("hidden")
        ? "hidden"
        : event.reasons.includes("manual")
          ? "manual"
          : null;
      proceduralAudio.setPaused(paused);
      emit();
      return;
    }
    if (event.type === "error") {
      paused = true;
      runtimeError = event.message;
      proceduralAudio.setPaused(true);
      emit();
    }
  });

  class OperationsScene extends Phaser.Scene {
    private cursorKeys!: Phaser.Types.Input.Keyboard.CursorKeys;
    private cameraKeys!: Record<string, Phaser.Input.Keyboard.Key>;
    private shiftKey!: Phaser.Input.Keyboard.Key;
    private ctrlKey!: Phaser.Input.Keyboard.Key;
    private selectionBox!: Phaser.GameObjects.Graphics;
    private selectionGraphics!: Phaser.GameObjects.Graphics;
    private meterGraphics!: Phaser.GameObjects.Graphics;
    private routeGraphics!: Phaser.GameObjects.Graphics;
    private rallyGraphics!: Phaser.GameObjects.Graphics;
    private projectileGraphics!: Phaser.GameObjects.Graphics;
    private buildRadiusGraphics!: Phaser.GameObjects.Graphics;
    private solarGraphics!: Phaser.GameObjects.Graphics;
    private fogTexture!: Phaser.GameObjects.RenderTexture;
    private fogScratch!: Phaser.GameObjects.Graphics;
    private lastFogRevision = -1;
    private orderMarker!: Phaser.GameObjects.Arc;
    private dragStart: Phaser.Math.Vector2 | null = null;
    private unitViews = new Map<number, Phaser.GameObjects.Container>();
    private unitViewPool = new BoundedKeyedPool<
      string,
      Phaser.GameObjects.Container
    >(UNIT_VIEW_POOL_CAPACITY);
    private unitViewPoolKeys = new WeakMap<
      Phaser.GameObjects.Container,
      string
    >();
    private unitFacings = new Map<number, number>();
    private structureViews = new Map<number, Phaser.GameObjects.Container>();
    private structureViewPool = new BoundedKeyedPool<
      string,
      Phaser.GameObjects.Container
    >(STRUCTURE_VIEW_POOL_CAPACITY);
    private structureViewPoolKeys = new WeakMap<
      Phaser.GameObjects.Container,
      string
    >();
    private structureStatusSnapshots = new Map<number, StructureSnapshot>();
    private staleStructureViews = new Map<
      number,
      Phaser.GameObjects.Container
    >();
    private staleStructureMemory = new Map<number, StructureSnapshot>();
    private fieldViews = new Map<number, Phaser.GameObjects.Container>();
    private fieldAmountSnapshots = new Map<number, AureliteFieldSnapshot>();
    private lastRouteSnapshot: SimulationSnapshot | null = null;
    private lastProjectileSnapshot: SimulationSnapshot | null = null;
    private lastProjectileCameraView: CameraWorldView | null = null;
    private lastBuildRadiusSnapshot: SimulationSnapshot | null = null;
    private lastSolarSnapshot: SimulationSnapshot | null = null;
    private lastImpactShakeTick = -1;
    private pendingOrder: "move" | "attackMove" | "rally" = "move";

    constructor() {
      super("operations");
    }

    preload() {
      this.load.spritesheet(
        "unit-facing-atlas",
        "/assets/phase-six/unit-facing-atlas.webp",
        {
          frameWidth: 160,
          frameHeight: 208,
          startFrame: 0,
          endFrame: 47,
        },
      );
      this.load.spritesheet(
        "structure-atlas",
        "/assets/phase-nine/structure-atlas.webp",
        {
          frameWidth: 256,
          frameHeight: 288,
          startFrame: 0,
          endFrame: 7,
        },
      );
      this.load.spritesheet(
        "battlefield-atlas",
        "/assets/phase-nine/battlefield-atlas.webp",
        {
          frameWidth: 256,
          frameHeight: 288,
          startFrame: 0,
          endFrame: 7,
        },
      );
    }

    create() {
      this.cameras.main.setBackgroundColor("#071318");
      this.drawTerrain();
      this.routeGraphics = this.add.graphics().setDepth(8);
      this.rallyGraphics = this.add.graphics().setDepth(7);
      this.projectileGraphics = this.add.graphics().setDepth(24);
      this.selectionGraphics = this.add.graphics().setDepth(9);
      this.meterGraphics = this.add.graphics().setDepth(25);
      this.buildRadiusGraphics = this.add.graphics().setDepth(6);
      this.solarGraphics = this.add.graphics().setDepth(70);
      this.fogTexture = this.add
        .renderTexture(
          FOG_LEFT,
          FOG_TOP,
          FOG_WIDTH,
          FOG_HEIGHT,
        )
        .setOrigin(0, 0)
        .setDepth(60);
      this.fogScratch = this.add.graphics();
      this.selectionBox = this.add.graphics().setDepth(100);
      this.orderMarker = this.add
        .circle(0, 0, 9, 0x000000, 0)
        .setStrokeStyle(2, 0xf4bd55, 0.95)
        .setDepth(30)
        .setVisible(false);
      this.syncUnitViews(lastRenderSnapshot);
      this.syncStructureViews(lastRenderSnapshot);
      this.syncFieldViews(lastSnapshot);
      this.drawFog(lastSnapshot);

      const worldWidth = MAP_SIZE * TILE_WIDTH + 900;
      const worldHeight = MAP_SIZE * TILE_HEIGHT + 440;
      this.cameras.main.setBounds(
        -worldWidth / 2,
        -180,
        worldWidth,
        worldHeight,
      );
      this.cameras.main.centerOn(CAMERA_CENTER.x, CAMERA_CENTER.y);
      this.cameras.main.setZoom(cameraZoom);

      this.cursorKeys = this.input.keyboard!.createCursorKeys();
      this.cameraKeys = this.input.keyboard!.addKeys(
        "W,A,S,D",
      ) as Record<string, Phaser.Input.Keyboard.Key>;
      this.shiftKey = this.input.keyboard!.addKey("SHIFT");
      this.ctrlKey = this.input.keyboard!.addKey("CTRL");
      this.input.keyboard!.addCapture(
        "UP,DOWN,LEFT,RIGHT,W,A,S,D,F,X,H,R,ONE,TWO,THREE",
      );
      const keyboard = this.input.keyboard!;
      const ownerWindow = host.ownerDocument.defaultView!;
      const isTextEntryControl = (target: EventTarget | null) =>
        target instanceof ownerWindow.HTMLElement &&
        (target.matches("input, select, textarea") ||
          target.isContentEditable);
      const syncKeyboardInput = (target: EventTarget | null) => {
        const textEntryFocused = isTextEntryControl(target);
        keyboard.enabled = gameplayInputEnabled && !textEntryFocused;
        if (!keyboard.enabled) {
          keyboard.resetKeys();
          keyboard.disableGlobalCapture();
        } else {
          keyboard.enableGlobalCapture();
        }
      };
      const guardFormKey = (event: KeyboardEvent) => {
        syncKeyboardInput(event.target);
      };
      refreshKeyboardInput = () => {
        syncKeyboardInput(host.ownerDocument.activeElement);
        if (!gameplayInputEnabled) this.pendingOrder = "move";
      };
      ownerWindow.addEventListener("keydown", guardFormKey, true);
      ownerWindow.addEventListener("keyup", guardFormKey, true);
      detachKeyboardCaptureGuard = () => {
        ownerWindow.removeEventListener("keydown", guardFormKey, true);
        ownerWindow.removeEventListener("keyup", guardFormKey, true);
      };

      this.input.keyboard!.on("keydown-F", () => {
        if (!gameplayInputEnabled) return;
        this.pendingOrder = "attackMove";
      });
      this.input.keyboard!.on("keydown-R", () => {
        if (!gameplayInputEnabled) return;
        this.pendingOrder = "rally";
      });
      this.input.keyboard!.on("keydown-X", () => {
        if (!gameplayInputEnabled) return;
        workerSession.enqueue({ kind: "stop" });
      });
      this.input.keyboard!.on("keydown-H", () => {
        if (!gameplayInputEnabled) return;
        workerSession.enqueue({ kind: "hold" });
      });
      for (let group = 1; group <= 3; group += 1) {
        const key = this.input.keyboard!.addKey(String(group));
        key.on("down", () => {
          if (!gameplayInputEnabled) return;
          workerSession.enqueue(
            this.ctrlKey.isDown
              ? { kind: "assignControlGroup", group }
              : { kind: "recallControlGroup", group },
          );
        });
      }

      this.input.mouse?.disableContextMenu();
      this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
        const world = pointer.positionToCamera(
          this.cameras.main,
        ) as Phaser.Math.Vector2;
        if (solarTargeting) {
          const targetGrid = worldToGrid(world);
          workerSession.enqueue({
            kind: "launchSolarSpear",
            target: {
              x: Math.round(targetGrid.x),
              y: Math.round(targetGrid.y),
            },
          });
          setTargetingModes(pendingBuilding, false);
          return;
        }
        if (pointer.rightButtonDown()) {
          const targetGrid = worldToGrid(world);
          const target = {
            x: Math.round(targetGrid.x),
            y: Math.round(targetGrid.y),
          };
          if (pendingBuilding) {
            workerSession.enqueue({
              kind: "placeBuilding",
              buildingKind: pendingBuilding,
              tile: target,
            });
            return;
          }
          const enemyPlayer =
            lastSnapshot.controlledPlayer === 1 ? 2 : 1;
          const targetedEnemy = this.unitAtWorldPoint(world, enemyPlayer);
          const targetedStructure = this.structureAtWorldPoint(
            world,
            enemyPlayer,
          );
          if (targetedEnemy && this.pendingOrder !== "rally") {
            workerSession.enqueue({
              kind: "attackUnit",
              targetUnitId: targetedEnemy.id,
            });
            this.orderMarker
              .setPosition(world.x, world.y)
              .setStrokeStyle(2, 0xf06d5c, 0.95)
              .setVisible(true);
          } else if (targetedStructure && this.pendingOrder !== "rally") {
            workerSession.enqueue({
              kind: "attackStructure",
              targetStructureId: targetedStructure.id,
            });
            this.orderMarker
              .setPosition(world.x, world.y)
              .setStrokeStyle(2, 0xf06d5c, 0.95)
              .setVisible(true);
          } else if (this.pendingOrder === "rally") {
            workerSession.enqueue({ kind: "setRally", target });
          } else {
            workerSession.enqueue({
              kind: "move",
              target,
              mode: this.pendingOrder,
            });
            this.orderMarker
              .setPosition(world.x, world.y)
              .setStrokeStyle(
                2,
                this.pendingOrder === "attackMove" ? 0xf06d5c : 0xf4bd55,
                0.95,
              )
              .setVisible(true);
          }
          this.pendingOrder = "move";
          return;
        }

        if (pointer.leftButtonDown()) {
          this.dragStart = world.clone();
        }
      });

      this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
        if (!this.dragStart || !pointer.isDown) return;
        const world = pointer.positionToCamera(
          this.cameras.main,
        ) as Phaser.Math.Vector2;
        this.drawSelectionBox(this.dragStart, world);
      });

      this.input.on("pointerup", (pointer: Phaser.Input.Pointer) => {
        if (!this.dragStart || pointer.button !== 0) return;
        const world = pointer.positionToCamera(
          this.cameras.main,
        ) as Phaser.Math.Vector2;
        this.completeSelection(this.dragStart, world);
        this.dragStart = null;
        this.selectionBox.clear();
      });

      renderer = `${
        this.game.renderer.type === Phaser.WEBGL ? "WebGL" : "Canvas"
      } · ${
        this.textures.exists("unit-facing-atlas")
          ? "industrial atlas"
          : "procedural fallback"
      }`;
      emit();
    }

    update(_: number, delta: number) {
      if (fogMemoryResetReady) {
        this.clearStaleFogMemory();
        fogMemoryResetReady = false;
      }

      this.updateCamera(delta);
      const cameraView = this.cameras.main.worldView;
      this.syncUnitViews(lastRenderSnapshot);
      this.syncStructureViews(lastRenderSnapshot, cameraView);
      this.syncStaleStructureViews(lastRenderSnapshot, cameraView);
      this.syncFieldViews(lastSnapshot, cameraView);
      this.renderUnits(
        previousRenderSnapshot,
        lastRenderSnapshot,
        paused
          ? 1
          : Math.min(
              1,
              (performance.now() - lastSnapshotReceivedAt) /
                (DEFAULT_SNAPSHOT_CADENCE_TICKS *
                  SIMULATION_TICK_INTERVAL_MS),
            ),
        cameraView,
      );
      this.drawRoutes(lastSnapshot);
      this.drawProjectiles(lastSnapshot, cameraView);
      this.drawBuildRadii(lastSnapshot);
      this.drawFog(lastSnapshot);
      this.drawSolarSpear(lastSnapshot);
    }

    private updateCamera(delta: number) {
      if (!gameplayInputEnabled) return;
      const cameraSpeed = 0.46 * delta;
      const moved =
        this.cursorKeys.left.isDown ||
        this.cameraKeys.A.isDown ||
        this.cursorKeys.right.isDown ||
        this.cameraKeys.D.isDown ||
        this.cursorKeys.up.isDown ||
        this.cameraKeys.W.isDown ||
        this.cursorKeys.down.isDown ||
        this.cameraKeys.S.isDown;
      if (moved && !cameraMoved) {
        cameraMoved = true;
        emit();
      }
      if (this.cursorKeys.left.isDown || this.cameraKeys.A.isDown)
        this.cameras.main.scrollX -= cameraSpeed;
      if (this.cursorKeys.right.isDown || this.cameraKeys.D.isDown)
        this.cameras.main.scrollX += cameraSpeed;
      if (this.cursorKeys.up.isDown || this.cameraKeys.W.isDown)
        this.cameras.main.scrollY -= cameraSpeed;
      if (this.cursorKeys.down.isDown || this.cameraKeys.S.isDown)
        this.cameras.main.scrollY += cameraSpeed;
    }

    private drawSolarSpear(snapshot: SimulationSnapshot) {
      if (this.lastSolarSnapshot === snapshot) return;
      this.lastSolarSnapshot = snapshot;
      this.solarGraphics.clear();
      for (const playerId of [1, 2] as const) {
        const solar = snapshot.solarSpears[playerId];
        if (
          solar.state === "warning" &&
          solar.target &&
          solar.impactTick !== null
        ) {
          const world = gridToWorld(solar.target);
          const remaining = Math.max(0, solar.impactTick - snapshot.tick);
          const pulse = 0.45 + ((remaining % 10) / 10) * 0.45;
          const color = playerId === 1 ? 0xffca54 : 0x63fff0;
          const radiusTiles =
            gameData.solarSpear.blastRadiusMilli / TILE_MILLI;
          this.solarGraphics.lineStyle(3, color, pulse);
          this.solarGraphics.strokeEllipse(
            world.x,
            world.y,
            radiusTiles * TILE_WIDTH * 2,
            radiusTiles * TILE_HEIGHT * 2,
          );
          this.solarGraphics.lineBetween(
            world.x - 22,
            world.y,
            world.x + 22,
            world.y,
          );
          this.solarGraphics.lineBetween(
            world.x,
            world.y - 22,
            world.x,
            world.y + 22,
          );
        }
        if (
          solar.lastImpact &&
          snapshot.tick - solar.lastImpact.tick <= 18
        ) {
          const world = gridToWorld(solar.lastImpact.target);
          const age = snapshot.tick - solar.lastImpact.tick;
          const radius = 28 + age * 13;
          const color = playerId === 1 ? 0xffe28a : 0xb5fff8;
          this.solarGraphics.fillStyle(color, Math.max(0, 0.7 - age / 26));
          this.solarGraphics.fillCircle(world.x, world.y, radius);
          this.solarGraphics.lineStyle(4, 0xffffff, 0.85 - age / 24);
          this.solarGraphics.strokeCircle(world.x, world.y, radius * 1.35);
          if (solar.lastImpact.tick !== this.lastImpactShakeTick) {
            this.lastImpactShakeTick = solar.lastImpact.tick;
            this.cameras.main.shake(
              reducedScreenShake ? 90 : 260,
              reducedScreenShake ? 0.0015 : 0.008,
              true,
            );
          }
        }
      }
    }

    private drawTerrain() {
      const blocked = new Set(
        BLOCKED_TILES.map((point) => point.y * MAP_SIZE + point.x),
      );
      if (this.textures.exists("battlefield-atlas")) {
        const terrain = this.add
          .renderTexture(FOG_LEFT, FOG_TOP, FOG_WIDTH, FOG_HEIGHT)
          .setOrigin(0, 0)
          .setDepth(0)
          .setName("battlefield-terrain-atlas");
        for (let diagonal = 0; diagonal <= (MAP_SIZE - 1) * 2; diagonal += 1) {
          const xStart = Math.max(0, diagonal - (MAP_SIZE - 1));
          const xEnd = Math.min(MAP_SIZE - 1, diagonal);
          for (let x = xStart; x <= xEnd; x += 1) {
            const y = diagonal - x;
            const point = gridToWorld({ x, y });
            const localX = point.x - FOG_LEFT;
            const localY = point.y - FOG_TOP;
            const isBlocked = blocked.has(y * MAP_SIZE + x);
            const variant = (x * 17 + y * 31) & 1;
            const frame = isBlocked
              ? variant === 0
                ? BATTLEFIELD_ATLAS_FRAME.blockedA
                : BATTLEFIELD_ATLAS_FRAME.blockedB
              : variant === 0
                ? BATTLEFIELD_ATLAS_FRAME.groundA
                : BATTLEFIELD_ATLAS_FRAME.groundB;
            terrain.stamp("battlefield-atlas", frame, localX, localY, {
              scale: 0.275,
            });
            const decalHash = (x * 73 + y * 151 + x * y * 7) % 113;
            if (!isBlocked && decalHash < 3) {
              terrain.stamp(
                "battlefield-atlas",
                decalHash === 0
                  ? BATTLEFIELD_ATLAS_FRAME.crater
                  : BATTLEFIELD_ATLAS_FRAME.fracture,
                localX,
                localY,
                { alpha: 0.58, scale: 0.25 },
              );
            }
          }
        }
        terrain.render();
        return;
      }

      const graphics = this.add
        .graphics()
        .setDepth(0)
        .setName("procedural-terrain-fallback");
      for (let y = 0; y < MAP_SIZE; y += 1) {
        for (let x = 0; x < MAP_SIZE; x += 1) {
          const point = gridToWorld({ x, y });
          const isBlocked = blocked.has(y * MAP_SIZE + x);
          const alternate = (x + y) % 2 === 0;
          graphics.fillStyle(
            isBlocked ? 0x402e29 : alternate ? 0x173235 : 0x12292c,
            1,
          );
          graphics.lineStyle(
            isBlocked ? 1.4 : 0.7,
            isBlocked ? 0xb36b42 : 0x31575b,
            isBlocked ? 0.78 : 0.34,
          );
          graphics.beginPath();
          graphics.moveTo(point.x, point.y - TILE_HEIGHT / 2);
          graphics.lineTo(point.x + TILE_WIDTH / 2, point.y);
          graphics.lineTo(point.x, point.y + TILE_HEIGHT / 2);
          graphics.lineTo(point.x - TILE_WIDTH / 2, point.y);
          graphics.closePath();
          graphics.fillPath();
          graphics.strokePath();
          if (isBlocked) {
            graphics.fillStyle(0x211916, 0.58);
            graphics.fillTriangle(
              point.x - 17,
              point.y + 5,
              point.x + 15,
              point.y + 5,
              point.x - 2,
              point.y - 11,
            );
          }
        }
      }
    }

    private drawFog(snapshot: SimulationSnapshot) {
      const visibility = snapshot.visibility;
      if (!visibility.enabled) {
        this.fogTexture.setVisible(false);
        return;
      }
      this.fogTexture.setVisible(true);
      if (visibility.revision === this.lastFogRevision) return;
      this.lastFogRevision = visibility.revision;
      this.fogScratch.clear();

      for (const level of [0, 1] as const) {
        this.fogScratch.fillStyle(
          level === 0 ? 0x020608 : 0x071318,
          level === 0 ? 0.96 : 0.52,
        );
        for (let y = 0; y < visibility.height; y += 1) {
          for (let x = 0; x < visibility.width; x += 1) {
            if (visibility.tiles[y * visibility.width + x] !== level) {
              continue;
            }
            const point = gridToWorld({ x, y });
            const localX = point.x - FOG_LEFT;
            const localY = point.y - FOG_TOP;
            this.fogScratch.beginPath();
            this.fogScratch.moveTo(localX, localY - TILE_HEIGHT / 2);
            this.fogScratch.lineTo(localX + TILE_WIDTH / 2, localY);
            this.fogScratch.lineTo(localX, localY + TILE_HEIGHT / 2);
            this.fogScratch.lineTo(localX - TILE_WIDTH / 2, localY);
            this.fogScratch.closePath();
            this.fogScratch.fillPath();
          }
        }
      }

      this.fogTexture.clear();
      this.fogTexture.draw(this.fogScratch);
      this.fogTexture.render();
      this.fogScratch.clear();
    }

    private createFieldView(field: AureliteFieldSnapshot) {
      const hasAtlas = this.textures.exists("battlefield-atlas");
      const body = this.add.graphics().setVisible(!hasAtlas);
      body.fillStyle(field.contested ? 0xf0bf57 : 0x78dfd0, 0.86);
      body.lineStyle(2, 0xe8ffff, 0.82);
      body.fillTriangle(-19, 10, 0, -23, 19, 10);
      body.strokeTriangle(-19, 10, 0, -23, 19, 10);
      body.fillStyle(0xffffff, 0.68);
      body.fillTriangle(-6, 1, 0, -15, 6, 1);
      const sprite = hasAtlas
        ? this.add
            .image(
              0,
              4,
              "battlefield-atlas",
              BATTLEFIELD_ATLAS_FRAME.aureliteField,
            )
            .setDisplaySize(92, 104)
            .setOrigin(0.5, 0.78)
            .setName("sprite")
        : null;
      const amount = this.add.graphics().setName("amount");
      const world = gridToWorld(field.tile);
      const children: Phaser.GameObjects.GameObject[] = [body];
      if (sprite) children.push(sprite);
      children.push(amount);
      const container = this.add
        .container(world.x, world.y, children)
        .setDepth(5 + world.y / 10_000)
        .setName(`field-${field.id}`);
      this.fieldViews.set(field.id, container);
    }

    private createStructureView(
      structure: StructureSnapshot,
      stale = false,
    ) {
      const poolKey = `${stale ? "stale" : "live"}:${structure.playerId}:${structure.kind}:${structure.completed}:${structure.connected}`;
      const pooled = this.structureViewPool.acquire(poolKey);
      if (pooled) {
        const world = gridToWorld(structure.tile);
        pooled
          .setActive(true)
          .setVisible(true)
          .setPosition(world.x, world.y)
          .setDepth(structureRenderDepth(structure.tile))
          .setName(
            stale
              ? `stale-structure-${structure.id}`
              : `structure-${structure.id}`,
          )
          .setAlpha(stale ? 0.34 : 1);
        (stale ? this.staleStructureViews : this.structureViews).set(
          structure.id,
          pooled,
        );
        this.structureViewPoolKeys.set(pooled, poolKey);
        return;
      }
      const teamColor = stale
        ? 0x5a6869
        : structure.playerId === 1
          ? 0xe4a33a
          : 0x4ccac0;
      const outline = stale
        ? 0x9bb0ae
        : structure.playerId === 1
          ? 0xffd78a
          : 0xb6fff5;
      const hasAtlas = this.textures.exists("structure-atlas");
      const body = this.add
        .graphics()
        .setName("body")
        .setVisible(!hasAtlas);
      body.fillStyle(teamColor, structure.completed ? 0.95 : 0.44);
      body.lineStyle(2, outline, structure.connected ? 0.95 : 0.55);
      if (structure.kind === "citadel") {
        body.fillRoundedRect(-27, -25, 54, 45, 6);
        body.strokeRoundedRect(-27, -25, 54, 45, 6);
        body.fillTriangle(-18, -25, 0, -43, 18, -25);
        body.strokeTriangle(-18, -25, 0, -43, 18, -25);
      } else if (structure.kind === "reactor") {
        body.fillCircle(0, -6, 22);
        body.strokeCircle(0, -6, 22);
        body.fillStyle(0xe8ffff, 0.72);
        body.fillCircle(0, -6, 7);
      } else if (structure.kind === "refinery") {
        body.fillRoundedRect(-26, -18, 52, 38, 5);
        body.strokeRoundedRect(-26, -18, 52, 38, 5);
        body.lineBetween(-19, -18, -10, -36);
        body.lineBetween(-10, -36, -2, -18);
      } else if (structure.kind === "barracks") {
        body.fillRect(-24, -19, 48, 39);
        body.strokeRect(-24, -19, 48, 39);
        body.strokeTriangle(-24, -19, 0, -34, 24, -19);
      } else if (structure.kind === "foundry") {
        body.fillRoundedRect(-29, -20, 58, 42, 4);
        body.strokeRoundedRect(-29, -20, 58, 42, 4);
        body.fillStyle(0x172226, 0.92);
        body.fillRect(-13, -30, 10, 18);
        body.fillRect(7, -36, 10, 24);
      } else if (structure.kind === "operationsCenter") {
        body.fillTriangle(-25, 18, 25, 18, 0, -31);
        body.strokeTriangle(-25, 18, 25, 18, 0, -31);
        body.fillStyle(0xe8ffff, 0.76);
        body.fillCircle(0, -5, 7);
      } else {
        body.fillCircle(0, -4, 20);
        body.strokeCircle(0, -4, 20);
        body.lineBetween(0, -9, 26, -25);
      }
      const [atlasWidth, atlasHeight] = STRUCTURE_ATLAS_SIZE[structure.kind];
      const sprite = hasAtlas
        ? this.add
            .image(
              0,
              STRUCTURE_ATLAS_OFFSET_Y,
              "structure-atlas",
              STRUCTURE_ATLAS_FRAME[structure.kind],
            )
            .setDisplaySize(atlasWidth, atlasHeight)
            .setOrigin(0.5, STRUCTURE_ATLAS_ORIGIN_Y)
            .setTint(
              stale
                ? 0x8c9998
                : structure.playerId === 1
                  ? 0xffe4bd
                  : 0xcafff8,
            )
            .setName("sprite")
        : null;
      const teamHalo = this.add
        .ellipse(0, 17, 67, 30)
        .setStrokeStyle(1.4, teamColor, stale ? 0.4 : 0.86)
        .setName("team-halo");
      const world = gridToWorld(structure.tile);
      const teamMark = this.add
        .rectangle(0, 9, 9, 9, teamColor, stale ? 0.5 : 0.95)
        .setStrokeStyle(1, outline, stale ? 0.55 : 1)
        .setAngle(45)
        .setName("team-mark");
      const children: Phaser.GameObjects.GameObject[] = [teamHalo, body];
      if (sprite) children.push(sprite);
      children.push(teamMark);
      const container = this.add
        .container(world.x, world.y, children)
        .setDepth(structureRenderDepth(structure.tile))
        .setName(
          stale
            ? `stale-structure-${structure.id}`
            : `structure-${structure.id}`,
        )
        .setAlpha(stale ? 0.34 : 1);
      (stale ? this.staleStructureViews : this.structureViews).set(
        structure.id,
        container,
      );
      this.structureViewPoolKeys.set(container, poolKey);
    }

    private releaseStructureView(
      id: number,
      view: Phaser.GameObjects.Container,
      stale = false,
    ) {
      (stale ? this.staleStructureViews : this.structureViews).delete(id);
      if (!stale) this.structureStatusSnapshots.delete(id);
      view.setActive(false).setVisible(false);
      const poolKey = this.structureViewPoolKeys.get(view);
      if (poolKey && this.structureViewPool.release(poolKey, view)) return;
      view.destroy(true);
    }

    private setViewWithinCameraMargin(
      view: Phaser.GameObjects.Container,
      world: Vec2,
      cameraView: CameraWorldView,
    ) {
      const visible = worldPointWithinCameraMargin(world, cameraView);
      if (view.visible !== visible) view.setVisible(visible);
      return visible;
    }

    private syncFieldViews(
      snapshot: SimulationSnapshot,
      cameraView?: CameraWorldView,
    ) {
      const activeIds = new Set(snapshot.fields.map((field) => field.id));
      for (const [id, view] of this.fieldViews) {
        if (activeIds.has(id)) continue;
        view.destroy(true);
        this.fieldViews.delete(id);
        this.fieldAmountSnapshots.delete(id);
      }
      for (const field of snapshot.fields) {
        if (!this.fieldViews.has(field.id)) this.createFieldView(field);
        const view = this.fieldViews.get(field.id)!;
        const world = gridToWorld(field.tile);
        if (
          cameraView &&
          !this.setViewWithinCameraMargin(view, world, cameraView)
        ) {
          continue;
        }
        const amount = view.getByName(
          "amount",
        ) as Phaser.GameObjects.Graphics | null;
        if (!amount) continue;
        const sprite = view.getByName(
          "sprite",
        ) as Phaser.GameObjects.Image | null;
        sprite
          ?.setTint(field.contested ? 0xffd59c : 0xffffff)
          .setAlpha(
            reducedScreenShake
              ? 0.94
              : 0.88 + Math.sin(snapshot.tick / 7) * 0.08,
          );
        const previous = this.fieldAmountSnapshots.get(field.id);
        if (previous && fieldAmountValuesEqual(previous, field)) continue;
        amount.clear();
        amount.fillStyle(0x071318, 0.92);
        amount.fillRect(-22, 20, 44, 5);
        amount.fillStyle(field.contested ? 0xf0bf57 : 0x78dfd0, 1);
        amount.fillRect(
          -21,
          21,
          Math.ceil(42 * (field.amount / field.capacity)),
          3,
        );
        this.fieldAmountSnapshots.set(field.id, field);
      }
    }

    private syncStructureViews(
      snapshot: SimulationSnapshot,
      cameraView?: CameraWorldView,
    ) {
      const activeIds = new Set(
        snapshot.structures.map((structure) => structure.id),
      );
      for (const [id, view] of this.structureViews) {
        if (activeIds.has(id)) continue;
        this.releaseStructureView(id, view);
      }
      for (const structure of snapshot.structures) {
        if (!this.structureViews.has(structure.id)) {
          this.createStructureView(structure);
        }
        const view = this.structureViews.get(structure.id)!;
        const world = gridToWorld(structure.tile);
        if (
          cameraView &&
          !this.setViewWithinCameraMargin(view, world, cameraView)
        ) {
          continue;
        }
        const previous = this.structureStatusSnapshots.get(structure.id);
        if (previous && structureStatusValuesEqual(previous, structure)) {
          continue;
        }
        const ratio = structure.health / structure.maxHealth;
        const sprite = view.getByName(
          "sprite",
        ) as Phaser.GameObjects.Image | null;
        if (sprite) {
          const baseTint =
            structure.playerId === 1 ? 0xffe4bd : 0xcafff8;
          sprite
            .setAlpha(structure.completed ? 1 : 0.46)
            .setTint(
              ratio <= 0.25
                ? 0xff9b85
                : ratio <= 0.55
                  ? 0xffcfad
                  : baseTint,
            );
        }
        this.structureStatusSnapshots.set(structure.id, structure);
      }
    }

    private syncStaleStructureViews(
      snapshot: SimulationSnapshot,
      cameraView?: CameraWorldView,
    ) {
      const visibleIds = new Set(
        snapshot.structures.map((structure) => structure.id),
      );
      for (const structure of snapshot.structures) {
        if (structure.playerId === snapshot.controlledPlayer) continue;
        this.staleStructureMemory.set(structure.id, structure);
        const staleView = this.staleStructureViews.get(structure.id);
        if (staleView) {
          this.releaseStructureView(structure.id, staleView, true);
        }
      }

      const desired = new Set<number>();
      for (const [id, remembered] of this.staleStructureMemory) {
        if (visibleIds.has(id)) continue;
        const index =
          remembered.tile.y * snapshot.visibility.width + remembered.tile.x;
        const level = snapshot.visibility.tiles[index] ?? 0;
        if (level === 2) {
          this.staleStructureMemory.delete(id);
          continue;
        }
        if (level !== 1) continue;
        desired.add(id);
        if (!this.staleStructureViews.has(id)) {
          this.createStructureView(remembered, true);
        }
      }
      for (const [id, view] of this.staleStructureViews) {
        if (!desired.has(id)) {
          this.releaseStructureView(id, view, true);
          continue;
        }
        if (cameraView) {
          this.setViewWithinCameraMargin(
            view,
            gridToWorld(this.staleStructureMemory.get(id)!.tile),
            cameraView,
          );
        }
      }
    }

    private clearStaleFogMemory() {
      this.staleStructureMemory.clear();
      for (const [id, view] of this.staleStructureViews) {
        this.releaseStructureView(id, view, true);
      }
      this.staleStructureViews.clear();
      this.lastFogRevision = -1;
    }

    private drawBuildRadii(snapshot: SimulationSnapshot) {
      if (this.lastBuildRadiusSnapshot === snapshot) return;
      this.lastBuildRadiusSnapshot = snapshot;
      this.buildRadiusGraphics.clear();
      for (const structure of snapshot.structures) {
        if (
          structure.playerId !== snapshot.controlledPlayer ||
          !structure.completed ||
          structure.buildRadius <= 0
        ) {
          continue;
        }
        const world = gridToWorld(structure.tile);
        const color = structure.connected ? 0x79e0d3 : 0xe6a63f;
        this.buildRadiusGraphics.lineStyle(1, color, 0.16);
        this.buildRadiusGraphics.strokeEllipse(
          world.x,
          world.y,
          structure.buildRadius * TILE_WIDTH * 2,
          structure.buildRadius * TILE_HEIGHT * 2,
        );
      }
    }

    private createUnitView(unit: UnitSnapshot) {
      const poolKey = `${unit.playerId}:${unit.kind}:${unit.armor}`;
      const pooled = this.unitViewPool.acquire(poolKey);
      if (pooled) {
        pooled
          .setActive(true)
          .setVisible(true)
          .setPosition(0, 0)
          .setDepth(10)
          .setName(`unit-${unit.id}`);
        this.unitViews.set(unit.id, pooled);
        this.unitViewPoolKeys.set(pooled, poolKey);
        this.unitFacings.set(unit.id, 0);
        return;
      }
      const heavy = unit.armor === "heavy" || unit.armor === "siege";
      const teamColor = unit.playerId === 1 ? 0xe4a33a : 0x4ccac0;
      const outline = unit.playerId === 1 ? 0xffd78a : 0xb6fff5;
      const body = this.add
        .graphics()
        .setVisible(!this.textures.exists("unit-facing-atlas"));
      body.fillStyle(teamColor, 1);
      body.lineStyle(2, outline, 1);
      if (unit.kind === "gorgonWalker") {
        body.fillStyle(teamColor, 1);
        body.fillTriangle(-19, 10, 0, -17, 19, 10);
        body.strokeTriangle(-19, 10, 0, -17, 19, 10);
        body.lineBetween(-12, 11, -18, 18);
        body.lineBetween(12, 11, 18, 18);
      } else if (unit.kind === "atlasTank") {
        body.fillRoundedRect(-17, -11, 34, 22, 4);
        body.strokeRoundedRect(-17, -11, 34, 22, 4);
        body.fillStyle(0x172226, 1);
        body.fillRect(-6, -16, 12, 9);
        body.lineBetween(0, -13, 18, -18);
      } else if (unit.kind === "midasHarvester") {
        body.fillRoundedRect(-18, -10, 36, 20, 3);
        body.strokeRoundedRect(-18, -10, 36, 20, 3);
        body.fillStyle(0x172226, 1);
        body.fillTriangle(-18, -10, -8, -18, 0, -10);
      } else if (unit.kind === "cyclopsRocket") {
        body.fillRoundedRect(-14, -9, 28, 18, 3);
        body.strokeRoundedRect(-14, -9, 28, 18, 3);
        body.lineBetween(-11, -12, -3, -18);
        body.lineBetween(3, -18, 11, -12);
      } else if (unit.kind === "hermesScout") {
        body.fillTriangle(-18, 9, 18, 9, 0, -15);
        body.strokeTriangle(-18, 9, 18, 9, 0, -15);
        body.fillStyle(0xe9ffff, 1);
        body.fillCircle(0, 1, 3);
      } else {
        body.fillTriangle(-16, 10, 16, 10, 0, -13);
        body.strokeTriangle(-16, 10, 16, 10, 0, -13);
      }
      const [atlasWidth, atlasHeight] = UNIT_ATLAS_SIZE[unit.kind];
      const sprite = this.textures.exists("unit-facing-atlas")
        ? this.add
            .image(
              0,
              11,
              "unit-facing-atlas",
              UNIT_ATLAS_FRAME[unit.kind],
            )
            .setDisplaySize(atlasWidth, atlasHeight)
            .setOrigin(0.5, 0.82)
            .setName("sprite")
        : null;
      const teamMark = this.add
        .rectangle(0, 2, heavy ? 9 : 7, heavy ? 9 : 7, teamColor, 0.94)
        .setStrokeStyle(1, outline, 1)
        .setAngle(45);
      const core = this.add.circle(0, 0, 4, 0xe9ffff);
      const children: Phaser.GameObjects.GameObject[] = [body];
      if (sprite) children.push(sprite);
      children.push(teamMark, core);
      const container = this.add
        .container(0, 0, children)
        .setDepth(10)
        .setName(`unit-${unit.id}`);
      this.unitViews.set(unit.id, container);
      this.unitViewPoolKeys.set(container, poolKey);
      this.unitFacings.set(unit.id, 0);
    }

    private releaseUnitView(
      id: number,
      view: Phaser.GameObjects.Container,
    ) {
      this.unitViews.delete(id);
      this.unitFacings.delete(id);
      view.setActive(false).setVisible(false);
      const poolKey = this.unitViewPoolKeys.get(view);
      if (poolKey && this.unitViewPool.release(poolKey, view)) return;
      view.destroy(true);
    }

    private syncUnitViews(snapshot: SimulationSnapshot) {
      const activeIds = new Set(snapshot.units.map((unit) => unit.id));
      for (const [id, view] of this.unitViews) {
        if (activeIds.has(id)) continue;
        this.releaseUnitView(id, view);
      }
      for (const unit of snapshot.units) {
        if (!this.unitViews.has(unit.id)) this.createUnitView(unit);
      }
    }

    private drawStructureOverlays(
      snapshot: SimulationSnapshot,
      cameraView: CameraWorldView,
    ) {
      for (const structure of snapshot.structures) {
        const world = gridToWorld(structure.tile);
        if (!worldPointWithinCameraMargin(world, cameraView)) continue;
        if (structure.selected) {
          this.selectionGraphics.lineStyle(2, 0xf4f0b5, 0.98);
          this.selectionGraphics.strokeEllipse(
            world.x,
            world.y + 17,
            65,
            30,
          );
        }

        const style = structureOverlayStyle(structure);
        this.meterGraphics.fillStyle(0x071318, 0.92);
        this.meterGraphics.fillRect(world.x - 25, world.y - 49, 50, 6);
        this.meterGraphics.fillStyle(style.healthColor, 1);
        this.meterGraphics.fillRect(
          world.x - 24,
          world.y - 48,
          Math.ceil(48 * style.healthRatio),
          4,
        );
        if (style.healthRatio <= 0.55) {
          this.meterGraphics.lineStyle(
            1.2,
            style.healthRatio <= 0.25 ? 0xff6d5c : 0xe6a63f,
            0.8,
          );
          for (let offset = -18; offset <= 18; offset += 9) {
            this.meterGraphics.lineBetween(
              world.x + offset - 5,
              world.y - 35,
              world.x + offset + 5,
              world.y - 25,
            );
          }
        }
        if (style.constructionRatio !== null) {
          this.meterGraphics.fillStyle(0x071318, 0.92);
          this.meterGraphics.fillRect(world.x - 25, world.y + 25, 50, 6);
          this.meterGraphics.fillStyle(0xe6a63f, 1);
          this.meterGraphics.fillRect(
            world.x - 24,
            world.y + 26,
            Math.ceil(48 * style.constructionRatio),
            4,
          );
        } else if (style.warning === "unpowered") {
          this.meterGraphics.lineStyle(2, 0xf06d5c, 1);
          this.meterGraphics.strokeCircle(world.x, world.y - 8, 29);
          this.meterGraphics.lineBetween(
            world.x - 19,
            world.y - 29,
            world.x + 19,
            world.y + 13,
          );
        } else if (style.warning === "disconnected") {
          this.meterGraphics.lineStyle(2, 0xe6a63f, 0.9);
          this.meterGraphics.strokeCircle(world.x, world.y - 8, 28);
        }
      }
    }

    private drawUnitOverlay(
      unit: UnitSnapshot,
      world: Vec2,
      controlledPlayer: SimulationSnapshot["controlledPlayer"],
    ) {
      const style = unitOverlayStyle(unit, controlledPlayer);
      if (unit.selected) {
        this.selectionGraphics.lineStyle(2, 0xf4f0b5, 0.98);
        this.selectionGraphics.strokeEllipse(
          world.x,
          world.y + 13,
          style.selectionSize[0],
          style.selectionSize[1],
        );
      }
      this.meterGraphics.fillStyle(0x071318, 0.92);
      this.meterGraphics.fillRect(
        world.x - style.healthWidth / 2 - 1,
        world.y - 27,
        style.healthWidth + 2,
        5,
      );
      this.meterGraphics.fillStyle(healthColor(style.healthRatio), 1);
      this.meterGraphics.fillRect(
        world.x - style.healthWidth / 2,
        world.y - 26,
        Math.ceil(style.healthWidth * style.healthRatio),
        3,
      );
      if (style.cargoRatio === null) return;

      const width = 34;
      const segments = 5;
      const segmentWidth = (width - (segments - 1) * 2) / segments;
      for (let segment = 0; segment < segments; segment += 1) {
        const x = world.x - width / 2 + segment * (segmentWidth + 2);
        this.meterGraphics.fillStyle(0x071318, 0.94);
        this.meterGraphics.fillRect(x, world.y - 20, segmentWidth, 4);
        const segmentFill = Math.max(
          0,
          Math.min(1, style.cargoRatio * segments - segment),
        );
        if (segmentFill > 0) {
          this.meterGraphics.fillStyle(0xf0bf57, 1);
          this.meterGraphics.fillRect(
            x,
            world.y - 19,
            segmentWidth * segmentFill,
            2,
          );
        }
      }
    }

    private renderUnits(
      previous: SimulationSnapshot,
      current: SimulationSnapshot,
      alpha: number,
      cameraView: CameraWorldView,
    ) {
      this.selectionGraphics.clear();
      this.meterGraphics.clear();
      this.drawStructureOverlays(current, cameraView);
      const previousById = new Map(previous.units.map((unit) => [unit.id, unit]));
      for (const unit of current.units) {
        const prior = previousById.get(unit.id) ?? unit;
        const position = {
          x:
            prior.position.x +
            (unit.position.x - prior.position.x) * Math.max(0, alpha),
          y:
            prior.position.y +
            (unit.position.y - prior.position.y) * Math.max(0, alpha),
        };
        const world = fixedToWorld(position);
        const view = this.unitViews.get(unit.id)!;
        view.setPosition(world.x, world.y).setDepth(10 + world.y / 10_000);
        const dx = unit.position.x - prior.position.x;
        const dy = unit.position.y - prior.position.y;
        if (dx !== 0 || dy !== 0) {
          const angle = Math.atan2(dx, -dy);
          this.unitFacings.set(
            unit.id,
            (Math.round(angle / (Math.PI / 4)) + 8) % 8,
          );
        }
        const facing = this.unitFacings.get(unit.id) ?? 0;
        (
          view.getByName("sprite") as Phaser.GameObjects.Image | null
        )?.setFrame(UNIT_ATLAS_FRAME[unit.kind] + facing, false, false);
        if (!this.setViewWithinCameraMargin(view, world, cameraView)) {
          continue;
        }
        this.drawUnitOverlay(unit, world, current.controlledPlayer);
      }
    }

    private drawProjectiles(
      snapshot: SimulationSnapshot,
      cameraView: CameraWorldView,
    ) {
      if (
        this.lastProjectileSnapshot === snapshot &&
        cameraWorldViewsEqual(this.lastProjectileCameraView, cameraView)
      ) {
        return;
      }
      this.lastProjectileSnapshot = snapshot;
      this.lastProjectileCameraView = {
        x: cameraView.x,
        y: cameraView.y,
        width: cameraView.width,
        height: cameraView.height,
      };
      this.projectileGraphics.clear();
      for (const projectile of snapshot.projectiles) {
        const world = fixedToWorld(projectile.position);
        if (!worldPointWithinCameraMargin(world, cameraView)) continue;
        const color = projectile.playerId === 1 ? 0xffd36e : 0x79fff1;
        const radius = projectile.weaponId === "gorgonMortar" ? 5 : 3;
        this.projectileGraphics.fillStyle(color, 0.95);
        this.projectileGraphics.fillCircle(world.x, world.y, radius);
        this.projectileGraphics.lineStyle(1, 0xffffff, 0.45);
        this.projectileGraphics.strokeCircle(world.x, world.y, radius + 2);
      }
    }

    private drawRoutes(snapshot: SimulationSnapshot) {
      if (this.lastRouteSnapshot === snapshot) return;
      this.lastRouteSnapshot = snapshot;
      this.routeGraphics.clear();
      this.rallyGraphics.clear();
      for (const unit of snapshot.units) {
        if (!unit.selected || unit.path.length === 0) continue;
        const start = fixedToWorld(unit.position);
        this.routeGraphics.lineStyle(
          1.5,
          unit.order === "attackMove" ? 0xef6a58 : 0xe7bc63,
          0.42,
        );
        this.routeGraphics.beginPath();
        this.routeGraphics.moveTo(start.x, start.y);
        for (const waypoint of unit.path) {
          const world = gridToWorld(waypoint);
          this.routeGraphics.lineTo(world.x, world.y);
        }
        this.routeGraphics.strokePath();
      }
      for (const rally of snapshot.rallies) {
        const world = gridToWorld(rally.target);
        const color = rally.formationId === 1 ? 0xe4a33a : 0x76d9cc;
        this.rallyGraphics.lineStyle(2, color, 0.9);
        this.rallyGraphics.strokeCircle(world.x, world.y, 10);
        this.rallyGraphics.lineBetween(
          world.x,
          world.y - 10,
          world.x,
          world.y - 27,
        );
        this.rallyGraphics.fillStyle(color, 0.82);
        this.rallyGraphics.fillTriangle(
          world.x,
          world.y - 27,
          world.x + 14,
          world.y - 22,
          world.x,
          world.y - 17,
        );
      }
    }

    private drawSelectionBox(
      start: Phaser.Math.Vector2,
      end: Phaser.Math.Vector2,
    ) {
      const x = Math.min(start.x, end.x);
      const y = Math.min(start.y, end.y);
      const width = Math.abs(end.x - start.x);
      const height = Math.abs(end.y - start.y);
      this.selectionBox.clear();
      this.selectionBox.fillStyle(0x79e0d3, 0.09);
      this.selectionBox.fillRect(x, y, width, height);
      this.selectionBox.lineStyle(1.5, 0x79e0d3, 0.95);
      this.selectionBox.strokeRect(x, y, width, height);
    }

    private completeSelection(
      start: Phaser.Math.Vector2,
      end: Phaser.Math.Vector2,
    ) {
      const x = Math.min(start.x, end.x);
      const y = Math.min(start.y, end.y);
      const width = Math.abs(end.x - start.x);
      const height = Math.abs(end.y - start.y);
      const click = width < 10 && height < 10;
      let unitIds: number[] = [];
      if (click) {
        const nearest = pickUnitAtWorldPoint(
          lastRenderSnapshot.units,
          end,
          lastSnapshot.controlledPlayer,
          32,
        );
        unitIds = nearest ? [nearest.id] : [];
        if (unitIds.length === 0) {
          const structure = this.structureAtWorldPoint(
            end,
            lastSnapshot.controlledPlayer,
          );
          workerSession.enqueue({
            kind: "selectStructures",
            structureIds: structure ? [structure.id] : [],
            additive: this.shiftKey.isDown,
          });
          return;
        }
      } else {
        unitIds = lastRenderSnapshot.units
          .filter((unit) => {
            if (unit.playerId !== lastSnapshot.controlledPlayer) return false;
            const world = fixedToWorld(unit.position);
            return (
              world.x >= x &&
              world.x <= x + width &&
              world.y >= y &&
              world.y <= y + height
            );
          })
          .map((unit) => unit.id);
      }
      workerSession.enqueue({
        kind: "selectUnits",
        unitIds,
        additive: this.shiftKey.isDown,
      });
    }

    private unitAtWorldPoint(
      point: Phaser.Math.Vector2,
      playerId: 1 | 2,
    ) {
      return pickUnitAtWorldPoint(
        lastRenderSnapshot.units,
        point,
        playerId,
      );
    }

    private structureAtWorldPoint(
      point: Phaser.Math.Vector2,
      playerId: 1 | 2,
    ) {
      return pickStructureAtWorldPoint(
        lastRenderSnapshot.structures,
        point,
        playerId,
        this.textures.exists("structure-atlas"),
      );
    }
  }

  const canvas = document.createElement("canvas");
  host.appendChild(canvas);
  const game = new Phaser.Game({
    type: canCreateWebGLContext() ? Phaser.WEBGL : Phaser.CANVAS,
    canvas,
    parent: null,
    backgroundColor: "#071318",
    disableContextMenu: true,
    scene: OperationsScene,
    render: { antialias: true, pixelArt: false, pathDetailThreshold: 1 },
    scale: {
      parent: null,
      width: 1280,
      height: 720,
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.NO_CENTER,
      expandParent: false,
    },
    audio: { disableWebAudio: false },
    loader: { maxRetries: 2 },
  });
  const syncCanvasSize = () => {
    const width = host.clientWidth;
    const height = host.clientHeight;
    if (width <= 0 || height <= 0) return;
    game.scale.setParentSize(width, height);
  };
  const resizeObserver = new ResizeObserver(syncCanvasSize);
  resizeObserver.observe(host);
  syncCanvasSize();

  return {
    subscribe(listener) {
      listeners.add(listener);
      emit();
      return () => listeners.delete(listener);
    },
    enqueue(command: SimCommand) {
      const intendedTick = workerSession.enqueue(command);
      if (
        command.kind === "restartCombat" ||
        command.kind === "restartEconomy" ||
        command.kind === "restartSkirmish"
      ) {
        cameraMoved = false;
        pendingFogMemoryResetAtTick = intendedTick;
        fogMemoryResetReady = false;
        resetTargetingModes();
      }
    },
    beginPlacement(buildingKind) {
      setTargetingModes(buildingKind, buildingKind ? false : solarTargeting);
    },
    beginSolarTargeting(active) {
      setTargetingModes(active ? null : pendingBuilding, active);
    },
    clearTargetingModes() {
      resetTargetingModes();
    },
    pause(reason) {
      paused = true;
      pauseReason = reason;
      workerSession.pause(reason);
      proceduralAudio.setPaused(true);
      emit();
    },
    resume() {
      paused = false;
      pauseReason = null;
      previousRenderSnapshot = lastRenderSnapshot;
      lastSnapshotReceivedAt = performance.now();
      workerSession.resume();
      proceduralAudio.setPaused(false);
      emit();
    },
    async unlockAudio() {
      if (audioReady) return;
      audioReady = await proceduralAudio.unlock();
      emit();
    },
    setAudioSettings(settings: AudioSettings) {
      proceduralAudio.setSettings(settings);
    },
    setCameraZoom(zoom: number) {
      cameraZoom = Math.max(0.75, Math.min(1.25, zoom));
      game.scene.getScene("operations")?.cameras.main.setZoom(cameraZoom);
      emit();
    },
    setReducedScreenShake(reduced: boolean) {
      reducedScreenShake = reduced;
    },
    setGameplayInputEnabled(enabled: boolean) {
      gameplayInputEnabled = enabled;
      refreshKeyboardInput();
    },
    centerCamera() {
      game.scene
        .getScene("operations")
        ?.cameras.main.centerOn(CAMERA_CENTER.x, CAMERA_CENTER.y);
    },
    destroy() {
      listeners.clear();
      unsubscribeWorkerSession();
      workerSession.terminate();
      resizeObserver.disconnect();
      detachKeyboardCaptureGuard();
      proceduralAudio.destroy();
      game.destroy(true);
    },
  };
}
