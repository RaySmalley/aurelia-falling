"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { gameData } from "../game/data";
import type {
  AiDifficulty,
  AudioSettings,
  BuildingKind,
  GameRuntime,
  RuntimeSnapshot,
  UnitKind,
} from "../game/types";

const EMPTY_PLAYER = Object.freeze({
  id: 1 as const,
  credits: 0,
  powerGenerated: 0,
  powerConsumed: 0,
  lowPower: false,
});
const EMPTY_SOLAR = (playerId: 1 | 2) =>
  Object.freeze({
    playerId,
    state: "unavailable" as const,
    chargeTicks: 0,
    chargeTotalTicks: gameData.solarSpear.chargeTicks,
    target: null,
    impactTick: null,
    lastImpact: null,
    launches: 0,
  });

const INITIAL_SNAPSHOT: RuntimeSnapshot = {
  simulation: {
    tick: 0,
    scenario: "skirmish",
    controlledPlayer: 1,
    units: [],
    structures: [],
    fields: [],
    players: {
      1: EMPTY_PLAYER,
      2: Object.freeze({ ...EMPTY_PLAYER, id: 2 as const }),
    },
    projectiles: [],
    selectedUnitIds: [],
    selectedStructureIds: [],
    rallies: [],
    status: "active",
    winner: null,
    kills: { 1: 0, 2: 0 },
    seed: 0,
    lastPlacementFailure: null,
    lastSolarFailure: null,
    visibility: {
      enabled: true,
      width: 64,
      height: 64,
      revision: 0,
      tiles: [],
    },
    ai: {
      enabled: true,
      playerId: 2,
      profile: "normal",
      phase: "build",
      lastDecisionTick: -1,
      knownEnemyUnits: 0,
      knownEnemyStructures: 0,
    cheats: false,
    },
    solarSpears: {
      1: EMPTY_SOLAR(1),
      2: EMPTY_SOLAR(2),
    },
    onboarding: {
      selection: false,
      reactor: false,
      refinery: false,
      barracks: false,
      production: false,
      controlGroup: false,
      attackMove: false,
      operationsCenter: false,
      solarSpear: false,
    },
  },
  paused: true,
  pauseReason: "manual",
  audioReady: false,
  cameraMoved: false,
  pendingBuilding: null,
  solarTargeting: false,
  audioCue: null,
  renderer: "initializing",
  cameraZoom: 1,
};

const BUILD_ORDER: readonly BuildingKind[] = [
  "reactor",
  "refinery",
  "barracks",
  "foundry",
  "operationsCenter",
  "turret",
];

const PLACEMENT_MESSAGES = {
  outsideMap: "Placement is outside the Golden Scar.",
  blockedTerrain: "Scorched terrain blocks this site.",
  occupied: "Another unit or structure occupies this tile.",
  resourceField: "Aurelite vents cannot be built over.",
  unexplored: "Construction requires current battlefield vision.",
  outsideBuildRadius: "Site is outside connected construction radius.",
  missingPrerequisite: "Build-tree prerequisite is missing.",
  insufficientCredits: "Insufficient credits.",
  citadelUnique: "Each side may field only one Citadel.",
} as const;

const SOLAR_MESSAGES = {
  outsideMap: "Solar Spear target is outside the Golden Scar.",
  notVisible: "Solar Spear requires current vision of the target ground.",
  notReady: "A powered Oracle must finish charging before launch.",
} as const;

type AppSettings = AudioSettings &
  Readonly<{
    uiScale: number;
    cameraZoom: number;
    subtitles: boolean;
    reducedMotion: boolean;
    onboarding: boolean;
  }>;

const DEFAULT_SETTINGS: AppSettings = Object.freeze({
  masterVolume: 0.8,
  musicVolume: 0.35,
  effectsVolume: 0.75,
  uiScale: 1,
  cameraZoom: 1,
  subtitles: true,
  reducedMotion: false,
  onboarding: true,
});

const SETTINGS_KEY = "aurelia-falling.settings.v1";
const ONBOARDING_KEY = "aurelia-falling.onboarding.v1";
const CAMERA_ZOOM_LEVELS = [0.75, 0.9, 1, 1.1, 1.25] as const;

