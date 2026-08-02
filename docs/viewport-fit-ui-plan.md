# Viewport-Fit UI Refactor Plan

## Status

Implemented foundation for making Aurelia Falling behave like a fixed-height
game application rather than a vertically scrolling web page. Its work was
sequenced as Phases 7-8 of the
[current development roadmap](./development-roadmap.md).

The three-region header, battlefield, and bounded-dock architecture in this
document records the completed baseline, but it is no longer the intended final
presentation. Phase 9A replaces the active-game composition with a full-bleed
battlefield and overlay HUD. See the
[full-bleed battlefield and overlay HUD plan](./full-bleed-battlefield-ui-plan.md).

This is a presentation and runtime-integration refactor. It must preserve the
deterministic simulation, command queue, read-only snapshots, client-only
Phaser boundary, and existing gameplay rules.

## Objective

Keep the complete active-game interface inside the browser viewport at every
supported desktop size and UI scale.

The document itself must not scroll during setup or gameplay. If a panel has
more content than its allocated area, overflow must be handled inside that
panel without moving the battlefield, header, or primary command controls out
of view.

## Current baseline

Measurements taken on July 20, 2026 at 100% UI scale show that the current
layout exceeds the viewport after a match starts:

| Browser viewport | Setup document height | Playing document height | Playing overflow |
| --- | ---: | ---: | ---: |
| 1920 x 1080 | 1080 px | 1284 px | 204 px |
| 1440 x 900 | 942 px | 1254 px | 354 px |
| 1366 x 768 | 901 px | 1224 px | 456 px |
| 1280 x 720 | 849 px | 1172 px | 452 px |
| 1024 x 768 | 768 px | 1098 px | 330 px |
| 900 x 700 | 700 px | 1403 px | 703 px |

The 1366 x 768 case requires almost 60% of the viewport height in additional
scrolling during play. A browser running on a 1366 x 768 display also has less
than 768 CSS pixels available after browser chrome, making the practical
laptop case worse than this table.

## Root causes

### The outer shell is minimum-height, not viewport-bounded

`app/globals.css` gives `.operations-shell` `min-height: 100vh` and grid rows
of `auto minmax(350px, 1fr) auto`. The shell is free to grow when the
battlefield or command HUD contributes a larger intrinsic height.

### The battlefield has competing intrinsic constraints

`.battlefield-frame`, `.game-host`, and the Phaser canvas have a 420 px minimum
height. The host and canvas are also forced to `width: 100%` and `height: 100%`
by CSS.

Phaser is configured as a fixed 1280 x 720 game using `Phaser.Scale.FIT`.
Because the parent row does not have a firm available height, the 16:9 canvas
can use the shell width to establish a large intrinsic height and expand the
grid.

Phaser 4's ScaleManager documentation also warns against styling the canvas
dimensions directly because the manager owns the canvas display size and input
coordinate transformation.

### The command HUD has no height budget

The economy deck is an auto-height grid. It is approximately 323 px tall at
1366 px wide and grows with selected-asset, production, Solar Spear, and
telemetry content.

At the current 900 px breakpoint, all three HUD columns stack vertically. This
increases the deck to roughly 741 px before accounting for the header or
battlefield.

### UI scaling enlarges the entire application

The accessibility UI-scale setting is applied through CSS `zoom` on the outer
shell. A 110% setting enlarges the shell's geometry as well as its contents,
which works against a fixed viewport contract and can introduce horizontal and
vertical overflow.

### Responsive rules consider width but not height

The current media queries change layout at 900 px and 520 px widths. There are
no compact modes for short laptop viewports, browser chrome, fullscreen
transitions, or landscape windows with limited height.

## Supported viewport contract

### Full gameplay

The minimum supported interactive gameplay viewport will be 1024 x 640 CSS
pixels in landscape orientation.

The release matrix must include:

| Tier | Viewports | Required UI scales |
| --- | --- | --- |
| Minimum | 1024 x 640 | 90%, 100%, 110% |
| Laptop browser | 1366 x 650 and 1366 x 768 | 90%, 100%, 110% |
| Standard desktop | 1280 x 720 and 1440 x 900 | 90%, 100%, 110% |
| Large desktop | 1920 x 1080 | 90%, 100%, 110% |

The 1366 x 650 case represents a typical 1366 x 768 display after browser
chrome and is the primary release baseline.

### Below the gameplay minimum

Viewports below 1024 x 640 or in portrait orientation will show a fixed,
non-scrolling viewport notice that asks the player to enlarge the window, use
landscape orientation, or enter fullscreen. The notice must remain usable by
keyboard and must not start a match behind an unusable interface.

