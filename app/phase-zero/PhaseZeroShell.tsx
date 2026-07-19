"use client";

import { useEffect, useRef, useState } from "react";
import type { GameRuntime, RuntimeSnapshot } from "../game/types";

const INITIAL_SNAPSHOT: RuntimeSnapshot = {
  simulation: {
    tick: 0,
    units: [],
    selectedUnitIds: [],
    rallies: [],
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
  const gridPosition = leadUnit
    ? `${(leadUnit.position.x / 1_000).toFixed(1)}, ${(leadUnit.position.y / 1_000).toFixed(1)}`
    : "—";
  const movingUnits = snapshot.simulation.units.filter(
    (unit) => unit.order === "move" || unit.order === "attackMove",
  ).length;

  return (
    <main className="operations-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">ARCLIGHT COMMAND // GOLDEN SCAR EXERCISE</p>
          <h1>Aurelia Falling</h1>
        </div>
        <div className="phase-badge">
          <span>PHASE 1</span>
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
            <h2>Movement exercise paused</h2>
            <span>
              Simulation time was discarded while this tab was hidden. Resume
              manually when ready.
            </span>
            <button onClick={() => runtimeRef.current?.resume()}>
              Resume operation
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
            <p className="eyebrow">SELECTED FORMATION</p>
            <h2>
              {selectedUnits.length > 0
                ? `${selectedUnits.length} Meridian units`
                : "No units selected"}
            </h2>
            <span>
              {leadUnit
                ? `${leadUnit.callsign} // ${leadUnit.order.toUpperCase()}`
                : "Drag a selection box over either formation"}
            </span>
          </div>
        </div>

        <dl className="telemetry">
          <div>
            <dt>SIM TICK</dt>
            <dd>{snapshot.simulation.tick}</dd>
          </div>
          <div>
            <dt>LEAD GRID</dt>
            <dd>{gridPosition}</dd>
          </div>
          <div>
            <dt>IN MOTION</dt>
            <dd>
              {movingUnits}/{snapshot.simulation.units.length}
            </dd>
          </div>
          <div>
            <dt>LINK</dt>
            <dd>{snapshot.renderer}</dd>
          </div>
        </dl>

        <div className="controls">
          <p>
            <kbd>Drag / Shift</kbd> select · <kbd>Right click</kbd> move
          </p>
          <p>
            <kbd>F</kbd> attack-move · <kbd>R</kbd> rally ·{" "}
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
