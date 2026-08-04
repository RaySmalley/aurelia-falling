import { expect, test, type Page, type TestInfo } from "@playwright/test";
import baseline from "./phase-six-baseline.json" with { type: "json" };

const VIEWPORTS = [
  { name: "laptop", width: 1366, height: 650 },
  { name: "minimum", width: 1024, height: 640 },
] as const;
const SETTINGS_KEY = "aurelia-falling.settings.v1";
const PRIMARY_HIT_TARGET_PX = 44;
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
  statusHud: Rect;
  commandDock: Rect | null;
  contextPanel: Rect | null;
  subtitle: Rect | null;
  onboarding: Rect | null;
  feedback: Rect | null;
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
    const contextPanel = document.querySelector(".context-panel");
    const subtitle = document.querySelector(".radio-subtitle");
    const onboarding = document.querySelector(".onboarding-card");
    const feedback = document.querySelector(".dock-feedback");
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
      statusHud: rect(".topbar"),
      commandDock:
        commandDock instanceof HTMLElement
          ? commandDock.getBoundingClientRect().toJSON()
          : null,
      contextPanel:
        contextPanel instanceof HTMLElement
          ? contextPanel.getBoundingClientRect().toJSON()
          : null,
      subtitle:
        subtitle instanceof HTMLElement
          ? subtitle.getBoundingClientRect().toJSON()
          : null,
      onboarding:
        onboarding instanceof HTMLElement
          ? onboarding.getBoundingClientRect().toJSON()
          : null,
      feedback:
        feedback instanceof HTMLElement
          ? feedback.getBoundingClientRect().toJSON()
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

function expectNoOverlap(first: Rect, second: Rect) {
  const overlaps = !(
    first.right <= second.left ||
    first.left >= second.right ||
    first.bottom <= second.top ||
    first.top >= second.bottom
  );
  expect(overlaps).toBe(false);
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
  expectContained(metrics.statusHud, metrics.shell);
  if (metrics.commandDock) expectContained(metrics.commandDock, metrics.shell);
  if (metrics.contextPanel) expectContained(metrics.contextPanel, metrics.shell);
}

function expectFullBleedBattlefield(metrics: LayoutMetrics) {
  expect(metrics.battlefield.left).toBeCloseTo(0, 0);
  expect(metrics.battlefield.top).toBeCloseTo(0, 0);
  expect(metrics.battlefield.right).toBeCloseTo(metrics.viewport.width, 0);
  expect(metrics.battlefield.bottom).toBeCloseTo(metrics.viewport.height, 0);
}

async function clickLogicalCanvas(
  page: Page,
  x: number,
  y: number,
  button: "left" | "right" = "left",
) {
  const canvas = page.locator(".game-host canvas");
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("Missing canvas bounds");
  await page.mouse.click(
    bounds.x + (x / LOGICAL_GAME_SIZE.width) * bounds.width,
    bounds.y + (y / LOGICAL_GAME_SIZE.height) * bounds.height,
    { button },
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

async function expectPrimaryHitTargets(page: Page) {
  for (const name of ["Settings", "Pause", "Stop [X]", "Hold [H]"]) {
    const control = page.getByRole("button", { name, exact: true });
    await expect(control).toBeVisible();
    const bounds = await control.boundingBox();
    expect(bounds).not.toBeNull();
    // Fractional zoom geometry can round below the requested CSS pixel by a
    // fraction while still occupying the full 44px device-independent target.
    expect(Math.min(bounds!.width, bounds!.height)).toBeGreaterThanOrEqual(
      PRIMARY_HIT_TARGET_PX - 0.1,
    );
  }
}

async function expectBuildHitTargets(page: Page) {
  const buttons = page.locator(".build-grid button");
  const count = await buttons.count();
  expect(count).toBeGreaterThan(0);

  for (let index = 0; index < count; index += 1) {
    const bounds = await buttons.nth(index).boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.height).toBeGreaterThanOrEqual(PRIMARY_HIT_TARGET_PX - 0.1);
  }
}

async function expectPrimaryCommandsInsideDock(page: Page) {
  const dock = page.locator(".economy-deck");
  const dockBounds = await dock.boundingBox();
  expect(dockBounds).not.toBeNull();

  for (const name of ["Stop [X]", "Hold [H]", "Center", "Zoom −", "Zoom +"]) {
    const control = page.getByRole("button", { name, exact: true });
    await expect(control).toBeInViewport();
    const bounds = await control.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(dockBounds!.x - 1);
    expect(bounds!.y).toBeGreaterThanOrEqual(dockBounds!.y - 1);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(
      dockBounds!.x + dockBounds!.width + 1,
    );
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(
      dockBounds!.y + dockBounds!.height + 1,
    );
  }
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

test("unsupported viewports block setup without introducing document scrolling", async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 700 });
  await page.goto("/");

  const notice = page.getByRole("alertdialog", {
    name: "More battlefield space required",
  });
  await expect(notice).toBeVisible();
  await expect(notice).toBeFocused();
  await expect(
    page.getByRole("button", { name: "Begin operation" }),
  ).toHaveCount(0);
  const unsupported = await page.evaluate(() => ({
    viewport: { width: window.innerWidth, height: window.innerHeight },
    document: {
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
    },
  }));
  expect(unsupported.document.width).toBeLessThanOrEqual(unsupported.viewport.width);
  expect(unsupported.document.height).toBeLessThanOrEqual(unsupported.viewport.height);

  await page.setViewportSize({ width: 1024, height: 640 });
  await expect(notice).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Begin operation" }),
  ).toBeEnabled();
  await expect(page.locator(".game-host canvas")).toBeVisible();
  expectViewportContract(await readLayout(page));
});