A complete mobile and portrait RTS control redesign is outside this plan.

## Architectural invariants

Every phase must preserve these rules:

- Commands enter the fixed-step simulation through its queue.
- React and Phaser consume read-only snapshots and events.
- Layout and resize events do not mutate simulation state.
- Simulation timing remains tick-based and deterministic.
- Phaser stays behind the existing client-only dynamic import.
- Server-rendered modules do not import Phaser.
- Camera and pointer-coordinate behavior remain correct after every resize.
- UI scaling changes presentation only; it cannot change the game world,
  simulation values, or command ordering.

## Target layout architecture

> Historical baseline: this architecture solved document overflow and remains
> useful context for the current implementation. It is superseded as the
> active-game product target by the full-bleed battlefield plan.

The shell will have three viewport-bounded regions:

```text
+---------------------------------------------------------------+
| Compact status and match header                               |
+---------------------------------------------------------------+
|                                                               |
| Flexible battlefield; consumes all remaining height           |
|                                                               |
+---------------------------------------------------------------+
| Bounded command dock with fixed actions and internal panels   |
+---------------------------------------------------------------+
```

The outer document will not be used as an overflow container.

- Header height is content-driven but has a compact short-viewport mode.
- Battlefield uses `minmax(0, 1fr)` and may shrink below the current 420 px
  minimum.
- Command dock receives a bounded height derived from viewport height.
- Long build, production, selection, or telemetry content scrolls inside its
  own panel.
- Primary commands, current selection identity, and critical warnings remain
  visible without panel scrolling.
- Overlays such as setup, pause, settings, results, onboarding, subtitles, and
  Solar Spear warnings remain contained inside the battlefield region.

## Phase 0: Add the viewport contract and failing measurements

### Objective

Make document overflow a measurable release condition before changing the
layout.

### Work

- Add a browser-driven viewport test suite for the complete release matrix.
- Test setup and active-game states separately.
- Exercise every supported UI scale through the visible settings control.
- Record the bounding rectangles of the shell, header, battlefield, canvas,
  command dock, and active overlay.
- Assert that document scroll height and width do not exceed the viewport.
- Assert that the canvas remains completely inside the battlefield frame.
- Capture screenshots for the laptop baseline in setup and active play.
- Check in a machine-readable baseline showing the current failures.

### Acceptance gates

- The suite reliably reproduces the current overflow.
- Failures report the viewport, UI scale, application state, and offending
  element rather than only a screenshot difference.
- Tests use the production build on port 4000 and Node.js 24.18.0.

## Phase 1: Establish a fixed-height application shell

### Objective

Make the viewport, rather than child content, authoritative for application
height.

### Work

- Give `html`, `body`, and the application root explicit block-size ownership.
- Change `.operations-shell` from `min-height: 100vh` to a bounded `100dvh`
  layout with a `100vh` fallback.
- Set `min-width: 0` and `min-height: 0` on grid children that must be allowed
  to shrink.
- Change the shell rows to `auto minmax(0, 1fr) auto`.
- Remove the 420 px minimum height from the battlefield and game host.
- Keep document overflow visible during implementation so accidental clipping
  remains detectable.
- Apply `overflow: hidden` to the application document only after all supported
  layouts pass without concealed content.
- Account for safe-area insets when calculating outer padding.

### Acceptance gates

- Setup fits at every supported viewport without document scrolling.
- The battlefield row shrinks when the header or dock needs more room.
- No setup, pause, settings, result, or error overlay is clipped.
- Keyboard focus never moves to an offscreen document region.

## Phase 2: Contain Phaser inside the battlefield row

### Objective

Let the CSS grid allocate battlefield space and let Phaser fit inside that
space without pushing the grid larger.

### Preferred strategy

Preserve the 1280 x 720 logical game and `Phaser.Scale.FIT` first. This keeps
the current camera framing and world-coordinate contract while allowing
letterboxing or pillarboxing inside a sized parent.

### Work

- Give `.game-host` an explicit `width: 100%`, `height: 100%`,
  `min-width: 0`, `min-height: 0`, and an appropriate letterbox background.
- Remove external width, height, and minimum-height rules from the Phaser
  canvas. Phaser's ScaleManager must own canvas display sizing.
- Move the base width and height into the `scale` configuration so the complete
  scaling contract is expressed in one place.
