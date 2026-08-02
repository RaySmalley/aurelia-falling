import { expect, test, type Page, type TestInfo } from "@playwright/test";
import baseline from "./phase-six-baseline.json" with { type: "json" };

const VIEWPORTS = [
  { name: "laptop", width: 1366, height: 650 },
  { name: "minimum", width: 1024, height: 640 },
] as const;
const SETTINGS_KEY = "aurelia-falling.settings.v1";
// Phase 9A deliberately preserves Phaser's canonical logical game contract.
const LOGICAL_GAME_SIZE = { width: 1280, height: 720 } as const;

type Rect = {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
};

type LayoutMetrics = {
  viewport: { width: number; height: number };
  document: { width: number; height: number };
  shell: Rect;
  battlefield: Rect;
  host: Rect;
  canvas: Rect;
  commandDock: Rect | null;
  subtitle: Rect | null;
};

async function loadSetup(page: Page, uiScale = 1) {
  await page.addInitScript(
    ({ settingsKey, scale }) => {
      localStorage.clear();
      localStorage.setItem(settingsKey, JSON.stringify({ uiScale: scale }));
    },
    { settingsKey: SETTINGS_KEY, scale: uiScale },
  );
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Begin operation" })).toBeEnabled();
  await expect(page.locator(".game-host canvas")).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator(".operations-shell")
        .evaluate((element) => getComputedStyle(element).zoom),
    )
    .toBe(String(uiScale));
}

async function readLayout(page: Page): Promise<LayoutMetrics> {
  return page.evaluate(() => {
    const rect = (selector: string) => {
      const element = document.querySelector(selector);
      if (!(element instanceof HTMLElement)) {
        throw new Error(`Missing viewport element: ${selector}`);
      }
      return element.getBoundingClientRect().toJSON();
    };

    const commandDock = document.querySelector(".economy-deck");
    const subtitle = document.querySelector(".radio-subtitle");
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      document: {
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
      },
      shell: rect(".operations-shell"),
      battlefield: rect(".battlefield-frame"),
      host: rect(".game-host"),
      canvas: rect(".game-host canvas"),
      commandDock:
        commandDock instanceof HTMLElement
          ? commandDock.getBoundingClientRect().toJSON()
          : null,
      subtitle:
        subtitle instanceof HTMLElement
          ? subtitle.getBoundingClientRect().toJSON()
          : null,
    };
  });
}

function expectContained(inner: Rect, outer: Rect) {
  expect(inner.left).toBeGreaterThanOrEqual(outer.left - 1);
  expect(inner.top).toBeGreaterThanOrEqual(outer.top - 1);
  expect(inner.right).toBeLessThanOrEqual(outer.right + 1);
  expect(inner.bottom).toBeLessThanOrEqual(outer.bottom + 1);
}

function expectViewportContract(metrics: LayoutMetrics) {
  expect(metrics.document.width).toBeLessThanOrEqual(metrics.viewport.width);
  expect(metrics.document.height).toBeLessThanOrEqual(metrics.viewport.height);
  expect(metrics.shell.top).toBeGreaterThanOrEqual(0);
  expect(metrics.shell.bottom).toBeLessThanOrEqual(metrics.viewport.height + 1);
  expectContained(metrics.battlefield, metrics.shell);
  expectContained(metrics.host, metrics.battlefield);
  expect(metrics.canvas.width).toBeGreaterThan(0);
  expect(metrics.canvas.height).toBeGreaterThan(0);
  expectContained(metrics.canvas, metrics.battlefield);
  if (metrics.commandDock) expectContained(metrics.commandDock, metrics.shell);
}

function expectFullBleedBattlefield(metrics: LayoutMetrics) {
  expect(metrics.battlefield.left).toBeCloseTo(0, 0);
  expect(metrics.battlefield.top).toBeCloseTo(0, 0);
  expect(metrics.battlefield.right).toBeCloseTo(metrics.viewport.width, 0);
  expect(metrics.battlefield.bottom).toBeCloseTo(metrics.viewport.height, 0);
}

async function clickLogicalCanvas(page: Page, x: number, y: number) {
  const canvas = page.locator(".game-host canvas");
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("Missing canvas bounds");
  await page.mouse.click(
    bounds.x + (x / LOGICAL_GAME_SIZE.width) * bounds.width,
    bounds.y + (y / LOGICAL_GAME_SIZE.height) * bounds.height,
  );
}

async function capture(page: Page, testInfo: TestInfo, state: string) {
  await page.screenshot({
    path: testInfo.outputPath(
      `${testInfo.project.name || "chromium"}-${state}.png`,
    ),
    fullPage: true,
  });
}