test("unsupported viewport curtains block queued gameplay shortcuts", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 640 });
  await loadSetup(page);
  await page.getByRole("button", { name: "Begin operation" }).click();
  await expect(page.locator(".economy-deck")).toBeVisible();
  await page.getByRole("button", { name: "Dismiss guidance" }).click();

  const canvasBounds = await page.locator(".game-host canvas").boundingBox();
  expect(canvasBounds).not.toBeNull();
  await page.mouse.move(
    canvasBounds!.x + canvasBounds!.width * 0.2,
    canvasBounds!.y + canvasBounds!.height * 0.2,
  );
  await page.mouse.down();
  await page.mouse.move(
    canvasBounds!.x + canvasBounds!.width * 0.8,
    canvasBounds!.y + canvasBounds!.height * 0.78,
  );
  await page.mouse.up();
  await expect(page.locator(".selection-summary")).toHaveText(/1 unit/);
  await page.getByRole("button", { name: "Hold [H]" }).click();
  await expect(page.locator(".selection-summary")).toHaveText(/hold/);

  await page.setViewportSize({ width: 900, height: 700 });
  await expect(
    page.getByRole("alertdialog", { name: "More battlefield space required" }),
  ).toBeVisible();
  await page.keyboard.press("X");

  await page.setViewportSize({ width: 1024, height: 640 });
  await page.getByRole("button", { name: "Resume operation" }).click();
  await expect(page.locator(".selection-summary")).toHaveText(/hold/);
});

test("settings and pause dialogs trap focus, expose names, and restore triggers", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 640 });
  await loadSetup(page);

  const settingsTrigger = page.getByRole("button", { name: "Settings" });
  await settingsTrigger.click();
  const settingsDialog = page.getByRole("dialog", {
    name: "Audio and interface",
  });
  await expect(settingsDialog).toBeVisible();
  await expect(page.getByLabel("Master volume")).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(
    page.getByRole("button", { name: "Restart onboarding" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(settingsDialog).toBeHidden();
  await expect(settingsTrigger).toBeFocused();

  await page.getByRole("button", { name: "Begin operation" }).click();
  const pauseTrigger = page.getByRole("button", { name: "Pause" });
  await pauseTrigger.click();
  const pauseDialog = page.getByRole("dialog", { name: "Skirmish paused" });
  await expect(pauseDialog).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Resume operation" }),
  ).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(
    page.getByRole("button", { name: "Match setup" }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Resume operation" }).click();
  await expect(pauseDialog).toBeHidden();
  await expect(pauseTrigger).toBeFocused();
});

test("transient guidance occupies declared safe regions at minimum size", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 640 });
  await loadSetup(page, 1.1);
  await page.getByRole("button", { name: "Begin operation" }).click();
  await expect(page.locator(".onboarding-card")).toBeVisible();
  await expect(page.locator(".radio-subtitle")).toBeVisible();

  const layout = await readLayout(page);
  expect(layout.onboarding).not.toBeNull();
  expect(layout.subtitle).not.toBeNull();
  expect(layout.commandDock).not.toBeNull();
  expectContained(layout.onboarding!, layout.shell);
  expectContained(layout.subtitle!, layout.shell);
  expectNoOverlap(layout.onboarding!, layout.statusHud);
  expectNoOverlap(layout.onboarding!, layout.commandDock!);
  expectNoOverlap(layout.onboarding!, layout.subtitle!);
  expectNoOverlap(layout.subtitle!, layout.commandDock!);
});

test("operating-system reduced-motion preference suppresses interface transitions", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1024, height: 640 });
  await loadSetup(page);
  const transitionSeconds = await page.locator(".payload-status i").evaluate(
    (element) => Number.parseFloat(getComputedStyle(element).transitionDuration),
  );
  expect(transitionSeconds).toBeLessThanOrEqual(0.000001);
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

test("wide short viewports keep every primary command inside the bottom dock", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1895, height: 640 });
  await loadSetup(page);
  await page.getByRole("button", { name: "Begin operation" }).click();
  await expect(page.locator(".economy-deck")).toBeVisible();

  expectViewportContract(await readLayout(page));
  await expectPrimaryCommandsInsideDock(page);
  await page.getByRole("button", { name: "Intel & help" }).click();
  await expect(
    page.getByRole("heading", { name: "Battlefield intel and help" }),
  ).toBeInViewport();
  expectViewportContract(await readLayout(page));
});