- Set the scale parent explicitly to the host element.
- Evaluate `expandParent: false` so Phaser cannot enlarge the grid row.
- Retain `Phaser.Scale.FIT` and `Phaser.Scale.CENTER_BOTH`.
- Confirm ScaleManager refreshes promptly after shell, fullscreen, and UI mode
  changes. If browser tests expose stale bounds, observe the host and call
  `game.scale.refresh()`; do not use `resize()` with `FIT`.
- Verify ScaleManager's transformed pointer coordinates after every supported
  resize.

### Fallback spike

If a bounded `FIT` canvas makes the battlefield unacceptably small at the
minimum viewport, evaluate Phaser 4's `EXPAND` mode in a separate commit.
`RESIZE` is the last option because it changes game and camera dimensions and
can increase GPU fill rate.

Any move away from `FIT` requires explicit tests for:

- Camera center, zoom, and edge clamping.
- Drag selection and selection-box coordinates.
- Move, attack, attack-move, rally, placement, and Solar Spear targeting.
- Fog render-texture dimensions and visibility alignment.
- Screen shake and overlay positioning.
- Renderer snapshots and asset sharpness.

### Acceptance gates

- The canvas never changes the shell's computed height.
- The canvas remains centered and fully contained without cropping under
  `FIT`.
- Pointer input targets the same grid location before and after resize.
- Camera zoom and movement remain stable through repeated viewport changes.
- No Phaser 3 plugin or unverified Phaser 3 scaling idiom is introduced.

## Phase 3: Replace whole-shell zoom with bounded UI scaling

### Objective

Preserve the 90%, 100%, and 110% accessibility choices without scaling the
application outside the viewport.

### Work

- Remove `zoom: var(--ui-scale)` from `.operations-shell`.
- Introduce typography, control-size, spacing, and icon-size tokens derived
  from the selected UI scale.
- Apply those tokens inside the header, command dock, overlays, and buttons
  while leaving the outer grid dimensions fixed.
- Use bounded `clamp()` values so 110% text remains readable without forcing
  every panel to grow proportionally.
- Let affected internal panels scroll when enlarged content cannot fit.
- Keep focus rings, minimum pointer targets, and text equivalents intact.

### Acceptance gates

- Changing UI scale never introduces document-level horizontal or vertical
  scrolling.
- All text remains readable and all controls remain reachable at 110%.
- The battlefield keeps the same allocated rectangle when only UI scale
  changes, except where a documented compact-mode transition is required.
- Camera zoom remains independent from UI scale.

## Phase 4: Redesign the command deck as a bounded dock

### Objective

Fit all primary RTS interactions into a predictable height budget.

### Standard-width mode

- Keep the construction, selection/production, and controls regions in three
  columns.
- Reduce repeated headings, explanatory text, and vertical padding in short
  viewports.
- Keep high-frequency actions pinned while allowing detail lists to scroll.
- Collapse low-frequency telemetry behind a compact disclosure or secondary
  view.
- Keep Solar Spear status visible as a compact strip rather than a block that
  can increase the dock's intrinsic height.

### Compact-width mode

Replace the current vertical stacking behavior with a tabbed or segmented dock:

- Build
- Selection and production
- Orders and telemetry

The active tab owns the dock body while global resource status, critical
warnings, and primary unit orders remain visible.

Tab state is presentation-only React state. It must not enter or affect the
simulation.

### Height modes

Add height-based media or container queries:

- Normal: at least 800 px high.
- Compact: 650-799 px high.
- Minimum: 640-649 px high.

Shorter modes reduce decorative spacing and secondary copy before reducing
control size or hiding gameplay-critical information.

### Acceptance gates

- The dock stays inside its allocated row for every tested selection and queue
  state.
- Selecting a structure with the largest production list does not resize the
  document.
- Long production queues, placement failures, and Solar Spear failures remain
  accessible.
- Compact-width mode does not stack all three full panels vertically.
- Keyboard users can enter, operate, and leave every tab or internal scroll
  region.

## Phase 5: Harden overlays and exceptional states

### Objective

Ensure temporary UI states cannot break the viewport contract.

### Work

- Test setup with every difficulty and the longest localized labels supported
  by the current release.
- Constrain settings content to the battlefield and add internal scrolling when
  necessary.
- Keep pause and result actions visible at minimum height.
- Reposition onboarding guidance so it does not cover required controls.
- Bound subtitles and Solar Spear warnings to safe overlay regions.
- Verify fatal-load and runtime-retry states.
- Add a viewport-too-small notice below the supported minimum.
- Consider a user-initiated fullscreen action from setup using Phaser 4's
  fullscreen APIs only if product design approves it; fullscreen must remain
  optional.

