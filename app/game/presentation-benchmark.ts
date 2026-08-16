import type { SimulationSnapshot, UnitSnapshot } from "./types";

export const PRESENTATION_BENCHMARK_UNIT_COUNTS = Object.freeze([
  600,
  1_000,
] as const);

export function presentationBenchmarkUnitCount(search: string) {
  const value = new URLSearchParams(search).get("presentationBenchmarkUnits");
  const unitCount = Number(value);
  return PRESENTATION_BENCHMARK_UNIT_COUNTS.includes(
    unitCount as (typeof PRESENTATION_BENCHMARK_UNIT_COUNTS)[number],
  )
    ? unitCount
    : null;
}

function benchmarkPosition(index: number, unitCount: number) {
  const columns = unitCount <= 600 ? 30 : 40;
  const column = index % columns;
  const row = Math.floor(index / columns);
  return Object.freeze({
    x: Math.round((10 + column * 0.35) * 1_000),
    y: Math.round((10 + row * 0.35) * 1_000),
  });
}

export function createPresentationBenchmarkSnapshot(
  snapshot: SimulationSnapshot,
  unitCount: number,
): SimulationSnapshot {
  if (snapshot.units.length === 0) {
    throw new Error("Presentation benchmark requires at least one source unit.");
  }
  if (!PRESENTATION_BENCHMARK_UNIT_COUNTS.includes(
    unitCount as (typeof PRESENTATION_BENCHMARK_UNIT_COUNTS)[number],
  )) {
    throw new Error(`Unsupported presentation benchmark count ${unitCount}.`);
  }

  const units = Object.freeze(
    Array.from({ length: unitCount }, (_, index): UnitSnapshot => {
      const source = snapshot.units[index % snapshot.units.length];
      return Object.freeze({
        ...source,
        id: index + 1,
        callsign: `Presentation benchmark ${index + 1}`,
        playerId: index % 2 === 0 ? 1 : 2,
        formationId: 0,
        position: benchmarkPosition(index, unitCount),
        destination: null,
        selected: false,
        order: "hold",
        pathingState: "idle",
        path: Object.freeze([]),
        targetId: null,
        targetStructureId: null,
      });
    }),
  );

  return Object.freeze({
    ...snapshot,
    units,
    selectedUnitIds: Object.freeze([]),
  });
}
