import { execFileSync } from "node:child_process";
import { cpus, totalmem } from "node:os";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";

const root = fileURLToPath(new URL("..", import.meta.url));
const workerEntry = new URL(
  "./fixtures/simulation-worker-benchmark-thread.mjs",
  import.meta.url,
);
const ACCEPTANCE_PROFILE = Object.freeze({
  maxTickMs: 50,
  measuredTicks: 100,
  snapshotCadenceTicks: 2,
  unitCount: 600,
  warmupTicks: 20,
});

const parseInteger = (value, option, allowZero = false) => {
  const normalized = String(value).trim();
  if (!/^\d+$/.test(normalized)) {
    throw new Error(
      `${option} must be ${allowZero ? "a non-negative" : "a positive"} integer`,
    );
  }
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || (allowZero ? parsed < 0 : parsed <= 0)) {
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
    maxTickMs: ACCEPTANCE_PROFILE.maxTickMs,
    measuredTicks: ACCEPTANCE_PROFILE.measuredTicks,
    output: null,
    seed: 12_600,
    snapshotCadenceTicks: ACCEPTANCE_PROFILE.snapshotCadenceTicks,
    unitCount: ACCEPTANCE_PROFILE.unitCount,
    warmupTicks: ACCEPTANCE_PROFILE.warmupTicks,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    const value = argv[index + 1];
    if (option === "--units" && value) {
      options.unitCount = parseInteger(value, option);
    } else if (option === "--ticks" && value) {
      options.measuredTicks = parseInteger(value, option);
    } else if (option === "--warmup" && value) {
      options.warmupTicks = parseInteger(value, option, true);
    } else if (option === "--seed" && value) {
      options.seed = parseInteger(value, option, true);
    } else if (option === "--snapshot-cadence" && value) {
      options.snapshotCadenceTicks = parseInteger(value, option);
    } else if (option === "--max-tick-ms" && value) {
      options.maxTickMs = parsePositiveNumber(value, option);
    } else if (option === "--output" && value) {
      options.output = resolve(root, value);
    } else {
      throw new Error(`Unknown or incomplete option: ${option}`);
    }
    index += 1;
  }

  return options;
};

export const evaluateAcceptanceGate = (options, result, tickTiming) => {
  const acceptanceRun = Object.entries(ACCEPTANCE_PROFILE).every(
    ([key, value]) => options[key] === value,
  );
  if (!acceptanceRun) {
    return {
      mode: "diagnostic",
      acceptanceProfile: ACCEPTANCE_PROFILE,
      checks: null,
      passed: null,
    };
  }

  const checks = {
    unitCount: result.unitCount === ACCEPTANCE_PROFILE.unitCount,
    completedTicks:
      result.completedTicks === ACCEPTANCE_PROFILE.measuredTicks,
    snapshotCadence:
      result.snapshotCount ===
      ACCEPTANCE_PROFILE.measuredTicks /
        ACCEPTANCE_PROFILE.snapshotCadenceTicks,
    tickBudget: tickTiming.worstMs <= ACCEPTANCE_PROFILE.maxTickMs,
    fixedCadence: result.missedDeadlines === 0,
  };
  return {
    mode: "acceptance",
    acceptanceProfile: ACCEPTANCE_PROFILE,
    checks,
    passed: Object.values(checks).every(Boolean),
  };
};

const percentile = (sorted, value) =>
  sorted[Math.max(0, Math.ceil((value / 100) * sorted.length) - 1)];

const summarize = (samples) => {
  const sorted = samples.slice().sort((left, right) => left - right);
  return {
    sampleCount: samples.length,
    p50Ms: Number(percentile(sorted, 50).toFixed(6)),
    p95Ms: Number(percentile(sorted, 95).toFixed(6)),
    p99Ms: Number(percentile(sorted, 99).toFixed(6)),
    worstMs: Number(sorted.at(-1).toFixed(6)),
  };
};

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
    return execFileSync("git", ["status", "--porcelain"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim().length > 0;
  } catch {
    return null;
  }
};

const runWorker = (options) =>
  new Promise((resolveResult, reject) => {
    const worker = new Worker(workerEntry, {
      workerData: { root, ...options, output: undefined },
    });
    const timeout = setTimeout(
      () => {
        void worker.terminate();
        reject(new Error("Timed out waiting for the worker benchmark."));
      },
      options.measuredTicks * 50 + 30_000,
    );

    worker.on("message", (message) => {
      if (message?.type === "result") {
        clearTimeout(timeout);
        resolveResult(message.result);
      } else if (message?.type === "failure") {
        clearTimeout(timeout);
        reject(new Error(message.message));
      }
    });
    worker.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    worker.on("exit", (code) => {
      if (code !== 0) {
        clearTimeout(timeout);
        reject(new Error(`Benchmark worker exited with code ${code}.`));
      }
    });
  });

const main = async () => {
  const options = parseArguments(process.argv.slice(2));
  const result = await runWorker(options);
  const tickTiming = summarize(result.tickSamples);
  const scheduleLateness = summarize(result.scheduleLatenessSamples);
  const gate = evaluateAcceptanceGate(options, result, tickTiming);
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
    },
    benchmark: {
      simulationRateHz: 20,
      tickIntervalMs: 50,
      unitCount: options.unitCount,
      seed: options.seed,
      snapshotCadenceTicks: options.snapshotCadenceTicks,
      warmupTicks: options.warmupTicks,
      measuredTicks: options.measuredTicks,
      maxTickMs: options.maxTickMs,
    },
    result: {
      completedTicks: result.completedTicks,
      unitCount: result.unitCount,
      snapshotCount: result.snapshotCount,
      missedDeadlines: result.missedDeadlines,
      elapsedMs: Number(result.elapsedMs.toFixed(6)),
      tickTiming,
      scheduleLateness,
    },
    gate,
  };
  const serialized = `${JSON.stringify(report, null, 2)}\n`;

  if (options.output) {
    await mkdir(dirname(options.output), { recursive: true });
    await writeFile(options.output, serialized, "utf8");
  }
  process.stdout.write(serialized);
  if (report.gate.mode === "acceptance" && !report.gate.passed) {
    process.stderr.write("Phase 12 worker benchmark gate failed.\n");
    process.exitCode = 1;
  }
};

if (resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
