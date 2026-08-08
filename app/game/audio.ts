import type {
  AudioSettings,
  SimulationSnapshot,
} from "./types";

const clampVolume = (value: number) =>
  Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

export const isContinuousAudioTransition = (
  previous: SimulationSnapshot,
  current: SimulationSnapshot,
  maximumTickDelta = 1,
) =>
  current.seed === previous.seed &&
  current.tick > previous.tick &&
  current.tick <= previous.tick + maximumTickDelta;

export class ProceduralAudio {
  private context: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private effectsGain: GainNode | null = null;
  private ambientNodes: AudioNode[] = [];
  private paused = false;
  private settings: AudioSettings = {
    masterVolume: 0.8,
    musicVolume: 0.35,
    effectsVolume: 0.75,
  };

  constructor(private readonly onCue: (text: string) => void) {}

  async unlock() {
    if (this.context) {
      await this.context.resume();
      return this.context.state === "running";
    }
    const AudioContextClass =
      window.AudioContext ??
      (
        window as typeof window & {
          webkitAudioContext?: typeof AudioContext;
        }
      ).webkitAudioContext;
    if (!AudioContextClass) return false;

    const context = new AudioContextClass();
    const master = context.createGain();
    const music = context.createGain();
    const effects = context.createGain();
    music.connect(master);
    effects.connect(master);
    master.connect(context.destination);
    this.context = context;
    this.masterGain = master;
    this.musicGain = music;
    this.effectsGain = effects;
    this.applyVolumes();
    this.startAmbient();
    await context.resume();
    this.radio("Tactical audio link online", [410, 620]);
    return context.state === "running";
  }

  setSettings(settings: AudioSettings) {
    this.settings = {
      masterVolume: clampVolume(settings.masterVolume),
      musicVolume: clampVolume(settings.musicVolume),
      effectsVolume: clampVolume(settings.effectsVolume),
    };
    this.applyVolumes();
  }

  setPaused(paused: boolean) {
    this.paused = paused;
    this.applyVolumes();
  }

  observe(previous: SimulationSnapshot, current: SimulationSnapshot) {
    if (current.tick === previous.tick) return;
    if (
      previous.selectedUnitIds.length + previous.selectedStructureIds.length ===
        0 &&
      current.selectedUnitIds.length + current.selectedStructureIds.length > 0
    ) {
      this.radio("Coalition asset selected", [540, 720]);
    }

    const previousCompleted = new Set(
      previous.structures
        .filter((structure) => structure.completed)
        .map((structure) => structure.id),
    );
    const completed = current.structures.find(
      (structure) =>
        structure.playerId === current.controlledPlayer &&
        structure.completed &&
        !previousCompleted.has(structure.id),
    );
    if (completed) {
      this.radio(`${completed.displayName} online`, [360, 520, 760]);
    }

    const previousUnits = new Set(previous.units.map((unit) => unit.id));
    const produced = current.units.find(
      (unit) =>
        unit.playerId === current.controlledPlayer &&
        !previousUnits.has(unit.id),
    );
    if (produced) {
      this.radio(`${produced.displayName} ready`, [480, 660]);
    }

    const previousProjectiles = new Set(
      previous.projectiles.map((projectile) => projectile.id),
    );
    if (
      current.projectiles.some(
        (projectile) => !previousProjectiles.has(projectile.id),
      )
    ) {
      this.tone(130, 0.08, "sawtooth", 0.08);
      this.tone(260, 0.055, "square", 0.045, 0.015);
    }

    const currentUnits = new Set(current.units.map((unit) => unit.id));
    const currentStructures = new Set(
      current.structures.map((structure) => structure.id),
    );
    const ownLoss =
      previous.units.some(
        (unit) =>
          unit.playerId === current.controlledPlayer &&
          !currentUnits.has(unit.id),
      ) ||
      previous.structures.some(
        (structure) =>
          structure.playerId === current.controlledPlayer &&
          !currentStructures.has(structure.id),
      );
    if (ownLoss) {
      this.noiseBurst(0.42, 0.15);
      this.onCue("Coalition asset destroyed");
    }

    const player = current.players[current.controlledPlayer];
    const previousPlayer = previous.players[current.controlledPlayer];
    if (player.lowPower && !previousPlayer.lowPower) {
      this.radio("Warning: power grid overloaded", [220, 180, 220]);
    }

    for (const playerId of [1, 2] as const) {
      const before = previous.solarSpears[playerId];
      const after = current.solarSpears[playerId];
      if (before.state !== "warning" && after.state === "warning") {
        this.radio("Solar Spear launch detected", [180, 240, 180, 320]);
      }
      if (after.lastImpact && after.lastImpact.tick !== before.lastImpact?.tick) {
        this.noiseBurst(0.9, 0.34);
        this.tone(62, 0.8, "sawtooth", 0.18);
        this.onCue("Solar Spear impact");
      }
    }

    if (
      previous.status === "active" &&
      current.status !== "active"
    ) {
      this.radio(
        current.status === "victory"
          ? "Enemy command signal terminated"
          : current.status === "draw"
            ? "Mutual command loss confirmed"
            : "Coalition command signal terminated",
        current.status === "victory" ? [420, 620, 820] : [420, 300, 190],
      );
    }
  }

