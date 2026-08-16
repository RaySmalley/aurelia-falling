import { execFile, execFileSync, spawn } from "node:child_process";
import { cpus, totalmem } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { chromium } from "@playwright/test";
import { createServer } from "vite";

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL("..", import.meta.url));
const serverCli = fileURLToPath(
  new URL("../node_modules/vinext/dist/cli.js", import.meta.url),
);
const serverUrl = "http://localhost:4000";

export const PRESENTATION_ACCEPTANCE_PROFILE = Object.freeze({
  browserDurationMs: 5_000,
  browserWarmupFrames: 120,
  maxProductionP95Ms: 2,
  maxTransferP95Ms: 2,
  measuredPublications: 100,
  normalTargetMinimumFps: 57,
  normalTargetUnits: 600,
  publicationCadenceMs: 100,
  stressMinimumFps: 30,
  stressUnits: 1_000,
  warmupPublications: 20,
});

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

const renderDeltaTransferables = (delta) => [
  delta.units.hotIds.buffer,
  delta.units.hotValues.buffer,
  delta.units.hide.buffer,
  delta.units.destroy.buffer,
  delta.structures.hotIds.buffer,
  delta.structures.hotValues.buffer,
  delta.structures.hide.buffer,
  delta.structures.destroy.buffer,
];

const payloadBytes = (delta) => {
  const buffers = renderDeltaTransferables(delta);
  const metadata = JSON.stringify(delta, (_key, value) =>
    ArrayBuffer.isView(value) ? null : value,
  );
  return (
    Buffer.byteLength(metadata) +
    buffers.reduce((total, buffer) => total + buffer.byteLength, 0)
  );
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
    const unit = simulation.createUnitState(
      index + 1,
      index % 2 === 0 ? 1 : 2,
      kinds[index % kinds.length],
      {
        x: 4 + (index % 56),
        y: 4 + (Math.floor(index / 56) % 56),
      },
      `Presentation publication ${index + 1}`,
    );
    unit.order = "hold";
    return unit;
  });
  simulation.structures = [];
  simulation.fields = [];
  simulation.nextUnitId = unitCount + 1;
  simulation.rebuildEntityIndexes();
  simulation.updateVisibility(true);
};

