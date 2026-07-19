import type { SimCommand, SimulationSnapshot, Vec2 } from "./types";

const TICKS_PER_SECOND = 20;
const SPEED_PER_SECOND = 2.8;
const STEP_DISTANCE = SPEED_PER_SECOND / TICKS_PER_SECOND;
const ARRIVAL_EPSILON = 0.025;

export class Simulation {
  private tick = 0;
  private position: Vec2 = { x: 6, y: 7 };
  private destination: Vec2 | null = null;
  private selected = false;
  private readonly commands: SimCommand[] = [];

  enqueue(command: SimCommand) {
    this.commands.push(command);
  }

  step() {
    for (const command of this.commands.splice(0)) {
      if (command.kind === "select") this.selected = command.selected;
      if (command.kind === "move" && this.selected) {
        this.destination = {
          x: Math.max(0, Math.min(15, command.target.x)),
          y: Math.max(0, Math.min(15, command.target.y)),
        };
      }
    }

    if (this.destination) {
      const dx = this.destination.x - this.position.x;
      const dy = this.destination.y - this.position.y;
      const distance = Math.hypot(dx, dy);
      if (distance <= STEP_DISTANCE + ARRIVAL_EPSILON) {
        this.position = this.destination;
        this.destination = null;
      } else {
        this.position = {
          x: this.position.x + (dx / distance) * STEP_DISTANCE,
          y: this.position.y + (dy / distance) * STEP_DISTANCE,
        };
      }
    }

    this.tick += 1;
  }

  snapshot(): SimulationSnapshot {
    return {
      tick: this.tick,
      unit: {
        id: "pathfinder-01",
        position: { ...this.position },
        destination: this.destination ? { ...this.destination } : null,
        selected: this.selected,
      },
    };
  }
}

export const SIM_STEP_MS = 1000 / TICKS_PER_SECOND;
