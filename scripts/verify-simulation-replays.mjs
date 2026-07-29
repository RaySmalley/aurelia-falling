import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { hashReplayState } from "./replay-state-hash.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const fixtureUrl = new URL(
  "../benchmarks/replays/simulation-replays.json",
  import.meta.url,
);
const update = process.argv.slice(2).includes("--update");
const restartKinds = new Set([
  "restartCombat",
  "restartEconomy",
  "restartSkirmish",
]);
const checkpointKey = ({ epoch, tick }) => `${epoch}:${tick}`;
const isNonNegativeInteger = (value) =>
  Number.isInteger(value) && value >= 0;
const isRestartCommand = (command) => restartKinds.has(command?.kind);

const validateCoordinate = (fixture, label, coordinate) => {
  if (
    !coordinate ||
    !isNonNegativeInteger(coordinate.epoch) ||
    !isNonNegativeInteger(coordinate.tick)
  ) {
    throw new Error(
      `Replay ${fixture.id} ${label} must contain non-negative integer epoch and tick values.`,
    );
  }
};

export const validateFixture = (fixture) => {
  if (!Array.isArray(fixture.commands) || !Array.isArray(fixture.checkpoints)) {
    throw new Error(
      `Replay ${fixture.id} commands and checkpoints must be arrays.`,
    );
  }
  validateCoordinate(fixture, "end", fixture.end);
  if (fixture.end.tick === 0) {
    throw new Error(`Replay ${fixture.id} end tick must be positive.`);
  }

  let expectedEpoch = 0;
  let previousTick = -1;
  const restartTicks = new Map();
  for (const [index, entry] of fixture.commands.entries()) {
    validateCoordinate(fixture, `command ${index}`, entry);
    if (entry.epoch !== expectedEpoch) {
      throw new Error(
        `Replay ${fixture.id} command ${index} must target epoch ${expectedEpoch}, not ${entry.epoch}.`,
      );
    }
    if (entry.tick < previousTick) {
      throw new Error(
        `Replay ${fixture.id} command ${index} is out of tick order in epoch ${entry.epoch}.`,
      );
    }
    if (entry.epoch > 0 && entry.tick === 0) {
      throw new Error(
        `Replay ${fixture.id} command ${index} cannot target restart-epoch tick 0.`,
      );
    }
    previousTick = entry.tick;
    if (isRestartCommand(entry.command)) {
      restartTicks.set(entry.epoch, entry.tick);
      expectedEpoch += 1;
      previousTick = -1;
    }
  }
  if (fixture.end.epoch !== expectedEpoch) {
    throw new Error(
      `Replay ${fixture.id} end epoch ${fixture.end.epoch} does not match its ${expectedEpoch} restart transition(s).`,
    );
  }
  const finalEpochCommands = fixture.commands.filter(
    (entry) => entry.epoch === fixture.end.epoch,
  );
  if (
    finalEpochCommands.some((entry) => entry.tick >= fixture.end.tick)
  ) {
    throw new Error(
      `Replay ${fixture.id} final-epoch commands must occur before end tick ${fixture.end.tick}.`,
    );
  }

  const checkpointKeys = new Set();
  for (const [index, checkpoint] of fixture.checkpoints.entries()) {
    validateCoordinate(fixture, `checkpoint ${index}`, checkpoint);
    if (checkpoint.tick === 0) {
      throw new Error(
        `Replay ${fixture.id} checkpoint ${index} must target a completed positive tick.`,
      );
    }
    if (checkpoint.epoch > fixture.end.epoch) {
      throw new Error(
        `Replay ${fixture.id} checkpoint ${index} targets an epoch after the replay end.`,
      );
    }
    const epochEndTick =
      checkpoint.epoch === fixture.end.epoch
        ? fixture.end.tick
        : restartTicks.get(checkpoint.epoch);
    if (checkpoint.tick > epochEndTick) {
      throw new Error(
        `Replay ${fixture.id} checkpoint ${checkpointKey(
          checkpoint,
        )} is unreachable; epoch ${checkpoint.epoch} ends at tick ${epochEndTick}.`,
      );
    }
    const key = checkpointKey(checkpoint);
    if (checkpointKeys.has(key)) {
      throw new Error(
        `Replay ${fixture.id} contains duplicate checkpoint ${key}.`,
      );
    }
    checkpointKeys.add(key);
  }
};

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
  simulation.rebuildEntityIndexes();
  simulation.updateConnectivityAndPower();
  simulation.updateVisibility(true);
};

export const runFixture = (Simulation, gameData, fixture) => {
  validateFixture(fixture);
  const simulation = new Simulation(
    fixture.seed,
    fixture.scenario,
    fixture.difficulty ?? "normal",
  );
  applySetup(simulation, gameData, fixture.setup);

  const checkpointKeys = new Set(fixture.checkpoints.map(checkpointKey));
  const checkpointHashes = {};
  let commandIndex = 0;
  let epoch = 0;

  while (
    commandIndex < fixture.commands.length ||
    epoch < fixture.end.epoch ||
    simulation.snapshot().tick < fixture.end.tick
  ) {
    const tick = simulation.snapshot().tick;
    const nextCommand = fixture.commands[commandIndex];
    if (
      nextCommand &&
      (nextCommand.epoch < epoch ||
        (nextCommand.epoch === epoch && nextCommand.tick < tick))
    ) {
      throw new Error(
        `Replay ${fixture.id} command ${commandIndex} targets ${checkpointKey(
          nextCommand,
        )}, which has already passed (current ${checkpointKey({
          epoch,
          tick,
        })}).`,
      );
    }
    let restarted = false;
    while (
      fixture.commands[commandIndex]?.epoch === epoch &&
      fixture.commands[commandIndex]?.tick === tick
    ) {
      const entry = fixture.commands[commandIndex];
      commandIndex += 1;
      restarted ||= isRestartCommand(entry.command);
      simulation.enqueue(entry.command);
    }
    simulation.step();
    if (restarted) epoch += 1;
    const completedTick = simulation.snapshot().tick;
    const completedKey = checkpointKey({ epoch, tick: completedTick });
    if (checkpointKeys.has(completedKey)) {
      checkpointHashes[completedKey] = hashReplayState(simulation);
    }
  }
  const missingCheckpoints = [...checkpointKeys].filter(
    (key) => !(key in checkpointHashes),
  );
  if (missingCheckpoints.length > 0) {
    throw new Error(
      `Replay ${fixture.id} did not reach checkpoint(s): ${missingCheckpoints.join(
        ", ",
      )}.`,
    );
  }
  const completed = { epoch, tick: simulation.snapshot().tick };
  if (checkpointKey(completed) !== checkpointKey(fixture.end)) {
    throw new Error(
      `Replay ${fixture.id} ended at ${checkpointKey(
        completed,
      )}, expected ${checkpointKey(fixture.end)}.`,
    );
  }

  return {
    checkpoints: checkpointHashes,
    final: hashReplayState(simulation),
  };
};

const main = async () => {
  const fixtures = JSON.parse(await readFile(fixtureUrl, "utf8"));
  if (fixtures.schemaVersion !== 2) {
    throw new Error(
      `Unsupported replay schema version ${fixtures.schemaVersion}; expected 2.`,
    );
  }
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

if (resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
