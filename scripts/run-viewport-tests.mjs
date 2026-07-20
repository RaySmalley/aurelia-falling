import { execFile, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL("..", import.meta.url));
const serverCli = fileURLToPath(
  new URL("../node_modules/vinext/dist/cli.js", import.meta.url),
);
const playwrightCli = fileURLToPath(
  new URL("../node_modules/@playwright/test/cli.js", import.meta.url),
);
const serverUrl = "http://localhost:4000";

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
      throw new Error(`Viewport production server exited with ${server.exitCode}.`);
    }
    if (await isServerReady()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Viewport production server did not reach ${serverUrl}.`);
}

async function stopServer(server) {
  if (server.exitCode !== null) return;
  if (process.platform === "win32") {
    try {
      await execFileAsync("taskkill", [
        "/pid",
        String(server.pid),
        "/t",
        "/f",
      ], { timeout: 5_000, windowsHide: true });
    } catch {
      // The process may have exited between the readiness check and teardown.
      server.kill();
    }
    return;
  }
  server.kill("SIGTERM");
}

if (await isServerReady()) {
  throw new Error(
    `Port 4000 is already serving content. Stop it before running the production viewport suite.`,
  );
}

const server = spawn(process.execPath, [serverCli, "start", "--port", "4000"], {
  cwd: root,
  stdio: ["ignore", "ignore", "inherit"],
  windowsHide: true,
});

let exitCode = 1;
try {
  await waitForServer(server);
  const tests = spawn(
    process.execPath,
    [playwrightCli, "test", ...process.argv.slice(2)],
    {
      cwd: root,
      stdio: "inherit",
      windowsHide: true,
    },
  );
  exitCode = await new Promise((resolve, reject) => {
    tests.once("error", reject);
    tests.once("exit", (code) => resolve(code ?? 1));
  });
  console.log(`Viewport browser tests exited with code ${exitCode}.`);
} finally {
  console.log("Stopping the viewport production server.");
  await stopServer(server);
  console.log("Viewport production server stopped.");
}

process.exitCode = exitCode;
