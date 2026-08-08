import { parentPort, workerData } from "node:worker_threads";
import { createServer } from "vite";

if (!parentPort) throw new Error("Worker benchmark requires a parent port.");

const createNormalSkirmishWorkload = (
  Simulation,
  isTerrainBlocked,
  seed,
  unitCount,
) => {
  const simulation = new Simulation(seed, "skirmish", "normal");
  const kinds = [
    "midasHarvester",
    "argusRifle",
    "cyclopsRocket",
    "hermesScout",
    "atlasTank",
    "gorgonWalker",
  ];
  const occupied = new Set();
  for (const unit of simulation.units) {
    occupied.add(
      `${Math.floor(unit.position.x / 1_000)},${Math.floor(unit.position.y / 1_000)}`,
    );
  }
  for (const structure of simulation.structures) {
    occupied.add(`${structure.tile.x},${structure.tile.y}`);
  }
  const availableTiles = [];
  for (let y = 2; y < 62; y += 1) {
    for (let x = 2; x < 62; x += 1) {
      const key = `${x},${y}`;
      if (!occupied.has(key) && !isTerrainBlocked({ x, y })) {
        availableTiles.push({ x, y });
      }
    }
  }
  if (availableTiles.length < unitCount - simulation.units.length) {
    throw new Error(`Golden Scar cannot place ${unitCount} benchmark units.`);
  }

  const initialCount = simulation.units.length;
  for (let index = initialCount; index < unitCount; index += 1) {
    const id = index + 1;
    const unit = simulation.createUnitState(
      id,
      index % 2 === 0 ? 1 : 2,
      kinds[index % kinds.length],
      availableTiles[index - initialCount],
      `Worker benchmark ${id}`,
    );
    simulation.units.push(unit);
  }
  simulation.nextUnitId = unitCount + 1;
  simulation.rebuildEntityIndexes();
  simulation.updateVisibility(true);
  simulation.updateAiMemory();
  return simulation;
};

const run = async () => {
  const vite = await createServer({
    root: workerData.root,
    configFile: false,
    logLevel: "silent",
    server: { middlewareMode: true },
  });

  try {
    const [{ Simulation }, { isTerrainBlocked }, hostModule, runtimeModule, protocolModule] =
      await Promise.all([
        vite.ssrLoadModule("/app/game/simulation.ts"),
        vite.ssrLoadModule("/app/game/map.ts"),
        vite.ssrLoadModule("/app/game/simulation-worker-host.ts"),
        vite.ssrLoadModule("/app/game/simulation-runtime.ts"),
        vite.ssrLoadModule("/app/game/runtime-protocol.ts"),
      ]);
    const tickSamples = [];
    const scheduleLatenessSamples = [];
    let completedTicks = 0;
    let missedDeadlines = 0;
    let snapshotCount = 0;
    let firstScheduledAt = null;
    let lastFinishedAt = null;
    let finishing = false;
    let initialUnitCount = 0;
    let requestListener = () => {};
    let host;
    const runtime = new runtimeModule.InProcessSimulationRuntime(
      undefined,
      (seed, scenario, difficulty) => {
        if (scenario !== "skirmish" || difficulty !== "normal") {
          throw new Error("Worker benchmark requires a Normal skirmish.");
        }
        const simulation = createNormalSkirmishWorkload(
          Simulation,
          isTerrainBlocked,
          seed,
          workerData.unitCount,
        );
        initialUnitCount = simulation.units.length;
        return simulation;
      },
    );

    const finish = async () => {
      if (finishing) return;
      finishing = true;
      host.stop();
      const state = runtime.authoritativeState();
      parentPort.postMessage({
        type: "result",
        result: {
          completedTicks,
          difficulty: state.aiDifficulty,
          elapsedMs: lastFinishedAt - firstScheduledAt,
          finalUnitCount: state.units.length,
          host: "startSimulationWorkerHost",
          missedDeadlines,
          scenario: state.scenario,
          scheduleLatenessSamples,
          snapshotCount,
          tickSamples,
          unitCount: initialUnitCount,
        },
      });
      await vite.close();
      parentPort.close();
    };

    const clock = hostModule.createIntervalSimulationClock(
      hostModule.SIMULATION_TICK_INTERVAL_MS,
      ({ scheduledAtMs, startedAtMs, finishedAtMs }) => {
        const runtimeTick = runtime.tick();
        if (runtimeTick <= workerData.warmupTicks) return;
        if (firstScheduledAt === null) firstScheduledAt = scheduledAtMs;
        lastFinishedAt = finishedAtMs;
        completedTicks += 1;
        tickSamples.push(finishedAtMs - startedAtMs);
        scheduleLatenessSamples.push(
          Math.max(0, startedAtMs - scheduledAtMs),
        );
        if (finishedAtMs > scheduledAtMs + hostModule.SIMULATION_TICK_INTERVAL_MS) {
          missedDeadlines += 1;
        }
        if (completedTicks >= workerData.measuredTicks) {
          void finish();
        }
      },
    );
    host = hostModule.startSimulationWorkerHost(
      {
        postMessage(event) {
          if (event.type === "error") {
            parentPort.postMessage({ type: "failure", message: event.message });
            return;
          }
          if (
            event.type === "snapshot" &&
            event.tick > workerData.warmupTicks
          ) {
            snapshotCount += 1;
          }
          parentPort.postMessage({ type: "runtimeEvent", event });
        },
        subscribe(listener) {
          requestListener = listener;
          return () => {
            requestListener = () => {};
          };
        },
      },
      clock,
      runtime,
    );
    requestListener({
      protocolVersion: protocolModule.SIMULATION_RUNTIME_PROTOCOL_VERSION,
      type: "initialize",
      seed: workerData.seed,
      scenario: "skirmish",
      difficulty: "normal",
      snapshotCadenceTicks: workerData.snapshotCadenceTicks,
    });
  } catch (error) {
    await vite.close();
    throw error;
  }
};

run().catch((error) => {
  parentPort.postMessage({
    type: "failure",
    message: error instanceof Error ? error.stack ?? error.message : String(error),
  });
  parentPort.close();
});
