import type {
  SimulationRenderFrame,
  SimulationSnapshot,
  SimulationUiSnapshot,
} from "./types";

export function toSimulationRenderFrame(
  snapshot: SimulationSnapshot,
): SimulationRenderFrame {
  const { units: _units, structures: _structures, ...frame } = snapshot;
  void [_units, _structures];
  return Object.freeze(frame);
}

export function toSimulationUiSnapshot(
  snapshot: SimulationSnapshot,
): SimulationUiSnapshot {
  const side = snapshot.controlledPlayer;
  let selectedUnitCount = 0;
  let selectedUnitTotalHealth = 0;
  let leadUnit = null;
  let friendlyUnitCount = 0;
  let visibleEnemyUnitCount = 0;
  for (const unit of snapshot.units) {
    if (unit.playerId === side) friendlyUnitCount += 1;
    else visibleEnemyUnitCount += 1;
    if (!unit.selected) continue;
    selectedUnitCount += 1;
    selectedUnitTotalHealth += unit.health;
    leadUnit ??= unit;
  }
  let selectedStructure = null;
  let friendlyStructureCount = 0;
  let visibleEnemyStructureCount = 0;
  for (const structure of snapshot.structures) {
    if (structure.playerId === side) friendlyStructureCount += 1;
    else visibleEnemyStructureCount += 1;
    if (structure.selected) selectedStructure ??= structure;
  }
  return Object.freeze({
    tick: snapshot.tick,
    scenario: snapshot.scenario,
    controlledPlayer: side,
    players: snapshot.players,
    selectedUnitCount,
    selectedUnitTotalHealth,
    leadUnit: leadUnit
      ? (({ path: _path, ...unit }) => {
          void _path;
          return Object.freeze(unit);
        })(leadUnit)
      : null,
    selectedStructure,
    friendlyUnitCount,
    friendlyStructureCount,
    visibleEnemyCount:
      visibleEnemyUnitCount + visibleEnemyStructureCount,
    exploredTileCount: snapshot.visibility.tiles.filter((level) => level > 0)
      .length,
    visibilityTileCount: snapshot.visibility.tiles.length,
    status: snapshot.status,
    winner: snapshot.winner,
    kills: snapshot.kills,
    seed: snapshot.seed,
    lastPlacementFailure: snapshot.lastPlacementFailure,
    lastSolarFailure: snapshot.lastSolarFailure,
    ai: snapshot.ai,
    solarSpears: snapshot.solarSpears,
    onboarding: snapshot.onboarding,
  });
}
