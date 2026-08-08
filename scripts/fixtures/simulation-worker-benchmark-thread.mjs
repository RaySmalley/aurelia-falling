import { parentPort, workerData } from "node:worker_threads";
import { performance } from "node:perf_hooks";
import { createServer } from "vite";

if (!parentPort) throw new Error("Worker benchmark requires a parent port.");

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
    const unit = simulation.createUnitState(
      id,
      index % 2 === 0 ? 1 : 2,
      kinds[index % kinds.length],
      {
        x: 4 + (index % 56),
        y: 4 + (Math.floor(index / 56) % 56),
      },
      `Worker benchmark ${id}`,
    );
    unit.order = "hold";
    return unit;
  });
  simulation.nextUnitId = unitCount + 1;
  simulation.rebuildEntityIndexes();
  simulation.updateVisibility(true);
};

const run = async () => {
  const vite = await createServer({
    root: workerData.root,
    configFile: false,
    logLevel: "silent",
    server: { middlewareMode: true },
  });

  try {
    const { Simulation } = await vite.ssrLoadModule("/app/game/simulation.ts");
    const simulation = new Simulation(workerData.seed, "combat", "normal");
    createIdleArmy(simulation, workerData.unitCount);

    for (let tick = 0; tick < workerData.warmupTicks; tick += 1) {
      simulation.step();
      if ((tick + 1) % workerData.snapshotCadenceTicks === 0) {
        structuredClone(simulation.snapshot());
      }
    }

    const tickSamples = [];
    const scheduleLatenessSamples = [];
    let completedTicks = 0;
    let missedDeadlines = 0;
    let snapshotCount = 0;
    const firstScheduledAt = performance.now() + 50;
    let scheduledAt = firstScheduledAt;

    const finish = async () => {
      const elapsedMs = performance.now() - firstScheduledAt;
      parentPort.postMessage({
        type: "result",
        result: {
          completedTicks,
          elapsedMs,
          missedDeadlines,
          scheduleLatenessSamples,
          snapshotCount,
          tickSamples,
          unitCount: simulation.units.length,
        },
      });
      await vite.close();
      parentPort.close();
    };

    const tick = () => {
      const startedAt = performance.now();
      scheduleLatenessSamples.push(Math.max(0, startedAt - scheduledAt));
      simulation.step();
      completedTicks += 1;
      if (completedTicks % workerData.snapshotCadenceTicks === 0) {
        parentPort.postMessage({
          type: "snapshot",
          tick: completedTicks,
          snapshot: simulation.snapshot(),
        });
        snapshotCount += 1;
      }
      const finishedAt = performance.now();
      tickSamples.push(finishedAt - startedAt);
      const nextScheduledAt = scheduledAt + 50;
      if (finishedAt > nextScheduledAt) missedDeadlines += 1;

      if (completedTicks >= workerData.measuredTicks) {
        void finish();
        return;
      }
      scheduledAt = nextScheduledAt;
      setTimeout(tick, Math.max(0, scheduledAt - performance.now()));
    };

    setTimeout(tick, Math.max(0, scheduledAt - performance.now()));
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