  destroy() {
    for (const node of this.ambientNodes) {
      if (node instanceof OscillatorNode) node.stop();
      node.disconnect();
    }
    this.ambientNodes = [];
    void this.context?.close();
    this.context = null;
  }

  private applyVolumes() {
    if (!this.context) return;
    const now = this.context.currentTime;
    this.masterGain?.gain.setTargetAtTime(
      this.settings.masterVolume,
      now,
      0.02,
    );
    this.musicGain?.gain.setTargetAtTime(
      this.settings.musicVolume * (this.paused ? 0.3 : 1),
      now,
      0.08,
    );
    this.effectsGain?.gain.setTargetAtTime(
      this.settings.effectsVolume,
      now,
      0.02,
    );
  }

  private radio(text: string, notes: readonly number[]) {
    this.onCue(text);
    notes.forEach((frequency, index) =>
      this.tone(frequency, 0.07, "square", 0.055, index * 0.085),
    );
  }

  private tone(
    frequency: number,
    duration: number,
    type: OscillatorType,
    volume: number,
    delay = 0,
  ) {
    if (!this.context || !this.effectsGain) return;
    const start = this.context.currentTime + delay;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain).connect(this.effectsGain);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  private noiseBurst(duration: number, volume: number) {
    if (!this.context || !this.effectsGain) return;
    const sampleCount = Math.max(
      1,
      Math.floor(this.context.sampleRate * duration),
    );
    const buffer = this.context.createBuffer(
      1,
      sampleCount,
      this.context.sampleRate,
    );
    const data = buffer.getChannelData(0);
    for (let index = 0; index < data.length; index += 1) {
      const phase = index + 1;
      data[index] =
        (Math.sin(phase * 12.9898) * 0.55 +
          Math.sin(phase * 4.1414) * 0.3 +
          Math.sin(phase * 0.731) * 0.15) *
        (1 - index / data.length);
    }
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    filter.type = "lowpass";
    filter.frequency.value = 680;
    gain.gain.value = volume;
    source.buffer = buffer;
    source.connect(filter).connect(gain).connect(this.effectsGain);
    source.start();
  }

  private startAmbient() {
    if (!this.context || !this.musicGain) return;
    const low = this.context.createOscillator();
    const high = this.context.createOscillator();
    const lfo = this.context.createOscillator();
    const lfoGain = this.context.createGain();
    const filter = this.context.createBiquadFilter();
    const bedGain = this.context.createGain();
    low.type = "sawtooth";
    low.frequency.value = 43;
    high.type = "triangle";
    high.frequency.value = 86;
    lfo.type = "sine";
    lfo.frequency.value = 0.11;
    lfoGain.gain.value = 170;
    filter.type = "lowpass";
    filter.frequency.value = 520;
    bedGain.gain.value = 0.055;
    lfo.connect(lfoGain).connect(filter.frequency);
    low.connect(filter);
    high.connect(filter);
    filter.connect(bedGain).connect(this.musicGain);
    low.start();
    high.start();
    lfo.start();
    this.ambientNodes = [low, high, lfo, lfoGain, filter, bedGain];
  }
}
