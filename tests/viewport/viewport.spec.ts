import { expect, test, type Page, type TestInfo } from "@playwright/test";
import baseline from "./phase-six-baseline.json" with { type: "json" };

const VIEWPORTS = [
  { name: "laptop", width: 1366, height: 650 },
  { name: "minimum", width: 1024, height: 640 },
] as const;

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
};

async function loadSetup(page: Page) {
  await page.addInitScript(() => localStorage.clear());
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Begin operation" })).toBeEnabled();
  await expect(page.locator(".game-host canvas")).toBeVisible();
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

async function capture(page: Page, testInfo: TestInfo, state: string) {
  await page.screenshot({
    path: testInfo.outputPath(
      `${testInfo.project.name || "chromium"}-${state}.png`,
    ),
    fullPage: true,
  });
}

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
    await capture(page, testInfo, `${viewport.name}-setup`);

    await page.getByRole("button", { name: "Begin operation" }).click();
    await expect(page.locator(".economy-deck")).toBeVisible();
    await expect
      .poll(async () => (await readLayout(page)).canvas.height)
      .toBeLessThan(setup.canvas.height);

    const playing = await readLayout(page);
    expectViewportContract(playing);
    expect(playing.canvas.height).toBeGreaterThanOrEqual(180);
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
