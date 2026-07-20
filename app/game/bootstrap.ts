import { BLOCKED_TILES, MAP_SIZE, TILE_MILLI } from "./map";
import { gameData } from "./data";
import { SIM_STEP_MS, Simulation } from "./simulation";
import {
  isContinuousAudioTransition,
  ProceduralAudio,
} from "./audio";
import type {
  AudioCueSnapshot,
  AudioSettings,
  AureliteFieldSnapshot,
  BuildingKind,
  GameRuntime,
  RuntimeListener,
  RuntimeSnapshot,
  SimCommand,
  SimulationSnapshot,
  StructureSnapshot,
  UnitSnapshot,
  Vec2,
} from "./types";

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

function gridToWorld(point: Vec2) {
  return {
    x: (point.x - point.y) * (TILE_WIDTH / 2),
    y: (point.x + point.y) * (TILE_HEIGHT / 2),
  };
}

function fixedToWorld(point: Vec2) {
  return gridToWorld({
    x: point.x / TILE_MILLI,
    y: point.y / TILE_MILLI,
  });
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
  const Phaser = await import("phaser");
  const simulation = new Simulation(undefined, "skirmish");
  const listeners = new Set<RuntimeListener>();
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
  let accumulator = 0;
  let lastSnapshot = simulation.snapshot();
  let previousSnapshot = lastSnapshot;
  let lastEmittedTick = -1;
  let detachKeyboardCaptureGuard = () => {};
  let pendingFogMemoryReset = false;

  const emit = () => {
    const snapshot: RuntimeSnapshot = {
      simulation: lastSnapshot,
      paused,
      pauseReason,
      audioReady,
      cameraMoved,
      pendingBuilding,
      solarTargeting,
      audioCue,
      renderer,
      cameraZoom,
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

  class OperationsScene extends Phaser.Scene {
    private cursorKeys!: Phaser.Types.Input.Keyboard.CursorKeys;
    private cameraKeys!: Record<string, Phaser.Input.Keyboard.Key>;
    private shiftKey!: Phaser.Input.Keyboard.Key;
    private ctrlKey!: Phaser.Input.Keyboard.Key;
    private selectionBox!: Phaser.GameObjects.Graphics;
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
    private unitFacings = new Map<number, number>();
    private structureViews = new Map<number, Phaser.GameObjects.Container>();
    private staleStructureViews = new Map<
      number,
      Phaser.GameObjects.Container
    >();
    private staleStructureMemory = new Map<number, StructureSnapshot>();
    private fieldViews = new Map<number, Phaser.GameObjects.Container>();
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
    }

    create() {
      this.cameras.main.setBackgroundColor("#071318");
      this.drawTerrain();
      this.routeGraphics = this.add.graphics().setDepth(8);
      this.rallyGraphics = this.add.graphics().setDepth(7);
      this.projectileGraphics = this.add.graphics().setDepth(24);
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
      this.syncUnitViews(lastSnapshot);
      this.syncStructureViews(lastSnapshot);
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
      const guardFormKey = (event: KeyboardEvent) => {
        const textEntryFocused = isTextEntryControl(event.target);
        keyboard.enabled = !textEntryFocused;
        if (textEntryFocused) {
          keyboard.resetKeys();
          keyboard.disableGlobalCapture();
        } else {
          keyboard.enableGlobalCapture();
        }
      };
      ownerWindow.addEventListener("keydown", guardFormKey, true);
      ownerWindow.addEventListener("keyup", guardFormKey, true);
      detachKeyboardCaptureGuard = () => {
        ownerWindow.removeEventListener("keydown", guardFormKey, true);
        ownerWindow.removeEventListener("keyup", guardFormKey, true);
      };

      this.input.keyboard!.on("keydown-F", () => {
        this.pendingOrder = "attackMove";
      });
      this.input.keyboard!.on("keydown-R", () => {
        this.pendingOrder = "rally";
      });
      this.input.keyboard!.on("keydown-X", () => {
        simulation.enqueue({ kind: "stop" });
      });
      this.input.keyboard!.on("keydown-H", () => {
        simulation.enqueue({ kind: "hold" });
      });
      for (let group = 1; group <= 3; group += 1) {
        const key = this.input.keyboard!.addKey(String(group));
        key.on("down", () => {
          simulation.enqueue(
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
          simulation.enqueue({
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
            simulation.enqueue({
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
            simulation.enqueue({
              kind: "attackUnit",
              targetUnitId: targetedEnemy.id,
            });
            this.orderMarker
              .setPosition(world.x, world.y)
              .setStrokeStyle(2, 0xf06d5c, 0.95)
              .setVisible(true);
          } else if (targetedStructure && this.pendingOrder !== "rally") {
            simulation.enqueue({
              kind: "attackStructure",
              targetStructureId: targetedStructure.id,
            });
            this.orderMarker
              .setPosition(world.x, world.y)
              .setStrokeStyle(2, 0xf06d5c, 0.95)
              .setVisible(true);
          } else if (this.pendingOrder === "rally") {
            simulation.enqueue({ kind: "setRally", target });
          } else {
            simulation.enqueue({
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
      if (!paused) {
        accumulator = Math.min(accumulator + delta, SIM_STEP_MS * 4);
        while (accumulator >= SIM_STEP_MS) {
          previousSnapshot = lastSnapshot;
          if (pendingFogMemoryReset) {
            this.clearStaleFogMemory();
            pendingFogMemoryReset = false;
          }
          simulation.step();
          lastSnapshot = simulation.snapshot();
          if (isContinuousAudioTransition(previousSnapshot, lastSnapshot)) {
            proceduralAudio.observe(previousSnapshot, lastSnapshot);
          } else {
            previousSnapshot = lastSnapshot;
          }
          accumulator -= SIM_STEP_MS;
        }
      }

      this.updateCamera(delta);
      this.syncUnitViews(lastSnapshot);
      this.syncStructureViews(lastSnapshot);
      this.syncStaleStructureViews(lastSnapshot);
      this.syncFieldViews(lastSnapshot);
      this.renderUnits(
        previousSnapshot,
        lastSnapshot,
        paused ? 1 : accumulator / SIM_STEP_MS,
      );
      this.drawRoutes(lastSnapshot);
      this.drawProjectiles(lastSnapshot);
      this.drawBuildRadii(lastSnapshot);
      this.drawFog(lastSnapshot);
      this.drawSolarSpear(lastSnapshot);

      if (
        lastSnapshot.tick !== lastEmittedTick &&
        lastSnapshot.tick % 2 === 0
      ) {
        lastEmittedTick = lastSnapshot.tick;
        emit();
      }
    }

    private updateCamera(delta: number) {
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
      const graphics = this.add.graphics().setDepth(0);
      const blocked = new Set(
        BLOCKED_TILES.map((point) => point.y * MAP_SIZE + point.x),
      );
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
      const body = this.add.graphics();
      body.fillStyle(field.contested ? 0xf0bf57 : 0x78dfd0, 0.86);
      body.lineStyle(2, 0xe8ffff, 0.82);
      body.fillTriangle(-19, 10, 0, -23, 19, 10);
      body.strokeTriangle(-19, 10, 0, -23, 19, 10);
      body.fillStyle(0xffffff, 0.68);
      body.fillTriangle(-6, 1, 0, -15, 6, 1);
      const amount = this.add.graphics().setName("amount");
      const world = gridToWorld(field.tile);
      const container = this.add
        .container(world.x, world.y, [body, amount])
        .setDepth(5 + world.y / 10_000)
        .setName(`field-${field.id}`);
      this.fieldViews.set(field.id, container);
    }

    private createStructureView(
      structure: StructureSnapshot,
      stale = false,
    ) {
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
      const body = this.add.graphics().setName("body");
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
      const status = this.add.graphics().setName("status");
      const selection = this.add
        .ellipse(0, 17, 65, 30)
        .setStrokeStyle(2, 0xf4f0b5, 0.98)
        .setName("selection")
        .setVisible(!stale && structure.selected);
      const world = gridToWorld(structure.tile);
      const container = this.add
        .container(world.x, world.y, [selection, body, status])
        .setDepth(9 + world.y / 10_000)
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
    }

    private syncFieldViews(snapshot: SimulationSnapshot) {
      const activeIds = new Set(snapshot.fields.map((field) => field.id));
      for (const [id, view] of this.fieldViews) {
        if (activeIds.has(id)) continue;
        view.destroy(true);
        this.fieldViews.delete(id);
      }
      for (const field of snapshot.fields) {
        if (!this.fieldViews.has(field.id)) this.createFieldView(field);
        const amount = this.fieldViews
          .get(field.id)
          ?.getByName("amount") as Phaser.GameObjects.Graphics | null;
        if (!amount) continue;
        amount.clear();
        amount.fillStyle(0x071318, 0.92);
        amount.fillRect(-22, 14, 44, 5);
        amount.fillStyle(field.contested ? 0xf0bf57 : 0x78dfd0, 1);
        amount.fillRect(
          -21,
          15,
          Math.ceil(42 * (field.amount / field.capacity)),
          3,
        );
      }
    }

    private syncStructureViews(snapshot: SimulationSnapshot) {
      const activeIds = new Set(
        snapshot.structures.map((structure) => structure.id),
      );
      for (const [id, view] of this.structureViews) {
        if (activeIds.has(id)) continue;
        view.destroy(true);
        this.structureViews.delete(id);
      }
      for (const structure of snapshot.structures) {
        if (!this.structureViews.has(structure.id)) {
          this.createStructureView(structure);
        }
        const view = this.structureViews.get(structure.id)!;
        (
          view.getByName("selection") as Phaser.GameObjects.Ellipse | null
        )?.setVisible(structure.selected);
        const status = view.getByName(
          "status",
        ) as Phaser.GameObjects.Graphics | null;
        if (!status) continue;
        status.clear();
        status.fillStyle(0x071318, 0.92);
        status.fillRect(-25, -49, 50, 6);
        const ratio = structure.health / structure.maxHealth;
        status.fillStyle(
          ratio > 0.55 ? 0x79e0d3 : ratio > 0.25 ? 0xe6a63f : 0xf06d5c,
          1,
        );
        status.fillRect(-24, -48, Math.ceil(48 * ratio), 4);
        if (!structure.completed) {
          const progress =
            1 -
            structure.constructionRemainingTicks /
              Math.max(1, structure.constructionTotalTicks);
          status.fillStyle(0x071318, 0.92);
          status.fillRect(-25, 25, 50, 6);
          status.fillStyle(0xe6a63f, 1);
          status.fillRect(-24, 26, Math.ceil(48 * progress), 4);
        } else if (!structure.powered) {
          status.lineStyle(2, 0xf06d5c, 1);
          status.strokeCircle(0, -8, 29);
          status.lineBetween(-19, -29, 19, 13);
        } else if (!structure.connected) {
          status.lineStyle(2, 0xe6a63f, 0.9);
          status.strokeCircle(0, -8, 28);
        }
      }
    }

    private syncStaleStructureViews(snapshot: SimulationSnapshot) {
      const visibleIds = new Set(
        snapshot.structures.map((structure) => structure.id),
      );
      for (const structure of snapshot.structures) {
        if (structure.playerId === snapshot.controlledPlayer) continue;
        this.staleStructureMemory.set(structure.id, structure);
        this.staleStructureViews.get(structure.id)?.destroy(true);
        this.staleStructureViews.delete(structure.id);
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
        if (desired.has(id)) continue;
        view.destroy(true);
        this.staleStructureViews.delete(id);
      }
    }

    private clearStaleFogMemory() {
      this.staleStructureMemory.clear();
      for (const view of this.staleStructureViews.values()) {
        view.destroy(true);
      }
      this.staleStructureViews.clear();
      this.lastFogRevision = -1;
    }

    private drawBuildRadii(snapshot: SimulationSnapshot) {
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
      const health = this.add.graphics().setName("health");
      const ring = this.add
        .ellipse(0, 13, heavy ? 52 : 45, heavy ? 24 : 20)
        .setStrokeStyle(2, 0xf4f0b5, 0.98)
        .setName("selection")
        .setVisible(unit.selected);
      const children: Phaser.GameObjects.GameObject[] = [ring, body];
      if (sprite) children.push(sprite);
      children.push(teamMark, core, health);
      const container = this.add
        .container(0, 0, children)
        .setDepth(10)
        .setName(`unit-${unit.id}`);
      this.unitViews.set(unit.id, container);
      this.unitFacings.set(unit.id, 0);
    }

    private syncUnitViews(snapshot: SimulationSnapshot) {
      const activeIds = new Set(snapshot.units.map((unit) => unit.id));
      for (const [id, view] of this.unitViews) {
        if (activeIds.has(id)) continue;
        view.destroy(true);
        this.unitViews.delete(id);
        this.unitFacings.delete(id);
      }
      for (const unit of snapshot.units) {
        if (!this.unitViews.has(unit.id)) this.createUnitView(unit);
      }
    }

    private renderUnits(
      previous: SimulationSnapshot,
      current: SimulationSnapshot,
      alpha: number,
    ) {
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
        (
          view.getByName("selection") as Phaser.GameObjects.Ellipse | null
        )?.setVisible(unit.selected);
        const health = view.getByName(
          "health",
        ) as Phaser.GameObjects.Graphics | null;
        if (health) {
          const width = unit.armor === "heavy" || unit.armor === "siege" ? 40 : 34;
          const ratio = unit.health / unit.maxHealth;
          health.clear();
          health.fillStyle(0x071318, 0.92);
          health.fillRect(-width / 2 - 1, -27, width + 2, 5);
          health.fillStyle(
            ratio > 0.55 ? 0x79e0d3 : ratio > 0.25 ? 0xe6a63f : 0xf06d5c,
            1,
          );
          health.fillRect(-width / 2, -26, Math.ceil(width * ratio), 3);
        }
      }
    }

    private drawProjectiles(snapshot: SimulationSnapshot) {
      this.projectileGraphics.clear();
      for (const projectile of snapshot.projectiles) {
        const world = fixedToWorld(projectile.position);
        const color = projectile.playerId === 1 ? 0xffd36e : 0x79fff1;
        const radius = projectile.weaponId === "gorgonMortar" ? 5 : 3;
        this.projectileGraphics.fillStyle(color, 0.95);
        this.projectileGraphics.fillCircle(world.x, world.y, radius);
        this.projectileGraphics.lineStyle(1, 0xffffff, 0.45);
        this.projectileGraphics.strokeCircle(world.x, world.y, radius + 2);
      }
    }

    private drawRoutes(snapshot: SimulationSnapshot) {
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
        const nearest = lastSnapshot.units
          .filter(
            (unit) => unit.playerId === lastSnapshot.controlledPlayer,
          )
          .map((unit) => {
            const world = fixedToWorld(unit.position);
            const dx = world.x - end.x;
            const dy = world.y - end.y;
            return { id: unit.id, distanceSquared: dx * dx + dy * dy };
          })
          .filter((candidate) => candidate.distanceSquared <= 32 * 32)
          .sort(
            (a, b) =>
              a.distanceSquared - b.distanceSquared || a.id - b.id,
          )[0];
        unitIds = nearest ? [nearest.id] : [];
        if (unitIds.length === 0) {
          const structure = this.structureAtWorldPoint(
            end,
            lastSnapshot.controlledPlayer,
          );
          simulation.enqueue({
            kind: "selectStructures",
            structureIds: structure ? [structure.id] : [],
            additive: this.shiftKey.isDown,
          });
          return;
        }
      } else {
        unitIds = lastSnapshot.units
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
      simulation.enqueue({
        kind: "selectUnits",
        unitIds,
        additive: this.shiftKey.isDown,
      });
    }

    private unitAtWorldPoint(
      point: Phaser.Math.Vector2,
      playerId: 1 | 2,
    ) {
      return lastSnapshot.units
        .filter((unit) => unit.playerId === playerId)
        .map((unit) => {
          const world = fixedToWorld(unit.position);
          const dx = world.x - point.x;
          const dy = world.y - point.y;
          return { unit, distanceSquared: dx * dx + dy * dy };
        })
        .filter((candidate) => candidate.distanceSquared <= 34 * 34)
        .sort(
          (left, right) =>
            left.distanceSquared - right.distanceSquared ||
            left.unit.id - right.unit.id,
        )[0]?.unit;
    }

    private structureAtWorldPoint(
      point: Phaser.Math.Vector2,
      playerId: 1 | 2,
    ) {
      return lastSnapshot.structures
        .filter((structure) => structure.playerId === playerId)
        .map((structure) => {
          const world = gridToWorld(structure.tile);
          const dx = world.x - point.x;
          const dy = world.y - point.y;
          return {
            structure,
            distanceSquared: dx * dx + dy * dy,
          };
        })
        .filter((candidate) => candidate.distanceSquared <= 38 * 38)
        .sort(
          (left, right) =>
            left.distanceSquared - right.distanceSquared ||
            left.structure.id - right.structure.id,
        )[0]?.structure;
    }
  }

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: host,
    width: 1280,
    height: 720,
    backgroundColor: "#071318",
    disableContextMenu: true,
    scene: OperationsScene,
    render: { antialias: true, pixelArt: false, pathDetailThreshold: 1 },
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    audio: { disableWebAudio: false },
    loader: { maxRetries: 2 },
  });

  return {
    subscribe(listener) {
      listeners.add(listener);
      emit();
      return () => listeners.delete(listener);
    },
    enqueue(command: SimCommand) {
      if (
        command.kind === "restartCombat" ||
        command.kind === "restartEconomy" ||
        command.kind === "restartSkirmish"
      ) {
        cameraMoved = false;
        pendingFogMemoryReset = true;
        resetTargetingModes();
      }
      simulation.enqueue(command);
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
      accumulator = 0;
      proceduralAudio.setPaused(true);
      emit();
    },
    resume() {
      paused = false;
      pauseReason = null;
      accumulator = 0;
      previousSnapshot = lastSnapshot;
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
    centerCamera() {
      game.scene
        .getScene("operations")
        ?.cameras.main.centerOn(CAMERA_CENTER.x, CAMERA_CENTER.y);
    },
    destroy() {
      listeners.clear();
      detachKeyboardCaptureGuard();
      proceduralAudio.destroy();
      game.destroy(true);
    },
  };
}