### Acceptance gates

- Every overlay fits or scrolls internally at the minimum supported viewport.
- Critical alerts do not overlap one another or become unreachable.
- Entering or leaving fullscreen does not leave stale canvas bounds.
- The unsupported-viewport notice has no page scrolling and prevents starting
  an unusable match.

## Phase 6: Verification and release

### Automated matrix

For each supported viewport and UI scale, verify:

- Setup before runtime readiness.
- Setup after runtime readiness.
- Active play with onboarding visible.
- Active play with a unit selected.
- Active play with a production structure and populated queue selected.
- Build placement and placement-error states.
- Solar Spear charging, ready, targeting, warning, and failure states.
- Pause, settings, victory, defeat, draw, surrender, and fatal-load states.

Required layout assertions:

```text
document.documentElement.scrollHeight <= window.innerHeight
document.documentElement.scrollWidth <= window.innerWidth
battlefield bounds are inside operations-shell bounds
canvas bounds are inside battlefield bounds
command-dock bounds are inside operations-shell bounds
active dialog or overlay actions are visible and keyboard reachable
```

### Project verification

Run with Node.js 24.18.0:

```text
npm run test:unit
npm run typecheck
npm run lint
npm run build
npm run test:viewport
graphify update .
```

Manual verification must include current Chrome, Edge, Firefox, and Safari at
the laptop baseline. Record the browser version, operating system, device-pixel
ratio, viewport, UI scale, and whether the browser is fullscreen.

### Delivery

This is a substantial multi-file UI and Phaser integration change. Implement
it on a `codex/*` branch and merge it through a pull request.

After merge:

1. Fast-forward local `main` to the merged `origin/main`.
2. Re-run the production build on the exact merged commit.
3. Synchronize that exact commit to the Sites source repository.
4. Save and deploy one Sites version for that commit.
5. Poll the deployment to a terminal state and verify the production URL.

## Recommended pull-request sequence

### PR 1: Contract, shell, and Phaser containment

- Add viewport tests and failing baseline.
- Establish the fixed `100dvh` shell.
- Remove direct canvas sizing CSS.
- Contain `Phaser.Scale.FIT` inside the battlefield.
- Make setup and the standard-width active game pass at 100% scale.

### PR 2: Command dock and UI scaling

- Replace whole-shell CSS zoom.
- Add bounded UI-scale tokens.
- Refactor the command deck into fixed and internally scrollable regions.
- Add height-based compact modes.
- Pass the full desktop matrix at 90%, 100%, and 110%.

### PR 3: Compact widths, overlays, and hardening

- Add the compact tabbed dock.
- Add the unsupported-viewport notice.
- Harden settings, onboarding, result, warning, and error overlays.
- Complete cross-browser and Sites production verification.

Each pull request must leave the game deployable and must not merge with a
known document-scroll regression at a viewport that the pull request claims to
support.

## Key risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Canvas CSS and ScaleManager fight over dimensions | Remove direct canvas sizing and give Phaser a sized, padding-free parent |
| Pointer coordinates drift after resizing | Test every targeting mode and rely on ScaleManager display bounds and transforms |
| A shorter battlefield harms playability | Preserve `FIT` first, measure the minimum battlefield, and evaluate `EXPAND` separately |
| `RESIZE` increases GPU cost | Avoid it unless required; benchmark fill rate before adopting it |
| UI scale hides controls | Scale internal tokens, keep the shell fixed, and allow panel-local overflow |
| Internal scrolling harms keyboard access | Keep primary controls pinned and test focus entry, traversal, and exit |
| Dynamic browser chrome changes `dvh` | Test laptop browser and mobile-toolbar transitions; retain a `vh` fallback |
| Hiding document overflow conceals defects | Apply overflow locking only after geometric assertions pass |
| Narrow layouts become a tall stack | Replace stacking with a single active dock panel |
| Layout work changes simulation behavior | Keep all responsive state in React/CSS and compare deterministic tests unchanged |

## Definition of done

The refactor is complete when:

- The document has no horizontal or vertical scrolling in every supported
  setup, gameplay, overlay, viewport, and UI-scale combination.
- All required controls remain visible or reachable through an explicitly
  bounded internal panel.
- Phaser remains fully contained, correctly centered, and input-accurate.
- The minimum supported gameplay viewport is documented and enforced.
- Unsupported viewports receive a usable, non-scrolling notice.
- Unit tests, viewport tests, type checking, linting, the production build, and
  Graphify update pass.
- The exact merged commit is deployed successfully to Sites.
