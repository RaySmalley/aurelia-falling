import { SIM_STEP_MS, Simulation } from "./simulation";
import type {
  GameRuntime,
  RuntimeListener,
  RuntimeSnapshot,
  SimCommand,
  Vec2,
} from "./types";

const TILE_WIDTH = 64;
const TILE_HEIGHT = 32;
const MAP_SIZE = 16;

function gridToWorld(point: Vec2) {
  return {
    x: (point.x - point.y) * (TILE_WIDTH / 2),
    y: (point.x + point.y) * (TILE_HEIGHT / 2),
  };
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
    private unit!: Phaser.GameObjects.Container;
    private selectionRing!: Phaser.GameObjects.Ellipse;
    private destinationMarker!: Phaser.GameObjects.Arc;
    private cursorKeys!: Phaser.Types.Input.Keyboard.CursorKeys;
    private keys!: Record<string, Phaser.Input.Keyboard.Key>;

    constructor() {
      super("operations");
    }

    create() {
      this.cameras.main.setBackgroundColor("#071318");
      this.drawTerrain();
      this.createUnit();
      this.cameras.main.centerOn(0, 260);

      this.cursorKeys = this.input.keyboard!.createCursorKeys();
      this.keys = this.input.keyboard!.addKeys("W,A,S,D") as Record<
        string,
        Phaser.Input.Keyboard.Key
      >;

      this.input.mouse?.disableContextMenu();
      this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
        const world = pointer.positionToCamera(
          this.cameras.main,
        ) as Phaser.Math.Vector2;
        if (pointer.rightButtonDown()) {
          simulation.enqueue({ kind: "move", target: worldToGrid(world) });
          return;
        }

        const unitWorld = gridToWorld(lastSnapshot.unit.position);
        const selected =
          Math.hypot(world.x - unitWorld.x, world.y - unitWorld.y) < 28;
        simulation.enqueue({ kind: "select", selected });
      });

      renderer =
        this.game.renderer.type === Phaser.WEBGL ? "WebGL" : "Canvas fallback";
      emit();
    }

    update(_: number, delta: number) {
      if (!paused) {
        accumulator = Math.min(accumulator + delta, SIM_STEP_MS * 4);
        while (accumulator >= SIM_STEP_MS) {
          simulation.step();
          accumulator -= SIM_STEP_MS;
        }
        lastSnapshot = simulation.snapshot();
      }

      const cameraSpeed = 0.42 * delta;
      if (this.cursorKeys.left.isDown || this.keys.A.isDown)
        this.cameras.main.scrollX -= cameraSpeed;
      if (this.cursorKeys.right.isDown || this.keys.D.isDown)
        this.cameras.main.scrollX += cameraSpeed;
      if (this.cursorKeys.up.isDown || this.keys.W.isDown)
        this.cameras.main.scrollY -= cameraSpeed;
      if (this.cursorKeys.down.isDown || this.keys.S.isDown)
        this.cameras.main.scrollY += cameraSpeed;

      const point = gridToWorld(lastSnapshot.unit.position);
      this.unit.setPosition(point.x, point.y);
      this.selectionRing.setVisible(lastSnapshot.unit.selected);
      if (lastSnapshot.unit.destination) {
        const target = gridToWorld(lastSnapshot.unit.destination);
        this.destinationMarker.setPosition(target.x, target.y).setVisible(true);
      } else {
        this.destinationMarker.setVisible(false);
      }

      if (
        lastSnapshot.tick !== lastEmittedTick &&
        lastSnapshot.tick % 2 === 0
      ) {
        lastEmittedTick = lastSnapshot.tick;
        emit();
      }
    }

    private drawTerrain() {
      const graphics = this.add.graphics();
      for (let y = 0; y < MAP_SIZE; y += 1) {
        for (let x = 0; x < MAP_SIZE; x += 1) {
          const point = gridToWorld({ x, y });
          const alternate = (x + y) % 2 === 0;
          graphics.fillStyle(alternate ? 0x183234 : 0x13292c, 1);
          graphics.lineStyle(1, 0x376164, 0.48);
          graphics.beginPath();
          graphics.moveTo(point.x, point.y - TILE_HEIGHT / 2);
          graphics.lineTo(point.x + TILE_WIDTH / 2, point.y);
          graphics.lineTo(point.x, point.y + TILE_HEIGHT / 2);
          graphics.lineTo(point.x - TILE_WIDTH / 2, point.y);
          graphics.closePath();
          graphics.fillPath();
          graphics.strokePath();
        }
      }
    }

    private createUnit() {
      const unitBody = this.add.graphics();
      unitBody.fillStyle(0xe4a33a, 1);
      unitBody.lineStyle(2, 0xffd78a, 1);
      unitBody.fillTriangle(-18, 11, 18, 11, 0, -14);
      unitBody.strokeTriangle(-18, 11, 18, 11, 0, -14);
      const core = this.add.circle(0, 0, 5, 0x86e7dc);
      this.unit = this.add.container(0, 0, [unitBody, core]).setDepth(10);
      this.selectionRing = this.add
        .ellipse(0, 13, 49, 22)
        .setStrokeStyle(2, 0x72e4d5, 0.95);
      this.unit.addAt(this.selectionRing, 0);
      this.destinationMarker = this.add
        .circle(0, 0, 8, 0x000000, 0)
        .setStrokeStyle(2, 0xf4bd55, 0.9)
        .setVisible(false);
    }
  }

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: host,
    width: 1280,
    height: 720,
    backgroundColor: "#071318",
    scene: OperationsScene,
    render: { antialias: true, pixelArt: false },
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
      game.scene.getScene("operations")?.cameras.main.centerOn(0, 260);
    },
    destroy() {
      listeners.clear();
      game.destroy(true);
    },
  };
}
