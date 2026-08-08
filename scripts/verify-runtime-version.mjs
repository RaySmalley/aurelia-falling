import { readFile } from "node:fs/promises";

import { ACCEPTANCE_NODE_VERSION } from "./run-worker-benchmark.mjs";

const root = new URL("../", import.meta.url);
const readText = async (path) =>
  (await readFile(new URL(path, root), "utf8")).trim();

const nodeVersion = await readText(".node-version");
const nvmVersion = await readText(".nvmrc");
const packageJson = JSON.parse(await readText("package.json"));
const packageLock = JSON.parse(await readText("package-lock.json"));
const declaredVersions = {
  ".node-version": nodeVersion,
  ".nvmrc": nvmVersion,
  "package.json engines.node": packageJson.engines?.node,
  "package-lock.json engines.node": packageLock.packages?.[""]?.engines?.node,
  "worker acceptance runtime": ACCEPTANCE_NODE_VERSION.replace(/^v/, ""),
};
const mismatches = Object.entries(declaredVersions).filter(
  ([, version]) => version !== nodeVersion,
);

if (mismatches.length > 0) {
  throw new Error(
    `Node.js runtime declarations must match .node-version (${nodeVersion}): ${mismatches
      .map(([source, version]) => `${source}=${String(version)}`)
      .join(", ")}`,
  );
}

if (process.version !== `v${nodeVersion}`) {
  throw new Error(
    `This project requires Node.js v${nodeVersion}; running ${process.version}.`,
  );
}

process.stdout.write(
  `Node.js ${nodeVersion} matches the runtime, package, and benchmark contracts.\n`,
);
