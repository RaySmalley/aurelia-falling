"use client";

import { useEffect, useRef, useState } from "react";
import type { GameRuntime, RuntimeSnapshot } from "../game/types";

const INITIAL_SNAPSHOT: RuntimeSnapshot = {
  simulation: {
    tick: 0,
    units: [],
    projectiles: [],
    selectedUnitIds: [],
    rallies: [],
    status: "active",
    winner: null,
    kills: { 1: 0, 2: 0 },
    seed: 0,
  },
  paused: false,
  pauseReason: null,
  audioReady: false,
  renderer: "initializing",
};

export default function MovementSandboxShell() {
  const hostRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<GameRuntime | null>(null);
  const [snapshot, setSnapshot] = useState(INITIAL_SNAPSHOT);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let unsubscribe = () => {};

    async function start() {
      try {
        const { createGameRuntime } = await import("../game/bootstrap");
        if (!hostRef.current || disposed) return;
        const runtime = await createGameRuntime(hostRef.current);
        if (disposed) {
          runtime.destroy();
          return;
        }
        runtimeRef.current = runtime;
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
  }, []);

  useEffect(() => {
    const unlock = () => void runtimeRef.current?.unlockAudio();
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  const selectedUnits = snapshot.simulation.units.filter(
    (unit) => unit.selected,
  );
  const leadUnit = selectedUnits[0] ?? null;
  const movingUnits = snapshot.simulation.units.filter(
    (unit) => unit.order === "move" || unit.order === "attackMove",
  ).length;
  const playerUnits = snapshot.simulation.units.filter(
    (unit) => unit.playerId === 1,
  ).length;
  const enemyUnits = snapshot.simulation.units.filter(
    (unit) => unit.playerId === 2,
  ).length;
  const selectedHealth = selectedUnits.reduce(
    (total, unit) => total + unit.health,
    0,
  );
  const selectedMaxHealth = selectedUnits.reduce(
    (total, unit) => total + unit.maxHealth,
    0,
  );

  return (
    <main className="operations-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">ARCLIGHT COMMAND // GOLDEN SCAR ENGAGEMENT</p>
          <h1>Aurelia Falling</h1>
        </div>
        <div className="phase-badge">
          <span>PHASE 2</span>
          <strong>LINK {loadError ? "FAULT" : "STABLE"}</strong>
        </div>
      </header>

      <section className="battlefield-frame" aria-label="RTS battlefield">
        <div ref={hostRef} className="game-host" />
        {loadError && (
          <div className="fatal-panel" role="alert">
            <strong>Simulation link failed</strong>
            <span>{loadError}</span>
          </div>
        )}
        {snapshot.paused && (
          <div className="pause-curtain">
            <p>TACTICAL LINK SUSPENDED</p>
            <h2>Combat exercise paused</h2>
            <span>
              Simulation time was discarded while this tab was hidden. Resume
              manually when ready.
            </span>
            <button onClick={() => runtimeRef.current?.resume()}>
              Resume operation
            </button>
          </div>
        )}
        {!snapshot.paused && snapshot.simulation.status !== "active" && (
          <div className="pause-curtain match-result">
            <p>COMBAT SIMULATION COMPLETE</p>
            <h2>
              {snapshot.simulation.status === "victory"
                ? "Meridian Gold victorious"
                : snapshot.simulation.status === "defeat"
                  ? "Meridian Gold defeated"
                  : "Mutual destruction"}
            </h2>
            <span>
              Final tally {snapshot.simulation.kills[1]}–
              {snapshot.simulation.kills[2]} at tick{" "}
              {snapshot.simulation.tick}.
            </span>
            <button
              onClick={() =>
                runtimeRef.current?.enqueue({ kind: "restartCombat" })
              }
            >
              Restart seeded battle
            </button>
          </div>
        )}
      </section>

      <section className="command-deck" aria-label="Command HUD">
        <div className="unit-card">
          <div className="unit-glyph">
            {selectedUnits.length > 0 ? selectedUnits.length : "—"}
          </div>
          <div>
            <p className="eyebrow">SELECTED COMBAT GROUP</p>
            <h2>
              {selectedUnits.length > 0
                ? selectedUnits.length === 1
                  ? leadUnit?.displayName
                  : `${selectedUnits.length} Meridian units`
                : "No units selected"}
            </h2>
            <span>
              {leadUnit
                ? `${leadUnit.callsign} // ${leadUnit.order.toUpperCase()} // ${selectedHealth}/${selectedMaxHealth} HP`
                : "Drag over Gold units, then attack-move toward Cyan"}
            </span>
          </div>
        </div>

        <dl className="telemetry">
          <div>
            <dt>SIM TICK</dt>
            <dd>{snapshot.simulation.tick}</dd>
          </div>
          <div>
            <dt>ARMIES</dt>
            <dd>
              {playerUnits}G / {enemyUnits}C
            </dd>
          </div>
          <div>
            <dt>ORDNANCE</dt>
            <dd>
              {snapshot.simulation.projectiles.length} / {movingUnits} MV
            </dd>
          </div>
          <div>
            <dt>LINK</dt>
            <dd>{snapshot.renderer}</dd>
          </div>
        </dl>

        <div className="controls">
          <p>
            <kbd>Drag / Shift</kbd> select Gold · <kbd>Right click enemy</kbd>{" "}
            focus fire
          </p>
          <p>
            <kbd>F + right click</kbd> attack-move · <kbd>R</kbd> rally ·{" "}
            <kbd>Ctrl+1–3</kbd> group
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
          </div>
        </div>
      </section>
    </main>
  );
}
