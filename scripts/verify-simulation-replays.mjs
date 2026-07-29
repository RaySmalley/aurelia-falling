import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { hashReplayState } from "./replay-state-hash.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const fixtureUrl = new URL(
  "../benchmarks/replays/simulation-replays.json",
  import.meta.url,
);
const update = process.argv.slice(2).includes("--update");

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
  let commandIndex = 0;

  while (
    commandIndex < fixture.commands.length ||
    simulation.snapshot().tick < fixture.finalTick
  ) {
    const tick = simulation.snapshot().tick;
    const nextCommand = fixture.commands[commandIndex];
    if (nextCommand && nextCommand.tick < tick) {
      throw new Error(
        `Replay ${fixture.id} command ${commandIndex} targets tick ${
          nextCommand.tick
        }, which has already passed in the current epoch (tick ${tick}).`,
      );
    }
    while (fixture.commands[commandIndex]?.tick === tick) {
      const entry = fixture.commands[commandIndex];
      commandIndex += 1;
      simulation.enqueue(entry.command);
    }
    simulation.step();
    const completedTick = simulation.snapshot().tick;
    if (checkpointTicks.has(completedTick)) {
      checkpointHashes[completedTick] = hashReplayState(simulation);
    }
  }

  return {
    checkpoints: checkpointHashes,
    final: hashReplayState(simulation),
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
