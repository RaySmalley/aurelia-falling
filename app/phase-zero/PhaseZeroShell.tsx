"use client";

import { useEffect, useRef, useState } from "react";
import type { GameRuntime, RuntimeSnapshot } from "../game/types";

const INITIAL_SNAPSHOT: RuntimeSnapshot = {
  simulation: {
    tick: 0,
    unit: {
      id: "pathfinder-01",
      position: { x: 6, y: 7 },
      destination: null,
      selected: false,
    },
  },
  paused: false,
  pauseReason: null,
  audioReady: false,
  renderer: "initializing",
};

export default function PhaseZeroShell() {
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

  const unit = snapshot.simulation.unit;
  const position = `${unit.position.x.toFixed(1)}, ${unit.position.y.toFixed(1)}`;

  return (
    <main className="operations-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">ARCLIGHT COMMAND // FRAMEWORK TRIAL</p>
          <h1>Aurelia Falling</h1>
        </div>
        <div className="phase-badge">
          <span>PHASE 0</span>
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
            <h2>Operation paused</h2>
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
          <div className="unit-glyph">P-01</div>
          <div>
            <p className="eyebrow">SELECTED ELEMENT</p>
            <h2>{unit.selected ? "Pathfinder 01" : "No unit selected"}</h2>
            <span>
              {unit.selected
                ? unit.destination
                  ? "Executing move order"
                  : "Awaiting command"
                : "Left-click the amber unit"}
            </span>
          </div>
        </div>

        <dl className="telemetry">
          <div>
            <dt>SIM TICK</dt>
            <dd>{snapshot.simulation.tick}</dd>
          </div>
          <div>
            <dt>GRID</dt>
            <dd>{position}</dd>
          </div>
          <div>
            <dt>RENDER</dt>
            <dd>{snapshot.renderer}</dd>
          </div>
          <div>
            <dt>AUDIO</dt>
            <dd>{snapshot.audioReady ? "Unlocked" : "Standby"}</dd>
          </div>
        </dl>

        <div className="controls">
          <p>
            <kbd>Left click</kbd> select · <kbd>Right click</kbd> move
          </p>
          <p>
            <kbd>WASD</kbd> / <kbd>Arrows</kbd> pan camera
          </p>
          <button onClick={() => runtimeRef.current?.centerCamera()}>
            Recenter tactical view
          </button>
        </div>
      </section>
    </main>
  );
}