const TUTORIAL_STEPS = [
  {
    id: "cameraSelection",
    title: "Establish tactical control",
    body: "Pan with WASD or arrow keys, then click or drag-select a Coalition asset.",
  },
  {
    id: "reactor",
    title: "Stabilize the grid",
    body: "Construct a Prometheus Reactor inside connected build radius.",
  },
  {
    id: "refinery",
    title: "Expand Aurelite income",
    body: "Construct a Midas Refinery. A completed Refinery deploys a free Harvester.",
  },
  {
    id: "barracks",
    title: "Open infantry production",
    body: "Construct an Aegis Barracks on visible, connected ground.",
  },
  {
    id: "production",
    title: "Commission a combat unit",
    body: "Select a production structure and queue any combat unit.",
  },
  {
    id: "controlGroup",
    title: "Bind a control group",
    body: "Select units, then press Ctrl+1, Ctrl+2, or Ctrl+3.",
  },
  {
    id: "attackMove",
    title: "Advance under weapons free",
    body: "Select combat units, press F, then right-click visible ground.",
  },
  {
    id: "operationsCenter",
    title: "Unlock strategic command",
    body: "Construct an Oracle Operations Center and keep it powered.",
  },
  {
    id: "solarSpear",
    title: "Fire the Solar Spear",
    body: "When the Oracle is charged, arm the Solar Spear and select currently visible ground.",
  },
] as const;

type TutorialStepId = (typeof TUTORIAL_STEPS)[number]["id"];
type TutorialProgress = Record<TutorialStepId, boolean>;

const EMPTY_TUTORIAL_PROGRESS: TutorialProgress = {
  cameraSelection: false,
  reactor: false,
  refinery: false,
  barracks: false,
  production: false,
  controlGroup: false,
  attackMove: false,
  operationsCenter: false,
  solarSpear: false,
};

const clamp = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : fallback;

