import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cpus, totalmem } from "node:os";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));

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

export const parseArguments = (argv) => {
  const options = {
    counts: [100, 300, 600, 1_000],
    measuredTicks: 50,
    output: null,
    seed: 10_001,
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

const roundedSummary = (samples) =>
  Object.fromEntries(
    Object.entries(summarize(samples)).map(([key, value]) => [
      key,
      Number(value.toFixed(6)),
    ]),
  );

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
  simulation.updateVisibility(true);
};

const runBenchmark = (
  Simulation,
  systems,
  { measuredTicks, seed, unitCount, warmupTicks },
) => {
  const simulation = new Simulation(seed, "combat");
  createIdleArmy(simulation, unitCount);

  for (let tick = 0; tick < warmupTicks; tick += 1) simulation.step();

  const samplesBySystem = new Map(
    systems.map((system) => [system, []]),
  );
  const startedAt = new Map();
  const observer = {
    begin(system) {
      startedAt.set(system, performance.now());
    },
    end(system) {
      const start = startedAt.get(system);
      if (start !== undefined) {
        samplesBySystem.get(system).push(performance.now() - start);
      }
    },
  };

  const tickSamples = [];
  const heapBefore = process.memoryUsage().heapUsed;
  for (let tick = 0; tick < measuredTicks; tick += 1) {
    const start = performance.now();
    simulation.step(observer);
    tickSamples.push(performance.now() - start);
  }
  const heapAfter = process.memoryUsage().heapUsed;
  const snapshotJson = JSON.stringify(simulation.snapshot());

  return {
    id: `idle-${unitCount}`,
    scenario: "idle-armies",
    seed,
    commandStream: "none",
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
    const results = options.counts.map((unitCount) =>
      runBenchmark(
        simulationModule.Simulation,
        simulationModule.SIMULATION_SYSTEMS,
        { ...options, unitCount },
      ),
    );
    const cpu = cpus()[0];
    const report = {
      schemaVersion: 1,
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
        scenario: "idle-armies",
        counts: options.counts,
        warmupTicks: options.warmupTicks,
        measuredTicks: options.measuredTicks,
      },
      results,
    };
    const serialized = `${JSON.stringify(report, null, 2)}\n`;

    if (options.output) {
      await mkdir(dirname(options.output), { recursive: true });
      await writeFile(options.output, serialized, "utf8");
    }
    process.stdout.write(serialized);
  } finally {
    await vite.close();
  }
};

if (resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