test("persisted 110% UI scale stays reachable at the minimum viewport", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1024, height: 640 });
  await loadSetup(page, 1.1);

  const setup = await readLayout(page);
  expectViewportContract(setup);
  expectFullBleedBattlefield(setup);

  await page.getByRole("button", { name: "Begin operation" }).click();
  await expect(page.locator(".economy-deck")).toBeVisible();
  const playing = await readLayout(page);
  expectViewportContract(playing);
  expectFullBleedBattlefield(playing);

  await expect(page.locator(".radio-subtitle")).toBeVisible();
  const subtitleLayout = await readLayout(page);
  expect(subtitleLayout.subtitle).not.toBeNull();
  expect(subtitleLayout.commandDock).not.toBeNull();
  expect(subtitleLayout.subtitle!.bottom).toBeLessThanOrEqual(
    subtitleLayout.commandDock!.top,
  );
  await expect(page.locator(".radio-subtitle")).toHaveCSS(
    "pointer-events",
    "none",
  );

  await page.getByRole("button", { name: "Pause" }).click();
  const surrenderButton = page.getByRole("button", { name: "Surrender" });
  await expect(surrenderButton).toBeVisible();
  await expect(surrenderButton).toBeEnabled();
  await expect(surrenderButton).toHaveCSS("pointer-events", "auto");
  page.once("dialog", (dialog) => dialog.dismiss());
  await surrenderButton.click();
  await page.getByRole("button", { name: "Resume operation" }).click();

  await page.getByRole("button", { name: "Settings" }).click();
  const settingsDialog = page.getByRole("dialog");
  await expect(settingsDialog).toBeVisible();
  const doneButton = page.getByRole("button", { name: "Done" });
  await doneButton.scrollIntoViewIfNeeded();
  await expect(doneButton).toBeInViewport();

  const shellBounds = (await readLayout(page)).shell;
  const dialogBounds = await settingsDialog.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return {
      top: bounds.top,
      right: bounds.right,
      bottom: bounds.bottom,
      left: bounds.left,
      width: bounds.width,
      height: bounds.height,
    };
  });
  expectContained(dialogBounds, shellBounds);
  await capture(page, testInfo, "minimum-110-percent-settings");
});

test("records the known Phase 6 overflow baseline", () => {
  expect(baseline.measurements).toHaveLength(3);
  for (const measurement of baseline.measurements) {
    expect(measurement.playingOverflow).toBeGreaterThan(0);
    expect(measurement.playingDocumentHeight - measurement.viewport.height).toBe(
      measurement.playingOverflow,
    );
  }
});

for (const viewport of VIEWPORTS) {
  test(`${viewport.name} setup and active play stay inside the viewport`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    await loadSetup(page);

    const setup = await readLayout(page);
    expectViewportContract(setup);
    expectFullBleedBattlefield(setup);
    await capture(page, testInfo, `${viewport.name}-setup`);

    await page.getByRole("button", { name: "Begin operation" }).click();
    await expect(page.locator(".economy-deck")).toBeVisible();
    await expect
      .poll(async () => (await readLayout(page)).canvas.height)
      .toBeCloseTo(setup.canvas.height, 0);

    const playing = await readLayout(page);
    expectViewportContract(playing);
    expectFullBleedBattlefield(playing);
    expect(playing.canvas.height).toBeGreaterThanOrEqual(575);
    await capture(page, testInfo, `${viewport.name}-playing`);
  });
}

test("Phaser recomputes its display bounds after consecutive viewport changes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 650 });
  await loadSetup(page);
  const initial = await readLayout(page);

  await page.setViewportSize({ width: 1024, height: 640 });
  await expect
    .poll(async () => (await readLayout(page)).canvas.width)
    .not.toBe(initial.canvas.width);
  expectViewportContract(await readLayout(page));

  await page.setViewportSize({ width: 1366, height: 650 });
  await expect
    .poll(async () => Math.round((await readLayout(page)).canvas.width))
    .toBe(Math.round(initial.canvas.width));
  expectViewportContract(await readLayout(page));
});

test("pointer-to-world selection stays accurate after viewport changes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 650 });
  await loadSetup(page);
  await page.getByRole("button", { name: "Begin operation" }).click();
  await expect(page.locator(".economy-deck")).toBeVisible();

  await clickLogicalCanvas(page, 608, 242);
  await expect(page.locator(".selection-panel h2")).toHaveText(
    "Citadel Command Hub",
  );

  await clickLogicalCanvas(page, 640, 360);
  await expect(page.locator(".selection-panel h2")).toHaveText(
    "No asset selected",
  );

  await page.setViewportSize({ width: 1024, height: 640 });
  await expect
    .poll(async () => Math.round((await readLayout(page)).canvas.width))
    .toBe(1024);
  await clickLogicalCanvas(page, 608, 242);
  await expect(page.locator(".selection-panel h2")).toHaveText(
    "Citadel Command Hub",
  );
  expectFullBleedBattlefield(await readLayout(page));
});
