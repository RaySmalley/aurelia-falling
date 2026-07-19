import { BLOCKED_TILES, MAP_SIZE, TILE_MILLI } from "./map";
import { SIM_STEP_MS, Simulation } from "./simulation";
import type {
  GameRuntime,
  RuntimeListener,
  RuntimeSnapshot,
  SimCommand,
  SimulationSnapshot,
  UnitSnapshot,
  Vec2,
} from "./types";

const TILE_WIDTH = 64;
const TILE_HEIGHT = 32;
const CAMERA_CENTER = Object.freeze({ x: 0, y: 390 });

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
  const simulation = new Simulation();
  const listeners = new Set<RuntimeListener>();
  let paused = false;
  let pauseReason: RuntimeSnapshot["pauseReason"] = null;
  let audioReady = false;
  let renderer = "initializing";
  let accumulator = 0;
  let lastSnapshot = simulation.snapshot();
  let previousSnapshot = lastSnapshot;
  let lastEmittedTick = -1;

  const emit = () => {
    const snapshot: RuntimeSnapshot = {
      simulation: lastSnapshot,
      paused,
      pauseReason,
      audioReady,
      renderer,
    };
    listeners.forEach((listener) => listener(snapshot));
  };

  class OperationsScene extends Phaser.Scene {
    private cursorKeys!: Phaser.Types.Input.Keyboard.CursorKeys;
    private cameraKeys!: Record<string, Phaser.Input.Keyboard.Key>;
    private shiftKey!: Phaser.Input.Keyboard.Key;
    private ctrlKey!: Phaser.Input.Keyboard.Key;
    private selectionBox!: Phaser.GameObjects.Graphics;
    private routeGraphics!: Phaser.GameObjects.Graphics;
    private rallyGraphics!: Phaser.GameObjects.Graphics;
    private projectileGraphics!: Phaser.GameObjects.Graphics;
    private orderMarker!: Phaser.GameObjects.Arc;
    private dragStart: Phaser.Math.Vector2 | null = null;
    private unitViews = new Map<number, Phaser.GameObjects.Container>();
    private pendingOrder: "move" | "attackMove" | "rally" = "move";

    constructor() {
      super("operations");
    }

    create() {
      this.cameras.main.setBackgroundColor("#071318");
      this.drawTerrain();
      this.routeGraphics = this.add.graphics().setDepth(8);
      this.rallyGraphics = this.add.graphics().setDepth(7);
      this.projectileGraphics = this.add.graphics().setDepth(24);
      this.selectionBox = this.add.graphics().setDepth(100);
      this.orderMarker = this.add
        .circle(0, 0, 9, 0x000000, 0)
        .setStrokeStyle(2, 0xf4bd55, 0.95)
        .setDepth(30)
        .setVisible(false);
      this.syncUnitViews(lastSnapshot);

      const worldWidth = MAP_SIZE * TILE_WIDTH + 900;
      const worldHeight = MAP_SIZE * TILE_HEIGHT + 440;
      this.cameras.main.setBounds(
        -worldWidth / 2,
        -180,
        worldWidth,
        worldHeight,
      );
      this.cameras.main.centerOn(CAMERA_CENTER.x, CAMERA_CENTER.y);

      this.cursorKeys = this.input.keyboard!.createCursorKeys();
      this.cameraKeys = this.input.keyboard!.addKeys(
        "W,A,S,D",
      ) as Record<string, Phaser.Input.Keyboard.Key>;
      this.shiftKey = this.input.keyboard!.addKey("SHIFT");
      this.ctrlKey = this.input.keyboard!.addKey("CTRL");
      this.input.keyboard!.addCapture(
        "UP,DOWN,LEFT,RIGHT,W,A,S,D,F,X,H,R,ONE,TWO,THREE",
      );

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
        if (pointer.rightButtonDown()) {
          const targetGrid = worldToGrid(world);
          const target = {
            x: Math.round(targetGrid.x),
            y: Math.round(targetGrid.y),
          };
          const targetedEnemy = this.unitAtWorldPoint(world, 2);
          if (targetedEnemy && this.pendingOrder !== "rally") {
            simulation.enqueue({
              kind: "attackUnit",
              targetUnitId: targetedEnemy.id,
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

      renderer =
        this.game.renderer.type === Phaser.WEBGL ? "WebGL" : "Canvas fallback";
      emit();
    }

    update(_: number, delta: number) {
      if (!paused) {
        accumulator = Math.min(accumulator + delta, SIM_STEP_MS * 4);
        while (accumulator >= SIM_STEP_MS) {
          previousSnapshot = lastSnapshot;
          simulation.step();
          lastSnapshot = simulation.snapshot();
          accumulator -= SIM_STEP_MS;
        }
      }

      this.updateCamera(delta);
      this.syncUnitViews(lastSnapshot);
      this.renderUnits(
        previousSnapshot,
        lastSnapshot,
        paused ? 1 : accumulator / SIM_STEP_MS,
      );
      this.drawRoutes(lastSnapshot);
      this.drawProjectiles(lastSnapshot);

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
      if (this.cursorKeys.left.isDown || this.cameraKeys.A.isDown)
        this.cameras.main.scrollX -= cameraSpeed;
      if (this.cursorKeys.right.isDown || this.cameraKeys.D.isDown)
        this.cameras.main.scrollX += cameraSpeed;
      if (this.cursorKeys.up.isDown || this.cameraKeys.W.isDown)
        this.cameras.main.scrollY -= cameraSpeed;
      if (this.cursorKeys.down.isDown || this.cameraKeys.S.isDown)
        this.cameras.main.scrollY += cameraSpeed;
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

    private createUnitView(unit: UnitSnapshot) {
      const heavy = unit.armor === "heavy" || unit.armor === "siege";
      const teamColor = unit.playerId === 1 ? 0xe4a33a : 0x4ccac0;
      const outline = unit.playerId === 1 ? 0xffd78a : 0xb6fff5;
      const body = this.add.graphics();
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
      const core = this.add.circle(0, 0, 4, 0xe9ffff);
      const health = this.add.graphics().setName("health");
      const ring = this.add
        .ellipse(0, 13, heavy ? 52 : 45, heavy ? 24 : 20)
        .setStrokeStyle(2, 0xf4f0b5, 0.98)
        .setName("selection")
        .setVisible(unit.selected);
      const container = this.add
        .container(0, 0, [ring, body, core, health])
        .setDepth(10)
        .setName(`unit-${unit.id}`);
      this.unitViews.set(unit.id, container);
    }

    private syncUnitViews(snapshot: SimulationSnapshot) {
      const activeIds = new Set(snapshot.units.map((unit) => unit.id));
      for (const [id, view] of this.unitViews) {
        if (activeIds.has(id)) continue;
        view.destroy(true);
        this.unitViews.delete(id);
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
          .filter((unit) => unit.playerId === 1)
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
      } else {
        unitIds = lastSnapshot.units
          .filter((unit) => {
            if (unit.playerId !== 1) return false;
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
  });

  return {
    subscribe(listener) {
      listeners.add(listener);
      emit();
      return () => listeners.delete(listener);
    },
    enqueue(command: SimCommand) {
      simulation.enqueue(command);
    },
    pause(reason) {
      paused = true;
      pauseReason = reason;
      accumulator = 0;
      emit();
    },
    resume() {
      paused = false;
      pauseReason = null;
      accumulator = 0;
      previousSnapshot = lastSnapshot;
      emit();
    },
    async unlockAudio() {
      if (audioReady) return;
      const AudioContextClass =
        window.AudioContext ??
        (
          window as typeof window & {
            webkitAudioContext?: typeof AudioContext;
          }
        ).webkitAudioContext;
      if (!AudioContextClass) return;
      const context = new AudioContextClass();
      await context.resume();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      gain.gain.setValueAtTime(0.025, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(
        0.0001,
        context.currentTime + 0.09,
      );
      oscillator.frequency.value = 520;
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.09);
      audioReady = true;
      emit();
    },
    centerCamera() {
      game.scene
        .getScene("operations")
        ?.cameras.main.centerOn(CAMERA_CENTER.x, CAMERA_CENTER.y);
    },
    destroy() {
      listeners.clear();
      game.destroy(true);
    },
  };
}
