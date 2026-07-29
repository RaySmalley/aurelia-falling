import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const fixtureUrl = new URL(
  "../benchmarks/replays/simulation-replays.json",
  import.meta.url,
);
const update = process.argv.slice(2).includes("--update");

const hashSnapshot = (simulation) =>
  createHash("sha256")
    .update(JSON.stringify(simulation.snapshot()))
    .digest("hex");

const applySetup = (simulation, gameData, setup) => {
  if (!setup) return;
  if (setup !== "solar-spear-ready") {
    throw new Error(`Unknown replay setup: ${setup}`);
  }

  simulation.structures.push(
    simulation.createStructureState(
      91,
      1,
      "operationsCenter",
      { x: 8, y: 12 },
      true,
    ),
  );
  simulation.solarSpears[1].chargeTicks = gameData.solarSpear.chargeTicks;
  const enemyCitadel = simulation.structures.find(
    (structure) =>
      structure.playerId === 2 && structure.kind === "citadel",
  );
  enemyCitadel.tile = { x: 17, y: 15 };
  simulation.updateConnectivityAndPower();
  simulation.updateVisibility(true);
};

const runFixture = (Simulation, gameData, fixture) => {
  const simulation = new Simulation(
    fixture.seed,
    fixture.scenario,
    fixture.difficulty ?? "normal",
  );
  applySetup(simulation, gameData, fixture.setup);

  const checkpointTicks = new Set(fixture.checkpoints);
  const checkpointHashes = {};
  const commandsByTick = Map.groupBy(
    fixture.commands,
    (entry) => entry.tick,
  );

  while (simulation.snapshot().tick < fixture.finalTick) {
    const tick = simulation.snapshot().tick;
    for (const entry of commandsByTick.get(tick) ?? []) {
      simulation.enqueue(entry.command);
    }
    simulation.step();
    const completedTick = simulation.snapshot().tick;
    if (checkpointTicks.has(completedTick)) {
      checkpointHashes[completedTick] = hashSnapshot(simulation);
    }
  }

  return {
    checkpoints: checkpointHashes,
    final: hashSnapshot(simulation),
  };
};

const main = async () => {
  const fixtures = JSON.parse(await readFile(fixtureUrl, "utf8"));
  const vite = await createServer({
    root,
    configFile: false,
    logLevel: "silent",
    server: { middlewareMode: true },
  });

  try {
    const [dataModule, simulationModule] = await Promise.all([
      vite.ssrLoadModule("/app/game/data.ts"),
      vite.ssrLoadModule("/app/game/simulation.ts"),
    ]);
    const failures = [];
    const results = fixtures.fixtures.map((fixture) => {
      const actual = runFixture(
        simulationModule.Simulation,
        dataModule.gameData,
        fixture,
      );
      if (!update) {
        if (JSON.stringify(actual) !== JSON.stringify(fixture.expected)) {
          failures.push({
            id: fixture.id,
            expected: fixture.expected,
            actual,
          });
        }
      } else {
        fixture.expected = actual;
      }
      return { id: fixture.id, ...actual };
    });

    if (update) {
      await writeFile(
        fixtureUrl,
        `${JSON.stringify(fixtures, null, 2)}\n`,
        "utf8",
      );
    }
    if (failures.length > 0) {
      process.stderr.write(`${JSON.stringify({ failures }, null, 2)}\n`);
      process.exitCode = 1;
      return;
    }
    process.stdout.write(
      `${JSON.stringify(
        {
          schemaVersion: fixtures.schemaVersion,
          updated: update,
          verified: results.length,
          results,
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await vite.close();
  }
};

await main();