async function measurePublicationPath() {
  const vite = await createServer({
    root,
    configFile: false,
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  try {
    const [simulationModule, deltaModule] = await Promise.all([
      vite.ssrLoadModule("/app/game/simulation.ts"),
      vite.ssrLoadModule("/app/game/render-delta.ts"),
    ]);
    const simulation = new simulationModule.Simulation(13_600, "combat");
    createIdleArmy(simulation, PRESENTATION_ACCEPTANCE_PROFILE.normalTargetUnits);
    const encoder = new deltaModule.RenderSnapshotDeltaEncoder();
    const store = new deltaModule.RenderSnapshotDeltaStore();
    const initialSnapshot = simulation.snapshot();
    const initialDelta = encoder.encode(initialSnapshot);
    const initialPayloadBytes = payloadBytes(initialDelta);
    store.apply(structuredClone(initialDelta));
    const productionSamples = [];
    const sourceSnapshotSamples = [];
    const transferSamples = [];
    let changedPayloadBytes = 0;
    const totalPublications =
      PRESENTATION_ACCEPTANCE_PROFILE.warmupPublications +
      PRESENTATION_ACCEPTANCE_PROFILE.measuredPublications;

    for (let index = 0; index < totalPublications; index += 1) {
      await new Promise((resolveCadence) =>
        setTimeout(
          resolveCadence,
          PRESENTATION_ACCEPTANCE_PROFILE.publicationCadenceMs,
        ),
      );
      simulation.units[0].position.x += 1;
      const sourceSnapshotStartedAt = performance.now();
      const snapshot = simulation.snapshot();
      const sourceSnapshotMs = performance.now() - sourceSnapshotStartedAt;
      const productionStartedAt = performance.now();
      const delta = encoder.encode(snapshot);
      const productionMs = performance.now() - productionStartedAt;
      changedPayloadBytes = payloadBytes(delta);
      const transferStartedAt = performance.now();
      const received = structuredClone(delta, {
        transfer: renderDeltaTransferables(delta),
      });
      store.apply(received);
      const transferMs = performance.now() - transferStartedAt;
      if (index >= PRESENTATION_ACCEPTANCE_PROFILE.warmupPublications) {
        productionSamples.push(productionMs);
        sourceSnapshotSamples.push(sourceSnapshotMs);
        transferSamples.push(transferMs);
      }
    }

    return {
      changedPayloadBytes,
      initialPayloadBytes,
      productionTiming: summarize(productionSamples),
      reconstructedUnitCount: store.snapshot().units.length,
      sourceSnapshotTiming: summarize(sourceSnapshotSamples),
      transferTiming: summarize(transferSamples),
    };
  } finally {
    await vite.close();
  }
}

async function isServerReady() {
  try {
    const response = await fetch(serverUrl, {
      signal: AbortSignal.timeout(2_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForServer(server) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`Presentation server exited with ${server.exitCode}.`);
    }
    if (await isServerReady()) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error(`Presentation server did not reach ${serverUrl}.`);
}

async function stopServer(server) {
  if (server.exitCode !== null) return;
  if (process.platform === "win32") {
    try {
      await execFileAsync(
        "taskkill",
        ["/pid", String(server.pid), "/t", "/f"],
        { timeout: 5_000, windowsHide: true },
      );
      return;
    } catch {
      server.kill();
      return;
    }
  }
  server.kill("SIGTERM");
}

async function measureBrowserScenario(page, unitCount) {
  process.stderr.write(`Loading ${unitCount}-unit presentation fixture.\n`);
  await page.goto(
    `${serverUrl}/?presentationBenchmarkUnits=${unitCount}`,
    { timeout: 30_000, waitUntil: "domcontentloaded" },
  );
  await page.waitForFunction(
    (expected) => {
      const marker = window.__AURELIA_PRESENTATION_BENCHMARK__;
      return (
        marker?.ready === true &&
        marker.unitCount === expected &&
        marker.renderedUnitCount === expected &&
        marker.visibleUnitCount === expected
      );
    },
    unitCount,
    { timeout: 60_000 },
  );
  process.stderr.write(`Measuring ${unitCount}-unit presentation fixture.\n`);
  const measurement = await page.evaluate(
    async ({ durationMs, warmupFrames }) => {
      await new Promise((resolveWarmup, rejectWarmup) => {
        let frame = 0;
        const timeout = window.setTimeout(
          () => rejectWarmup(new Error("Frame warmup timed out.")),
          20_000,
        );
        const warm = () => {
          frame += 1;
          if (frame >= warmupFrames) {
            window.clearTimeout(timeout);
            resolveWarmup();
            return;
          }
          requestAnimationFrame(warm);
        };
        requestAnimationFrame(warm);
      });
      const timestamps = [];
      const startedAt = performance.now();
      await new Promise((resolveMeasurement, rejectMeasurement) => {
        const timeout = window.setTimeout(
          () => rejectMeasurement(new Error("Frame measurement timed out.")),
          durationMs + 10_000,
        );
        const sample = (timestamp) => {
          timestamps.push(timestamp);
          if (performance.now() - startedAt >= durationMs) {
            window.clearTimeout(timeout);
            resolveMeasurement();
            return;
          }
          requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      });
      const elapsedMs = timestamps.at(-1) - timestamps[0];
      const intervals = timestamps
        .slice(1)
        .map((timestamp, index) => timestamp - timestamps[index]);
      const marker = window.__AURELIA_PRESENTATION_BENCHMARK__;
      const canvas = document.querySelector("canvas");
      const context = canvas?.getContext("webgl2") ?? canvas?.getContext("webgl");
      const extension = context?.getExtension("WEBGL_debug_renderer_info");
      return {
        averageFps: ((timestamps.length - 1) * 1_000) / elapsedMs,
        frameIntervals: intervals,
        marker,
        userAgent: navigator.userAgent,
        webglRenderer:
          context && extension
            ? context.getParameter(extension.UNMASKED_RENDERER_WEBGL)
            : "unavailable",
      };
    },
    {
      durationMs: PRESENTATION_ACCEPTANCE_PROFILE.browserDurationMs,
      warmupFrames: PRESENTATION_ACCEPTANCE_PROFILE.browserWarmupFrames,
    },
  );
  return {
    averageFps: Number(measurement.averageFps.toFixed(3)),
    frameTiming: summarize(measurement.frameIntervals),
    renderedUnitCount: measurement.marker.renderedUnitCount,
    renderer: measurement.marker.renderer,
    unitCount,
    userAgent: measurement.userAgent,
    visibleUnitCount: measurement.marker.visibleUnitCount,
    webglRenderer: measurement.webglRenderer,
  };
}

async function measureBrowserPresentation() {
  if (await isServerReady()) {
    throw new Error(`Port 4000 is already serving content.`);
  }
  const server = spawn(process.execPath, [serverCli, "start", "--port", "4000"], {
    cwd: root,
    stdio: ["ignore", "ignore", "inherit"],
    windowsHide: true,
  });
  let browser;
  try {
    await waitForServer(server);
    browser = await chromium.launch({ headless: false });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on("pageerror", (error) => {
      process.stderr.write(`Presentation page error: ${error.message}\n`);
    });
    const scenarios = [];
    for (const unitCount of [
      PRESENTATION_ACCEPTANCE_PROFILE.normalTargetUnits,
      PRESENTATION_ACCEPTANCE_PROFILE.stressUnits,
    ]) {
      scenarios.push(await measureBrowserScenario(page, unitCount));
    }
    return scenarios;
  } finally {
    await browser?.close();
    await stopServer(server);
  }
}

export function evaluatePresentationAcceptance(publication, scenarios) {
  const normal = scenarios.find(
    (scenario) =>
      scenario.unitCount === PRESENTATION_ACCEPTANCE_PROFILE.normalTargetUnits,
  );
  const stress = scenarios.find(
    (scenario) => scenario.unitCount === PRESENTATION_ACCEPTANCE_PROFILE.stressUnits,
  );
  const checks = {
    changedPayloadIsProportional:
      publication.changedPayloadBytes < publication.initialPayloadBytes * 0.05,
    normalFrameRate:
      normal?.averageFps >=
      PRESENTATION_ACCEPTANCE_PROFILE.normalTargetMinimumFps,
    normalUnitCount:
      normal?.renderedUnitCount ===
        PRESENTATION_ACCEPTANCE_PROFILE.normalTargetUnits &&
      normal?.visibleUnitCount ===
        PRESENTATION_ACCEPTANCE_PROFILE.normalTargetUnits,
    productionBudget:
      publication.productionTiming.p95Ms <=
      PRESENTATION_ACCEPTANCE_PROFILE.maxProductionP95Ms,
    renderer: scenarios.every((scenario) => scenario.renderer.startsWith("WebGL")),
    stressFrameRate:
      stress?.averageFps >= PRESENTATION_ACCEPTANCE_PROFILE.stressMinimumFps,
    stressUnitCount:
      stress?.renderedUnitCount === PRESENTATION_ACCEPTANCE_PROFILE.stressUnits &&
      stress?.visibleUnitCount === PRESENTATION_ACCEPTANCE_PROFILE.stressUnits,
    transferBudget:
      publication.transferTiming.p95Ms <=
      PRESENTATION_ACCEPTANCE_PROFILE.maxTransferP95Ms,
  };
  return {
    acceptanceProfile: PRESENTATION_ACCEPTANCE_PROFILE,
    checks,
    passed: Object.values(checks).every(Boolean),
  };
}

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

async function main() {
  const outputIndex = process.argv.indexOf("--output");
  if (process.argv.length > 2 && outputIndex !== 2) {
    throw new Error("Usage: run-presentation-benchmark.mjs [--output <path>]");
  }
  const output =
    outputIndex === 2 && process.argv[3] && process.argv.length === 4
      ? resolve(root, process.argv[3])
      : null;
  if (outputIndex === 2 && !output) {
    throw new Error("--output requires a path.");
  }

  const publication = await measurePublicationPath();
  const scenarios = await measureBrowserPresentation();
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
      cpu: cpu?.model ?? "unknown",
      logicalCpuCount: cpus().length,
      totalMemoryBytes: totalmem(),
    },
    publication,
    scenarios,
    gate: evaluatePresentationAcceptance(publication, scenarios),
  };
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (output) {
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, serialized, "utf8");
  }
  process.stdout.write(serialized);
  if (!report.gate.passed) {
    process.stderr.write("Presentation benchmark acceptance gate failed.\n");
    process.exitCode = 1;
  }
}

if (resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