for (const uiScale of [0.9, 1, 1.1]) {
  test(`primary HUD targets remain 44px at ${Math.round(uiScale * 100)}% UI scale`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1024, height: 640 });
    await loadSetup(page, uiScale);
    await page.getByRole("button", { name: "Begin operation" }).click();
    await expect(page.locator(".economy-deck")).toBeVisible();
    await expectPrimaryHitTargets(page);
    await page.getByRole("button", { name: "Build structures" }).click();
    await expectBuildHitTargets(page);
  });
}

test("contextual panels preserve the Phaser runtime and restore keyboard focus", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1024, height: 640 });
  await loadSetup(page, 1.1);
  await page.getByRole("button", { name: "Begin operation" }).click();
  await expect(page.locator(".economy-deck")).toBeVisible();

  const before = await readLayout(page);
  await page.locator(".game-host canvas").evaluate((canvas) => {
    canvas.setAttribute("data-runtime-sentinel", "preserved");
  });

  const buildTrigger = page.getByRole("button", { name: "Build structures" });
  await buildTrigger.click();
  const panel = page.getByRole("dialog", { name: "Build structures" });
  await expect(panel).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Close contextual panel" }),
  ).toBeFocused();

  const open = await readLayout(page);
  expectViewportContract(open);
  expect(open.host.width).toBeCloseTo(before.host.width, 1);
  expect(open.host.height).toBeCloseTo(before.host.height, 1);
  expect(open.canvas.width).toBeCloseTo(before.canvas.width, 1);
  expect(open.canvas.height).toBeCloseTo(before.canvas.height, 1);
  await expect(page.locator('.game-host canvas[data-runtime-sentinel="preserved"]'))
    .toHaveCount(1);

  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("button", { name: "Turret" })).toBeFocused();
  await capture(page, testInfo, "minimum-110-percent-build-panel");
  await page.getByRole("button", { name: "Prometheus Reactor" }).click();
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(buildTrigger).toBeFocused();
  expectViewportContract(await readLayout(page));

  await clickLogicalCanvas(page, 1_220, 360, "right");
  await expect(page.locator(".dock-feedback")).toHaveText(
    /Placement is outside|Scorched terrain|occupies this tile|cannot be built over|requires current battlefield vision|outside connected construction radius|prerequisite is missing|Insufficient credits|only one Citadel/,
  );

  await buildTrigger.click();
  await page.getByRole("button", { name: "Pause" }).click();
  await expect(panel).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Resume operation" }),
  ).toBeVisible();
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
    expect(playing.statusHud.height).toBeLessThanOrEqual(72);
    expect(playing.commandDock!.height).toBeLessThanOrEqual(
      playing.viewport.height * 0.28,
    );
    await expect(page.getByLabel("Economy status")).toBeVisible();
    await expect(page.locator(".selection-summary")).toHaveText(
      "Awaiting selection",
    );
    await expectPrimaryHitTargets(page);
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
  await expect(page.locator(".compact-selection h2")).toHaveText(
    "Citadel Command Hub",
  );

  await clickLogicalCanvas(page, 640, 360);
  await expect(page.locator(".compact-selection h2")).toHaveText(
    "No asset selected",
  );

  await page.setViewportSize({ width: 1024, height: 640 });
  await expect
    .poll(async () => Math.round((await readLayout(page)).canvas.width))
    .toBe(1024);
  await clickLogicalCanvas(page, 608, 242);
  await expect(page.locator(".compact-selection h2")).toHaveText(
    "Citadel Command Hub",
  );
  expectFullBleedBattlefield(await readLayout(page));
});

test("browser fullscreen transitions preserve canvas bounds and pointer mapping", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 650 });
  await loadSetup(page);
  await page.getByRole("button", { name: "Begin operation" }).click();
  await expect(page.locator(".economy-deck")).toBeVisible();

  await page.locator(".game-host canvas").click({ position: { x: 1, y: 1 } });
  await page.evaluate(() => document.documentElement.requestFullscreen());
  await expect
    .poll(() => page.evaluate(() => Boolean(document.fullscreenElement)))
    .toBe(true);
  expectViewportContract(await readLayout(page));
  expectFullBleedBattlefield(await readLayout(page));

  await clickLogicalCanvas(page, 608, 242);
  await expect(page.locator(".compact-selection h2")).toHaveText(
    "Citadel Command Hub",
  );

  await page.evaluate(() => document.exitFullscreen());
  await expect
    .poll(() => page.evaluate(() => Boolean(document.fullscreenElement)))
    .toBe(false);
  expectViewportContract(await readLayout(page));
  expectFullBleedBattlefield(await readLayout(page));
});