function loadSettings(): AppSettings {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}");
    return {
      masterVolume: clamp(
        stored.masterVolume,
        DEFAULT_SETTINGS.masterVolume,
      ),
      musicVolume: clamp(stored.musicVolume, DEFAULT_SETTINGS.musicVolume),
      effectsVolume: clamp(
        stored.effectsVolume,
        DEFAULT_SETTINGS.effectsVolume,
      ),
      uiScale: [0.9, 1, 1.1].includes(stored.uiScale)
        ? stored.uiScale
        : DEFAULT_SETTINGS.uiScale,
      cameraZoom: [0.75, 0.9, 1, 1.1, 1.25].includes(stored.cameraZoom)
        ? stored.cameraZoom
        : DEFAULT_SETTINGS.cameraZoom,
      subtitles:
        typeof stored.subtitles === "boolean"
          ? stored.subtitles
          : DEFAULT_SETTINGS.subtitles,
      reducedMotion:
        typeof stored.reducedMotion === "boolean"
          ? stored.reducedMotion
          : DEFAULT_SETTINGS.reducedMotion,
      onboarding:
        typeof stored.onboarding === "boolean"
          ? stored.onboarding
          : DEFAULT_SETTINGS.onboarding,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function loadTutorialProgress(): TutorialProgress {
  try {
    const stored = JSON.parse(localStorage.getItem(ONBOARDING_KEY) ?? "{}");
    return Object.fromEntries(
      TUTORIAL_STEPS.map((step) => [step.id, stored[step.id] === true]),
    ) as TutorialProgress;
  } catch {
    return { ...EMPTY_TUTORIAL_PROGRESS };
  }
}

export default function SkirmishShell() {
  const hostRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<GameRuntime | null>(null);
  const settingsRef = useRef<AppSettings>(DEFAULT_SETTINGS);
  const [snapshot, setSnapshot] = useState(INITIAL_SNAPSHOT);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [screen, setScreen] = useState<"setup" | "playing">("setup");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [settingsHydrated, setSettingsHydrated] = useState(false);
  const [runtimeReady, setRuntimeReady] = useState(false);
  const [runtimeAttempt, setRuntimeAttempt] = useState(0);
  const [seedInput, setSeedInput] = useState("4115");
  const [difficulty, setDifficulty] = useState<AiDifficulty>("normal");
  const [tutorialProgress, setTutorialProgress] =
    useState<TutorialProgress>(EMPTY_TUTORIAL_PROGRESS);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const loadedSettings = loadSettings();
      settingsRef.current = loadedSettings;
      setSettings(loadedSettings);
      setTutorialProgress(loadTutorialProgress());
      setSettingsHydrated(true);
    });
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (!settingsHydrated) return;
    settingsRef.current = settings;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    runtimeRef.current?.setAudioSettings(settings);
    runtimeRef.current?.setCameraZoom(settings.cameraZoom);
    runtimeRef.current?.setReducedScreenShake(settings.reducedMotion);
  }, [settings, settingsHydrated]);

  useEffect(() => {
    let disposed = false;
    let unsubscribe = () => {};
    async function start() {
      try {
        setLoadError(null);
        setRuntimeReady(false);
        const { createGameRuntime } = await import("../game/bootstrap");
        if (!hostRef.current || disposed) return;
        const runtime = await createGameRuntime(hostRef.current);
        if (disposed) {
          runtime.destroy();
          return;
        }
        runtimeRef.current = runtime;
        setRuntimeReady(true);
        runtime.setAudioSettings(settingsRef.current);
        runtime.setCameraZoom(settingsRef.current.cameraZoom);
        runtime.setReducedScreenShake(settingsRef.current.reducedMotion);
        runtime.pause("manual");
        unsubscribe = runtime.subscribe(setSnapshot);
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : "Unknown error");
      }
    }
    const onVisibilityChange = () => {
      if (document.hidden) runtimeRef.current?.pause("hidden");
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    void start();
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      unsubscribe();
      runtimeRef.current?.destroy();
      runtimeRef.current = null;
    };
  }, [runtimeAttempt]);

  useEffect(() => {
    const unlock = () => void runtimeRef.current?.unlockAudio();
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  const simulation = snapshot.simulation;
  const placement = snapshot.pendingBuilding;
  const solarTargeting = snapshot.solarTargeting;
  const observedProgress: TutorialProgress = {
    cameraSelection:
      snapshot.cameraMoved && simulation.onboarding.selection,
    reactor: simulation.onboarding.reactor,
    refinery: simulation.onboarding.refinery,
    barracks: simulation.onboarding.barracks,
    production: simulation.onboarding.production,
    controlGroup: simulation.onboarding.controlGroup,
    attackMove: simulation.onboarding.attackMove,
    operationsCenter: simulation.onboarding.operationsCenter,
    solarSpear: simulation.onboarding.solarSpear,
  };
  const observedProgressKey = JSON.stringify(observedProgress);

  useEffect(() => {
    const observed = JSON.parse(observedProgressKey) as TutorialProgress;
    const timeout = window.setTimeout(() => {
      setTutorialProgress((current) => {
        const next = { ...current };
        let changed = false;
        for (const step of TUTORIAL_STEPS) {
          if (observed[step.id] && !current[step.id]) {
            next[step.id] = true;
            changed = true;
          }
        }
        if (!changed) return current;
        localStorage.setItem(ONBOARDING_KEY, JSON.stringify(next));
        return next;
      });
    });
    return () => window.clearTimeout(timeout);
  }, [observedProgressKey]);

  const side = simulation.controlledPlayer;
  const player = simulation.players[side];
  const selectedUnits = simulation.units.filter((unit) => unit.selected);
  const selectedStructure =
    simulation.structures.find((structure) => structure.selected) ?? null;
  const leadUnit = selectedUnits[0] ?? null;
  const placementFailure = simulation.lastPlacementFailure;
  const exploredTiles = simulation.visibility.tiles.filter(
    (level) => level > 0,
  ).length;
  const visibleEnemies =
    simulation.units.filter((unit) => unit.playerId !== side).length +
    simulation.structures.filter(
      (structure) => structure.playerId !== side,
    ).length;
  const solar = simulation.solarSpears[side];
  const solarProgress = Math.floor(
    (100 * solar.chargeTicks) / Math.max(1, solar.chargeTotalTicks),
  );
  const warning = ([1, 2] as const)
    .map((playerId) => simulation.solarSpears[playerId])
    .find((candidate) => candidate.state === "warning");
  const currentTutorial = TUTORIAL_STEPS.find(
    (step) => !tutorialProgress[step.id],
  );

  useEffect(() => {
    if (solar.state !== "ready" && solarTargeting) {
      runtimeRef.current?.beginSolarTargeting(false);
    }
  }, [solar.state, solarTargeting]);

  const beginPlacement = (kind: BuildingKind) => {
    const next = placement === kind ? null : kind;
    runtimeRef.current?.beginPlacement(next);
  };

  const queueUnit = (unitKind: UnitKind) => {
    if (!selectedStructure) return;
    runtimeRef.current?.enqueue({
      kind: "queueUnit",
      structureId: selectedStructure.id,
      unitKind,
    });
  };

  const startMatch = () => {
    const parsed = Number.parseInt(seedInput, 10);
    const seed = Number.isFinite(parsed) ? parsed >>> 0 : 4_115;
    setSeedInput(String(seed));
    runtimeRef.current?.clearTargetingModes();
    runtimeRef.current?.enqueue({
      kind: "restartSkirmish",
      seed,
      difficulty,
    });
    runtimeRef.current?.resume();
    setScreen("playing");
  };

  const restartMatch = () => {
    runtimeRef.current?.clearTargetingModes();
    runtimeRef.current?.enqueue({
      kind: "restartSkirmish",
      seed: simulation.seed,
      difficulty: simulation.ai.profile,
    });
    runtimeRef.current?.resume();
  };

  const returnToSetup = () => {
    runtimeRef.current?.pause("manual");
    setScreen("setup");
    setSettingsOpen(false);
    runtimeRef.current?.clearTargetingModes();
  };

  const openSettings = () => {
    if (screen === "playing" && simulation.status === "active") {
      runtimeRef.current?.pause("manual");
    }
    setSettingsOpen(true);
  };

  const toggleSolarTargeting = () => {
    if (solar.state !== "ready") return;
    const next = !solarTargeting;
    runtimeRef.current?.beginSolarTargeting(next);
  };

  const dismissOnboarding = () => {
    const completed = Object.fromEntries(
      TUTORIAL_STEPS.map((step) => [step.id, true]),
    ) as TutorialProgress;
    setTutorialProgress(completed);
    localStorage.setItem(ONBOARDING_KEY, JSON.stringify(completed));
  };

  const resetOnboarding = () => {
    const reset = { ...EMPTY_TUTORIAL_PROGRESS };
    setTutorialProgress(reset);
    localStorage.setItem(ONBOARDING_KEY, JSON.stringify(reset));
    setSettings((current) => ({ ...current, onboarding: true }));
  };

  const adjustCameraZoom = (direction: -1 | 1) => {
    setSettings((current) => {
      const closestIndex = CAMERA_ZOOM_LEVELS.reduce(
        (best, zoom, index) =>
          Math.abs(zoom - current.cameraZoom) <
          Math.abs(CAMERA_ZOOM_LEVELS[best] - current.cameraZoom)
            ? index
            : best,
        0,
      );
      const nextIndex = Math.max(
        0,
        Math.min(CAMERA_ZOOM_LEVELS.length - 1, closestIndex + direction),
      );
      return {
        ...current,
        cameraZoom: CAMERA_ZOOM_LEVELS[nextIndex],
      };
    });
  };

  const shellStyle = {
    "--ui-scale": settings.uiScale,
    "--ui-shell-width": `${100 / settings.uiScale}vw`,
    "--ui-shell-height-fallback": `${100 / settings.uiScale}vh`,
    "--ui-shell-height": `${100 / settings.uiScale}dvh`,
  } as CSSProperties;

  return (
    <main
      className={`operations-shell economy-shell skirmish-shell ${
        settings.reducedMotion ? "reduced-motion" : ""
      } screen-${screen}`}
      style={shellStyle}
    >
      <header className="topbar">
        <div>
          <p className="eyebrow">ARCLIGHT COMMAND // GOLDEN SCAR</p>
          <h1>Aurelia Falling</h1>
        </div>
        <div className="resource-bar" aria-label="Economy status">
          <div>
            <span className="resource-label">
              <i className="aurelite-icon" aria-hidden="true" />
              CREDITS
            </span>
            <strong>{player.credits.toLocaleString()}</strong>
          </div>
          <div className={player.lowPower ? "warning" : ""}>
            <span>POWER</span>
            <strong>
              {player.powerGenerated} / {player.powerConsumed}
            </strong>
          </div>
          <div className={solar.state === "ready" ? "solar-ready" : ""}>
            <span>SOLAR SPEAR</span>
            <strong>
              {solar.state === "charging"
                ? `${solarProgress}%`
                : solar.state.toUpperCase()}
            </strong>
          </div>
        </div>
        <div className="header-actions">
          <button onClick={openSettings}>Settings</button>
          {screen === "playing" && simulation.status === "active" && (
            <button onClick={() => runtimeRef.current?.pause("manual")}>
              Pause
            </button>
          )}
          <div className="phase-badge">
            <span>PHASE 9</span>
            <strong>BATTLEFIELD ART</strong>
          </div>
        </div>
      </header>

      <section className="battlefield-frame" aria-label="RTS battlefield">
        <div ref={hostRef} className="game-host" />
        {loadError && (
          <div className="fatal-panel" role="alert">
            <strong>Simulation link failed</strong>
            <span>{loadError}</span>
            <button onClick={() => setRuntimeAttempt((attempt) => attempt + 1)}>
              Retry tactical payload
            </button>
          </div>
        )}

        {screen === "setup" && !loadError && (
          <div className="pause-curtain setup-curtain">
            <p className="eyebrow">MATCH SETUP // OPERATION FALLING STAR</p>
            <h2>Deploy to the Golden Scar</h2>
            <div className="setup-grid">
              <div>
                <span>MAP</span>
                <strong>The Golden Scar · 64×64</strong>
              </div>
              <div>
                <span>OPPOSITION</span>
                <strong>
                  {difficulty[0].toUpperCase() + difficulty.slice(1)} AI ·
                  Rules legal
                </strong>
              </div>
              <div>
                <span>VICTORY</span>
                <strong>Destroy the enemy Citadel</strong>
              </div>
            </div>
            <label className="seed-field">
              <span>Deterministic match seed</span>
              <input
                value={seedInput}
                inputMode="numeric"
                onChange={(event) => setSeedInput(event.target.value)}
              />
            </label>
            <label className="seed-field">
              <span>AI pacing profile</span>
              <select
                value={difficulty}
                onChange={(event) =>
                  setDifficulty(event.target.value as AiDifficulty)
                }
              >
                <option value="easy">Easy · deliberate and cautious</option>
                <option value="normal">Normal · canonical balance</option>
                <option value="hard">Hard · faster and aggressive</option>
              </select>
            </label>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={settings.onboarding}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    onboarding: event.target.checked,
                  }))
                }
              />
              Enable contextual first-match guidance
            </label>
            <button
              className="primary-action"
              disabled={!runtimeReady}
              onClick={startMatch}
            >
              Begin operation
            </button>
            <div className="payload-status" aria-live="polite">
              <span>
                {runtimeReady
                  ? "TACTICAL PAYLOAD READY"
                  : "PRELOADING TACTICAL PAYLOAD"}
              </span>
              <i style={{ width: runtimeReady ? "100%" : "34%" }} />
            </div>
          </div>
        )}

        {screen === "playing" &&
          snapshot.paused &&
          simulation.status === "active" &&
          !settingsOpen && (
            <div className="pause-curtain">
              <p>TACTICAL LINK SUSPENDED</p>
              <h2>Skirmish paused</h2>
              <span>
                {snapshot.pauseReason === "hidden"
                  ? "The hidden-tab interval was discarded. Resume explicitly; no simulation catch-up will occur."
                  : "Fixed-step progression and procedural battle audio are suspended."}
              </span>
              <div className="overlay-actions">
                <button onClick={() => runtimeRef.current?.resume()}>
                  Resume operation
                </button>
                <button onClick={openSettings}>Settings</button>
                <button onClick={restartMatch}>Restart</button>
                <button
                  className="danger"
                  onClick={() => {
                    if (window.confirm("Surrender this operation?")) {
                      runtimeRef.current?.resume();
                      runtimeRef.current?.enqueue({ kind: "surrender" });
                    }
                  }}
                >
                  Surrender
                </button>
                <button onClick={returnToSetup}>Match setup</button>
              </div>
            </div>
          )}

        {screen === "playing" && simulation.status !== "active" && (
          <div className="pause-curtain match-result">
            <p>MATCH RESOLUTION // {simulation.status.toUpperCase()}</p>
            <h2>
              {simulation.status === "draw"
                ? "Both Citadels destroyed"
                : simulation.winner === 1
                  ? "Gold controls Aurelia"
                  : "Cyan controls Aurelia"}
            </h2>
            <div className="result-grid">
              <div>
                <span>ELAPSED</span>
                <strong>
                  {Math.floor(simulation.tick / 1_200)}:
                  {String(
                    Math.floor((simulation.tick % 1_200) / 20),
                  ).padStart(2, "0")}
                </strong>
              </div>
              <div>
                <span>GOLD KILLS</span>
                <strong>{simulation.kills[1]}</strong>
              </div>
              <div>
                <span>SOLAR LAUNCHES</span>
                <strong>{simulation.solarSpears[1].launches}</strong>
              </div>
              <div>
                <span>SEED</span>
                <strong>{simulation.seed}</strong>
              </div>
            </div>
            <div className="overlay-actions">
              <button onClick={restartMatch}>Rematch</button>
              <button onClick={returnToSetup}>Match setup</button>
            </div>
          </div>
        )}

        {settingsOpen && (
          <div className="pause-curtain settings-curtain" role="dialog">
            <p className="eyebrow">LOCAL COMMAND SETTINGS</p>
            <h2>Audio and interface</h2>
            <div className="settings-list">
              {(
                [
                  ["masterVolume", "Master volume"],
                  ["musicVolume", "Ambient volume"],
                  ["effectsVolume", "Effects volume"],
                ] as const
              ).map(([key, label]) => (
                <label key={key}>
                  <span>{label}</span>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={settings[key]}
                    onChange={(event) =>
                      setSettings((current) => ({
                        ...current,
                        [key]: Number(event.target.value),
                      }))
                    }
                  />
                  <strong>{Math.round(settings[key] * 100)}%</strong>
                </label>
              ))}
              <label>
                <span>Interface scale</span>
                <select
                  value={settings.uiScale}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      uiScale: Number(event.target.value),
                    }))
                  }
                >
                  <option value="0.9">90%</option>
                  <option value="1">100%</option>
                  <option value="1.1">110%</option>
                </select>
              </label>
              <label>
                <span>Battlefield zoom</span>
                <select
                  value={settings.cameraZoom}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      cameraZoom: Number(event.target.value),
                    }))
                  }
                >
                  <option value="0.75">75% · strategic</option>
                  <option value="0.9">90%</option>
                  <option value="1">100%</option>
                  <option value="1.1">110%</option>
                  <option value="1.25">125% · tactical</option>
                </select>
              </label>
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={settings.subtitles}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      subtitles: event.target.checked,
                    }))
                  }
                />
                Text equivalents for radio alerts
              </label>
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={settings.reducedMotion}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      reducedMotion: event.target.checked,
                    }))
                  }
                />
                Reduce interface motion and screen shake
              </label>
            </div>
            <div className="overlay-actions">
              <button onClick={() => setSettingsOpen(false)}>Done</button>
              <button onClick={resetOnboarding}>Restart onboarding</button>
            </div>
          </div>
        )}

        {screen === "playing" &&
          settings.onboarding &&
          currentTutorial &&
          simulation.status === "active" &&
          !snapshot.paused && (
            <aside className="onboarding-card" aria-live="polite">
              <span>
                GUIDANCE{" "}
                {TUTORIAL_STEPS.findIndex(
                  (step) => step.id === currentTutorial.id,
                ) + 1}
                /{TUTORIAL_STEPS.length}
              </span>
              <strong>{currentTutorial.title}</strong>
              <p>{currentTutorial.body}</p>
              <button onClick={dismissOnboarding}>Dismiss guidance</button>
            </aside>
          )}

        {warning?.target && warning.impactTick !== null && (
          <div className="solar-warning" role="alert">
            <strong>SOLAR SPEAR WARNING</strong>
            <span>
              Impact in{" "}
              {(
                Math.max(0, warning.impactTick - simulation.tick) / 20
              ).toFixed(1)}
              s · grid {warning.target.x},{warning.target.y}
            </span>
          </div>
        )}

        {settings.subtitles && snapshot.audioCue && (
          <div className="radio-subtitle" aria-live="polite">
            RADIO // {snapshot.audioCue.text}
          </div>
        )}
      </section>

      {screen === "playing" && (
        <section className="economy-deck" aria-label="Economy command HUD">
        <aside className="build-sidebar">
          <div className="panel-heading">
            <p className="eyebrow">CONSTRUCTION GRID</p>
            <h2>Build structures</h2>
          </div>
          <div className="build-grid">
            {BUILD_ORDER.map((kind) => {
              const definition = gameData.buildings[kind];
              return (
                <button
                  key={kind}
                  className={placement === kind ? "active" : ""}
                  onClick={() => beginPlacement(kind)}
                >
                  <span>{definition.displayName}</span>
                  <small>{definition.cost} cr</small>
                </button>
              );
            })}
          </div>
          <p className="placement-help">
            {placement
              ? `Right-click to place ${gameData.buildings[placement].displayName}. Invalid sites keep placement active.`
              : "Choose a structure, then right-click inside a connected radius."}
          </p>
          {placementFailure && (
            <p className="placement-error" role="status">
              {PLACEMENT_MESSAGES[placementFailure]}
            </p>
          )}
        </aside>

        <section className="selection-panel">
          <div className="selection-heading">
            {leadUnit ? (
              <div
                className={`asset-portrait unit-portrait portrait-${leadUnit.kind}`}
                role="img"
                aria-label={`${leadUnit.displayName} portrait`}
              />
            ) : selectedStructure ? (
              <div
                className={`asset-portrait structure-portrait portrait-${selectedStructure.kind}`}
                role="img"
                aria-label={`${selectedStructure.displayName} portrait`}
              />
            ) : null}
            <div className="panel-heading">
              <p className="eyebrow">SELECTED ASSET</p>
              <h2>
                {selectedStructure?.displayName ??
                  leadUnit?.displayName ??
                  "No asset selected"}
              </h2>
            </div>
          </div>
          {selectedStructure ? (
            <>
              <dl className="asset-stats">
                <div>
                  <dt>INTEGRITY</dt>
                  <dd>
                    {selectedStructure.health}/{selectedStructure.maxHealth}
                  </dd>
                </div>
                <div>
                  <dt>GRID</dt>
                  <dd>
                    {selectedStructure.powered ? "ONLINE" : "LOW POWER"}
                  </dd>
                </div>
                <div>
                  <dt>LINK</dt>
                  <dd>
                    {selectedStructure.connected ? "CONNECTED" : "ORPHANED"}
                  </dd>
                </div>
              </dl>
              <div className="production-grid">
                {gameData.buildings[selectedStructure.kind].produces.map(
                  (unitKind) => (
                    <button
                      key={unitKind}
                      onClick={() => queueUnit(unitKind)}
                    >
                      <span>{gameData.units[unitKind].displayName}</span>
                      <small>{gameData.units[unitKind].cost} cr</small>
                    </button>
                  ),
                )}
                {gameData.buildings[selectedStructure.kind].produces.length ===
                  0 && <p>No production line installed.</p>}
              </div>
              <div className="queue-strip">
                {selectedStructure.queue.map((item, index) => (
                  <button
                    key={`${item.unitKind}-${index}`}
                    onClick={() =>
                      runtimeRef.current?.enqueue({
                        kind: "cancelProduction",
                        structureId: selectedStructure.id,
                        queueIndex: index,
                      })
                    }
                    title="Cancel for full refund"
                  >
                    {gameData.units[item.unitKind].displayName}{" "}
                    {Math.ceil(
                      (100 *
                        (item.totalTicks - item.remainingTicks)) /
                        item.totalTicks,
                    )}
                    %
                  </button>
                ))}
              </div>
              <button
                className={selectedStructure.repairing ? "active" : ""}
                onClick={() =>
                  runtimeRef.current?.enqueue({
                    kind: "setRepair",
                    structureId: selectedStructure.id,
                    enabled: !selectedStructure.repairing,
                  })
                }
              >
                {selectedStructure.repairing ? "Stop repairs" : "Repair"}
              </button>
              {selectedStructure.kind !== "citadel" && (
                <button
                  className="sell-action"
                  onClick={() => {
                    const refund = Math.floor(
                      (gameData.buildings[selectedStructure.kind].cost *
                        gameData.economy.structureSellRefundBasisPoints) /
                        10_000,
                    );
                    if (
                      window.confirm(
                        `Sell ${selectedStructure.displayName} for ${refund} credits plus full queued-unit refunds?`,
                      )
                    ) {
                      runtimeRef.current?.enqueue({
                        kind: "sellStructure",
                        structureId: selectedStructure.id,
                      });
                    }
                  }}
                >
                  Sell ·{" "}
                  {Math.floor(
                    (gameData.buildings[selectedStructure.kind].cost *
                      gameData.economy.structureSellRefundBasisPoints) /
                      10_000,
                  )}{" "}
                  cr
                </button>
              )}
            </>
          ) : leadUnit ? (
            <dl className="asset-stats">
              <div>
                <dt>FORMATION</dt>
                <dd>{selectedUnits.length}</dd>
              </div>
              <div>
                <dt>INTEGRITY</dt>
                <dd>
                  {selectedUnits.reduce((sum, unit) => sum + unit.health, 0)}
                </dd>
              </div>
              <div>
                <dt>ORDERS</dt>
                <dd>{leadUnit.order.toUpperCase()}</dd>
              </div>
              {leadUnit.kind === "midasHarvester" && (
                <div>
                  <dt>CARGO</dt>
                  <dd>
                    {leadUnit.cargo}/{leadUnit.cargoCapacity}
                  </dd>
                </div>
              )}
            </dl>
          ) : (
            <p className="empty-state">
              Select one of your Gold units or structures.
            </p>
          )}

          <article className={`solar-panel ${solarTargeting ? "active" : ""}`}>
            <div>
              <span>SOLAR SPEAR // {solar.state.toUpperCase()}</span>
              <strong>
                {solar.state === "charging"
                  ? `${solarProgress}% CHARGED`
                  : solar.state === "ready"
                    ? "TARGETING AVAILABLE"
                    : solar.state === "warning"
                      ? "LAUNCH COMMITTED"
                      : "POWERED ORACLE REQUIRED"}
              </strong>
            </div>
            <div className="solar-meter">
              <i style={{ width: `${solarProgress}%` }} />
            </div>
            <button
              disabled={solar.state !== "ready"}
              className={solarTargeting ? "active" : ""}
              onClick={toggleSolarTargeting}
            >
              {solarTargeting ? "Cancel target mode" : "Arm Solar Spear"}
            </button>
            {solarTargeting && (
              <p>Select visible ground in the battlefield to launch.</p>
            )}
            {simulation.lastSolarFailure && (
              <p className="placement-error">
                {SOLAR_MESSAGES[simulation.lastSolarFailure]}
              </p>
            )}
          </article>
        </section>

        <aside className="controls">
          <p>
            <kbd>Drag / Shift</kbd> select · <kbd>Right click</kbd> move,
            attack, or place
          </p>
          <p>
            <kbd>F + right click</kbd> attack-move · <kbd>Ctrl+1–3</kbd>{" "}
            control group
          </p>
          <div className="control-buttons">
            <button onClick={() => runtimeRef.current?.enqueue({ kind: "stop" })}>
              Stop [X]
            </button>
            <button onClick={() => runtimeRef.current?.enqueue({ kind: "hold" })}>
              Hold [H]
            </button>
            <button onClick={() => runtimeRef.current?.centerCamera()}>
              Recenter
            </button>
            <button
              onClick={() => adjustCameraZoom(-1)}
            >
              Zoom −
            </button>
            <button
              onClick={() => adjustCameraZoom(1)}
            >
              Zoom +
            </button>
          </div>
          <dl className="mini-telemetry">
            <div>
              <dt>TICK</dt>
              <dd>{simulation.tick}</dd>
            </div>
            <div>
              <dt>FORCES</dt>
              <dd>
                {simulation.units.filter((unit) => unit.playerId === side).length}
                U /{" "}
                {
                  simulation.structures.filter(
                    (structure) => structure.playerId === side,
                  ).length
                }
                B
              </dd>
            </div>
            <div>
              <dt>LINK</dt>
              <dd>{snapshot.renderer}</dd>
            </div>
            <div>
              <dt>AUDIO</dt>
              <dd>{snapshot.audioReady ? "ONLINE" : "INTERACT TO ARM"}</dd>
            </div>
            <div>
              <dt>INTEL</dt>
              <dd>{visibleEnemies} CONTACTS</dd>
            </div>
            <div>
              <dt>OPPOSITION</dt>
              <dd>{simulation.ai.profile.toUpperCase()}</dd>
            </div>
            <div>
              <dt>EXPLORED</dt>
              <dd>
                {simulation.visibility.tiles.length === 0
                  ? 0
                  : Math.floor(
                      (100 * exploredTiles) /
                        simulation.visibility.tiles.length,
                    )}
                %
              </dd>
            </div>
          </dl>
        </aside>
        </section>
      )}
    </main>
  );
}
