import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cpus, totalmem } from "node:os";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const BENCHMARK_SCENARIOS = [
  "idle-armies",
  "formation-move",
  "direct-attack",
];

const parseInteger = (value, option, allowZero = false) => {
  const normalized = String(value).trim();
  if (!/^\d+$/.test(normalized)) {
    throw new Error(
      `${option} must be ${allowZero ? "a non-negative" : "a positive"} integer`,
    );
  }
  const parsed = Number(normalized);
  if (
    !Number.isSafeInteger(parsed) ||
    (allowZero ? parsed < 0 : parsed <= 0)
  ) {
    throw new Error(
      `${option} must be ${allowZero ? "a non-negative" : "a positive"} integer`,
    );
  }
  return parsed;
};

const parsePositiveNumber = (value, option) => {
  const parsed = Number(String(value).trim());
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${option} must be a positive number`);
  }
  return parsed;
};

export const parseArguments = (argv) => {
  const options = {
    counts: [100, 300, 600, 1_000],
    maxTargetedWorstMs: 25,
    measuredTicks: 50,
    output: null,
    scenarios: ["idle-armies"],
    seed: 10_001,
    targetedUnitCount: 200,
    warmupTicks: 10,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    const value = argv[index + 1];
    if (option === "--counts" && value) {
      options.counts = value
        .split(",")
        .map((count) => parseInteger(count, option));
      index += 1;
    } else if (option === "--scenarios" && value) {
      options.scenarios = value.split(",");
      if (
        options.scenarios.length === 0 ||
        options.scenarios.some(
          (scenario) => !BENCHMARK_SCENARIOS.includes(scenario),
        )
      ) {
        throw new Error(
          `${option} must contain only: ${BENCHMARK_SCENARIOS.join(", ")}`,
        );
      }
      index += 1;
    } else if (option === "--targeted-count" && value) {
      options.targetedUnitCount = parseInteger(value, option);
      index += 1;
    } else if (option === "--max-targeted-worst-ms" && value) {
      options.maxTargetedWorstMs = parsePositiveNumber(value, option);
      index += 1;
    } else if (option === "--ticks" && value) {
      options.measuredTicks = parseInteger(value, option);
      index += 1;
    } else if (option === "--warmup" && value) {
      options.warmupTicks = parseInteger(value, option, true);
      index += 1;
    } else if (option === "--seed" && value) {
      options.seed = parseInteger(value, option, true);
      index += 1;
    } else if (option === "--output" && value) {
      options.output = resolve(root, value);
      index += 1;
    } else {
      throw new Error(`Unknown or incomplete option: ${option}`);
    }
  }

  return options;
};

const percentile = (sorted, percentileValue) => {
  const index = Math.max(
    0,
    Math.ceil((percentileValue / 100) * sorted.length) - 1,
  );
  return sorted[index];
};

const summarize = (samples) => {
  const sorted = samples.slice().sort((left, right) => left - right);
  return {
    p50Ms: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
    p99Ms: percentile(sorted, 99),
    worstMs: sorted.at(-1),
  };
};

const roundedSummary = (samples) => ({
  sampleCount: samples.length,
  ...Object.fromEntries(
    Object.entries(summarize(samples)).map(([key, value]) => [
      key,
      Number(value.toFixed(6)),
    ]),
  ),
});

const revision = () => {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return process.env.GITHUB_SHA ?? "unknown";
  }
};

const workingTreeDirty = () => {
  try {
    return (
      execFileSync("git", ["status", "--porcelain"], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim().length > 0
    );
  } catch {
    return null;
  }
};

const createIdleArmy = (simulation, unitCount) => {
  const kinds = [
    "midasHarvester",
    "argusRifle",
    "cyclopsRocket",
    "hermesScout",
    "atlasTank",
    "gorgonWalker",
  ];
  simulation.units = Array.from({ length: unitCount }, (_, index) => {
    const id = index + 1;
    const playerId = index % 2 === 0 ? 1 : 2;
    const tile = {
      x: 4 + (index % 56),
      y: 4 + (Math.floor(index / 56) % 56),
    };
    const unit = simulation.createUnitState(
      id,
      playerId,
      kinds[index % kinds.length],
      tile,
      `Benchmark ${id}`,
    );
    unit.order = "hold";
    return unit;
  });
  simulation.nextUnitId = unitCount + 1;
  simulation.rebuildEntityIndexes();
  simulation.updateVisibility(true);
};

const createPathfindingArmy = (simulation, unitCount) => {
  const attackers = Array.from({ length: unitCount }, (_, index) =>
    simulation.createUnitState(
      index + 1,
      1,
      "argusRifle",
      {
        x: 4 + (index % 10),
        y: 4 + Math.floor(index / 10),
      },
      `Pathfinder ${index + 1}`,
    ),
  );
  for (const unit of attackers) unit.order = "hold";
  const target = simulation.createUnitState(
    unitCount + 1,
    2,
    "gorgonWalker",
    { x: 58, y: 58 },
    "Chase Target",
  );
  target.order = "hold";
  simulation.units = [...attackers, target];
  simulation.structures = [];
  simulation.fields = [];
  simulation.nextUnitId = simulation.units.length + 1;
  simulation.rebuildEntityIndexes();
  simulation.updateVisibility(true);
  return { attackers, target };
};

const prepareWorkload = (Simulation, scenario, seed, unitCount) => {
  if (scenario === "idle-armies") {
    const simulation = new Simulation(seed, "combat");
    createIdleArmy(simulation, unitCount);
    return {
      commandStream: "none",
      enqueue: () => {},
      prepareDrain: () => {},
      simulation,
    };
  }

  const simulation = new Simulation(seed, "combat");
  const { attackers, target } = createPathfindingArmy(
    simulation,
    unitCount,
  );
  return {
    commandStream:
      scenario === "formation-move"
        ? `select ${unitCount}; move formation`
        : `select ${unitCount}; attack unit`,
    enqueue() {
      simulation.enqueue({
        kind: "selectUnits",
        unitIds: attackers.map((unit) => unit.id),
        additive: false,
      });
      simulation.enqueue(
        scenario === "formation-move"
          ? {
              kind: "move",
              target: { x: 50, y: 50 },
              mode: "move",
            }
          : {
              kind: "attackUnit",
              targetUnitId: target.id,
            },
      );
    },
    prepareDrain() {
      if (scenario !== "direct-attack") return;
      for (const unit of attackers) {
        unit.order = "hold";
        unit.targetId = null;
        unit.targetStructureId = null;
        unit.forcedTarget = false;
      }
    },
    simulation,
  };
};

const runBenchmark = (
  Simulation,
  systems,
  {
    initialCongestedBudget,
    maxPathExpansions,
    measuredTicks,
    scenario,
    seed,
    unitCount,
    warmupTicks,
  },
) => {
  const workload = prepareWorkload(
    Simulation,
    scenario,
    seed,
    unitCount,
  );
  const { simulation } = workload;

  for (let tick = 0; tick < warmupTicks; tick += 1) simulation.step();
  workload.enqueue();

  const samplesBySystem = new Map(
    systems.map((system) => [system, []]),
  );
  const startedAt = new Map();
  const elapsedBySystem = new Map();
  const commandPhasePendingRequests = [];
  const observer = {
    begin(system) {
      startedAt.set(system, performance.now());
    },
    end(system) {
      const start = startedAt.get(system);
      if (start !== undefined) {
        elapsedBySystem.set(
          system,
          (elapsedBySystem.get(system) ?? 0) + performance.now() - start,
        );
      }
      if (system === "commands") {
        commandPhasePendingRequests.push(
          simulation.pathfindingDiagnostics().pendingRequests,
        );
      }
    },
  };

  const tickSamples = [];
  const pathfindingSamples = [];
  const heapBefore = process.memoryUsage().heapUsed;
  for (let tick = 0; tick < measuredTicks; tick += 1) {
    elapsedBySystem.clear();
    const start = performance.now();
    simulation.step(observer);
    tickSamples.push(performance.now() - start);
    pathfindingSamples.push(simulation.pathfindingDiagnostics());
    for (const [system, elapsed] of elapsedBySystem) {
      samplesBySystem.get(system).push(elapsed);
    }
  }
  const heapAfter = process.memoryUsage().heapUsed;
  const measuredFinalPendingRequests =
    pathfindingSamples.at(-1)?.pendingRequests ?? 0;
  const completionTickLimit =
    scenario === "idle-armies"
      ? 0
      : (unitCount + 1) *
        Math.ceil(maxPathExpansions / initialCongestedBudget);
  let completionTicks = 0;
  workload.prepareDrain();
  while (
    simulation.pathfindingDiagnostics().pendingRequests > 0 &&
    completionTicks < completionTickLimit
  ) {
    simulation.step();
    completionTicks += 1;
  }
  const snapshotJson = JSON.stringify(simulation.snapshot());

  return {
    id:
      scenario === "idle-armies"
        ? `idle-${unitCount}`
        : `${scenario}-${unitCount}`,
    scenario,
    seed,
    commandStream: workload.commandStream,
    warmupTicks,
    measuredTicks,
    objectCounts: {
      units: simulation.units.length,
      structures: simulation.structures.length,
      projectiles: simulation.projectiles.length,
      total:
        simulation.units.length +
        simulation.structures.length +
        simulation.projectiles.length,
    },
    tickTiming: roundedSummary(tickSamples),
    systemTiming: Object.fromEntries(
      [...samplesBySystem.entries()]
        .filter(([, samples]) => samples.length > 0)
        .map(([system, samples]) => [system, roundedSummary(samples)]),
    ),
    pathfinding: {
      expansionBudget: Math.max(
        0,
        ...pathfindingSamples.map((sample) => sample.expansionBudget),
      ),
      minimumExpansionBudget: Math.min(
        ...pathfindingSamples.map((sample) => sample.expansionBudget),
      ),
      expansionBudgetBreaches: pathfindingSamples.filter(
        (sample) => sample.expansions > sample.expansionBudget,
      ).length,
      maxExpansionsPerTick: Math.max(
        0,
        ...pathfindingSamples.map((sample) => sample.expansions),
      ),
      maxPendingRequests: Math.max(
        0,
        ...pathfindingSamples.map((sample) => sample.pendingRequests),
      ),
      maxCommandPhasePendingRequests: Math.max(
        0,
        ...commandPhasePendingRequests,
      ),
      initialCommandPhasePendingRequests:
        commandPhasePendingRequests[0] ?? 0,
      measuredFinalPendingRequests,
      completionTickLimit,
      completionTicks,
      finalPendingRequests:
        simulation.pathfindingDiagnostics().pendingRequests,
    },
    allocation: {
      heapDeltaBytes: heapAfter - heapBefore,
      heapUsedBeforeBytes: heapBefore,
      heapUsedAfterBytes: heapAfter,
    },
    snapshot: {
      bytes: Buffer.byteLength(snapshotJson),
      sha256: createHash("sha256").update(snapshotJson).digest("hex"),
    },
  };
};

const evaluateTargetedGate = (result, maxWorstMs) => {
  const expectedCommandRequests =
    result.scenario === "formation-move"
      ? 1
      : result.objectCounts.units - 1;
  const checks = {
    expansionBudget:
      result.pathfinding.expansionBudgetBreaches === 0,
    requestFanout:
      result.pathfinding.initialCommandPhasePendingRequests ===
      expectedCommandRequests,
    boundedCompletion:
      result.pathfinding.finalPendingRequests === 0 &&
      result.pathfinding.completionTicks <=
        result.pathfinding.completionTickLimit,
    worstTick: result.tickTiming.worstMs <= maxWorstMs,
  };
  return {
    id: result.id,
    maxWorstMs,
    checks,
    passed: Object.values(checks).every(Boolean),
  };
};

const main = async () => {
  const options = parseArguments(process.argv.slice(2));
  const vite = await createServer({
    root,
    configFile: false,
    logLevel: "silent",
    server: { middlewareMode: true },
  });

  try {
    const simulationModule = await vite.ssrLoadModule(
      "/app/game/simulation.ts",
    );
    const pathfindingModule = await vite.ssrLoadModule(
      "/app/game/pathfinding.ts",
    );
    const results = [];
    for (const scenario of options.scenarios) {
      const counts =
        scenario === "idle-armies"
          ? options.counts
          : [options.targetedUnitCount];
      for (const unitCount of counts) {
        results.push(
          runBenchmark(
            simulationModule.Simulation,
            simulationModule.SIMULATION_SYSTEMS,
            {
              ...options,
              initialCongestedBudget:
                simulationModule
                  .INITIAL_CONGESTED_PATH_EXPANSIONS_PER_TICK,
              maxPathExpansions:
                pathfindingModule.MAX_PATH_EXPANSIONS,
              scenario,
              unitCount,
            },
          ),
        );
      }
    }
    const targetedGates = results
      .filter((result) => result.scenario !== "idle-armies")
      .map((result) =>
        evaluateTargetedGate(result, options.maxTargetedWorstMs),
      );
    const cpu = cpus()[0];
    const report = {
      schemaVersion: 2,
      recordedAt: new Date().toISOString(),
      revision: revision(),
      workingTreeDirty: workingTreeDirty(),
      runtime: {
        node: process.version,
        platform: process.platform,
        architecture: process.arch,
        osRelease: process.getBuiltinModule("node:os").release(),
        cpu: cpu?.model ?? "unknown",
        logicalCpuCount: cpus().length,
        totalMemoryBytes: totalmem(),
        buildMode: process.env.NODE_ENV ?? "benchmark",
      },
      benchmark: {
        simulationRateHz: 20,
        scenarios: options.scenarios,
        counts: options.counts,
        targetedUnitCount: options.targetedUnitCount,
        maxTargetedWorstMs: options.maxTargetedWorstMs,
        warmupTicks: options.warmupTicks,
        measuredTicks: options.measuredTicks,
      },
      results,
      gates: {
        passed: targetedGates.every((gate) => gate.passed),
        targeted: targetedGates,
      },
    };
    const serialized = `${JSON.stringify(report, null, 2)}\n`;

    if (options.output) {
      await mkdir(dirname(options.output), { recursive: true });
      await writeFile(options.output, serialized, "utf8");
    }
    process.stdout.write(serialized);
    if (!report.gates.passed) {
      process.stderr.write(
        `Targeted benchmark gate failed: ${targetedGates
          .filter((gate) => !gate.passed)
          .map((gate) => gate.id)
          .join(", ")}\n`,
      );
      process.exitCode = 1;
    }
  } finally {
    await vite.close();
  }
};

if (resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
