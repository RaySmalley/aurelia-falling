"use client";

import { useEffect, useRef, useState } from "react";
import { gameData } from "../game/data";
import type {
  BuildingKind,
  GameRuntime,
  PlayerId,
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

const INITIAL_SNAPSHOT: RuntimeSnapshot = {
  simulation: {
    tick: 0,
    scenario: "economy",
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
  },
  paused: false,
  pauseReason: null,
  audioReady: false,
  renderer: "initializing",
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
  outsideBuildRadius: "Site is outside connected construction radius.",
  missingPrerequisite: "Build-tree prerequisite is missing.",
  insufficientCredits: "Insufficient credits.",
  citadelUnique: "Each side may field only one Citadel.",
} as const;

export default function EconomySandboxShell() {
  const hostRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<GameRuntime | null>(null);
  const [snapshot, setSnapshot] = useState(INITIAL_SNAPSHOT);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [placement, setPlacement] = useState<BuildingKind | null>(null);

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

  const simulation = snapshot.simulation;
  const side = simulation.controlledPlayer;
  const player = simulation.players[side];
  const selectedUnits = simulation.units.filter((unit) => unit.selected);
  const selectedStructure =
    simulation.structures.find((structure) => structure.selected) ?? null;
  const leadUnit = selectedUnits[0] ?? null;
  const placementFailure = simulation.lastPlacementFailure;

  const beginPlacement = (kind: BuildingKind) => {
    const next = placement === kind ? null : kind;
    setPlacement(next);
    runtimeRef.current?.beginPlacement(next);
  };

  const switchSide = (playerId: PlayerId) => {
    setPlacement(null);
    runtimeRef.current?.beginPlacement(null);
    runtimeRef.current?.enqueue({ kind: "switchPlayer", playerId });
  };

  const queueUnit = (unitKind: UnitKind) => {
    if (!selectedStructure) return;
    runtimeRef.current?.enqueue({
      kind: "queueUnit",
      structureId: selectedStructure.id,
      unitKind,
    });
  };

  return (
    <main className="operations-shell economy-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">ARCLIGHT COMMAND // GOLDEN SCAR ECONOMY TEST</p>
          <h1>Aurelia Falling</h1>
        </div>
        <div className="resource-bar" aria-label="Economy status">
          <div>
            <span>CREDITS</span>
            <strong>{player.credits.toLocaleString()}</strong>
          </div>
          <div className={player.lowPower ? "warning" : ""}>
            <span>POWER</span>
            <strong>
              {player.powerGenerated} / {player.powerConsumed}
            </strong>
          </div>
          <button
            onClick={() => switchSide(side === 1 ? 2 : 1)}
            title="Switch local debug control"
          >
            Control {side === 1 ? "Cyan" : "Gold"}
          </button>
        </div>
        <div className="phase-badge">
          <span>PHASE 3</span>
          <strong>{side === 1 ? "GOLD" : "CYAN"} OPERATOR</strong>
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
            <h2>Base simulation paused</h2>
            <span>
              Background time was discarded. Resume explicitly to continue the
              deterministic fixed-step economy.
            </span>
            <button onClick={() => runtimeRef.current?.resume()}>
              Resume operation
            </button>
          </div>
        )}
        {!snapshot.paused && simulation.status !== "active" && (
          <div className="pause-curtain match-result">
            <p>CITADEL SIGNAL LOST</p>
            <h2>
              {simulation.status === "draw"
                ? "Both Citadels destroyed"
                : `${simulation.winner === 1 ? "Gold" : "Cyan"} controls Aurelia`}
            </h2>
            <span>Final assault resolved at tick {simulation.tick}.</span>
            <button
              onClick={() =>
                runtimeRef.current?.enqueue({ kind: "restartEconomy" })
              }
            >
              Restart economy sandbox
            </button>
          </div>
        )}
      </section>

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
              ? `Right-click to place ${gameData.buildings[placement].displayName}. Invalid sites keep placement active; click the active build button to cancel.`
              : "Choose a structure, then right-click inside a connected radius."}
          </p>
          {placementFailure && (
            <p className="placement-error" role="status">
              {PLACEMENT_MESSAGES[placementFailure]}
            </p>
          )}
        </aside>

        <section className="selection-panel">
          <div className="panel-heading">
            <p className="eyebrow">SELECTED ASSET</p>
            <h2>
              {selectedStructure?.displayName ??
                leadUnit?.displayName ??
                "No asset selected"}
            </h2>
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
              Select units or a structure belonging to the active operator.
            </p>
          )}
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
          </dl>
        </aside>
      </section>
    </main>
  );
}
