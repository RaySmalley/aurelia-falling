# Full-Bleed Battlefield and Overlay HUD Plan

## Status

Approved product-direction change following the completed Phase 7-9 presentation
baseline.

The existing fixed-height shell, Phaser containment, viewport testing, and
bounded-overflow work remain valid foundations. The three-region presentation
of permanent header, battlefield row, and permanent command dock is no longer
the intended final game screen.

This plan is assigned to Phase 9A of the
[development roadmap](./development-roadmap.md).

## Product decision

During active play, the battlefield is the primary application surface and
fills the available browser viewport. Persistent status and command UI is
layered over that surface instead of reserving separate page rows that reduce
the visible map.

Browser fullscreen remains optional and user initiated. "Full-bleed" means the
battlefield fills the application viewport whether the browser itself is
windowed or fullscreen.

## Goals

- Make the game read as an RTS battlefield rather than a web dashboard
  containing a game window.
- Maximize useful map area at every supported landscape viewport.
- Keep high-frequency commands, resources, selection state, alerts, and match
  actions immediately readable and reachable.
- Let low-frequency and detailed information expand on demand without
  permanently obscuring the map.
- Preserve the existing deterministic simulation, command queue, immutable
  snapshot, client-only Phaser, accessibility, and viewport contracts.

## Non-goals

- Do not make browser fullscreen mandatory.
- Do not move simulation authority into React or Phaser UI state.
- Do not redesign the map, simulation coordinates, camera rules, or gameplay
  values as part of this presentation change.
- Do not hide required controls behind hover-only interactions.
- Do not treat mobile portrait play as supported RTS gameplay.

## Target layout architecture

```text
+-----------------------------------------------------------------------+
| RESOURCE / MATCH STATUS OVERLAY                     SETTINGS / PAUSE   |
|                                                                       |
|                                                                       |
|                    FULL-BLEED BATTLEFIELD                             |
|                                                                       |
|                                                                       |
| CONTEXT / ALERTS                                                      |
| [BUILD] [SELECTION / PRODUCTION] [ORDERS]      COLLAPSIBLE COMMAND HUD |
+-----------------------------------------------------------------------+
```

The Phaser host owns the full application rectangle. React HUD surfaces share
the same containing layer and sit above it in explicitly defined safe regions.
The battlefield remains visible behind translucent or opaque-backed controls;
decorative chrome must not create an inset "window" around the canvas.

### Persistent HUD

- A compact top status strip shows resources, power, Solar Spear state, match
  identity, settings, and pause.
- A compact bottom command strip shows the current selection identity and
  high-frequency build or order actions.
- Critical alerts use bounded safe regions and never cover required controls.
- Persistent surfaces consume the smallest practical footprint and use
  readable backing treatments rather than relying on the battlefield color for
  contrast.

### Contextual and expandable HUD

- Build catalogs, production queues, detailed statistics, telemetry, and help
  expand from the appropriate edge or command strip.
- Only one large detail surface is open by default. Opening another replaces or
  collapses the previous surface unless the viewport has measured room.
- Expanded surfaces may scroll internally and must have an obvious close or
  collapse action.
- Pointer and keyboard users can open, operate, and dismiss every surface.
- Empty selection returns the HUD to a minimal state instead of reserving a
  large blank panel.

### Full-screen overlays

Setup, pause, settings, results, fatal errors, and the unsupported-viewport
notice remain modal overlays. Onboarding, subtitles, placement failures, and
Solar Spear targeting guidance use non-modal safe regions during play.

## Battlefield and camera contract

- The battlefield host uses the complete shell rectangle, with no permanent
  header or command rows subtracting from its dimensions.
- Preserve the 1280 x 720 logical game and `Phaser.Scale.FIT` for the first
  implementation slice.
- Letterboxing is acceptable only when required by the logical aspect ratio; it
  must not be compounded by decorative outer padding or a shell max-width.
- Evaluate `EXPAND` only if measured viewport use remains unsatisfactory after
  the full-bleed host is implemented.
- HUD geometry does not alter simulation coordinates or command results.
- Camera clamping, zoom, pointer transforms, drag selection, placement, rally,
  attack, and Solar Spear targeting must remain correct after resize,
  HUD expansion, and browser fullscreen transitions.
- Where an overlay covers the battlefield, camera framing may account for a
  declared visual safe area, but the world renderer continues beneath the HUD.

## Responsive behavior

The existing 1024 x 640 minimum interactive landscape viewport and 1366 x 650
laptop baseline remain the release contract.

- Wide and tall viewports may show more command detail without changing the
  full-bleed battlefield.
- Short viewports reduce decorative spacing and secondary copy before reducing
  control size.
- Narrow supported viewports use one active command category at a time.
- Viewports below the gameplay minimum or in portrait show the existing fixed
  unsupported-viewport notice.
- UI scale changes typography and control tokens without reintroducing a shell
  max-width, document scrolling, or permanent map shrinkage.

## Implementation sequence

### Slice 1: Full-bleed shell and battlefield

- Replace the three-row active-game grid with one viewport-sized layered stage.
- Remove the active-game shell max-width, decorative outer padding, and framed
  battlefield treatment.
- Keep setup visually intentional while sharing the same full-bleed stage.
- Make the Phaser host fill the stage and refresh ScaleManager from measured
  host bounds when required.
- Add viewport assertions for battlefield coverage, document overflow, and
  correct pointer transforms.

### Slice 2: Persistent overlay HUD

- Convert the top bar into a compact battlefield overlay.
- Convert high-frequency selection and command actions into a compact bottom
  overlay.
- Define shared HUD safe-area, contrast, focus, and hit-target tokens.
- Keep resources, power, Solar Spear readiness, selection identity, and primary
  orders visible without opening a detail surface.

### Slice 3: Contextual panels

- Move build catalogs, production queues, asset details, telemetry, and help
  into collapsible edge or bottom panels.
- Preserve presentation-only tab and expansion state in React.
- Add internal scrolling and complete keyboard focus management.
- Ensure opening and closing panels does not recreate the Phaser runtime or
  mutate simulation state.

### Slice 4: Overlay hardening and release

- Reposition onboarding, subtitles, warnings, placement feedback, and targeting
  guidance into tested safe regions.
- Verify pause, settings, results, setup, error, and viewport notices.
- Test the complete viewport and UI-scale matrix in windowed and browser
  fullscreen modes.
- Validate reduced motion, contrast, keyboard traversal, focus restoration, and
  screen-reader names.

## Acceptance gates

- During active play, the battlefield reaches all four application viewport
  edges except unavoidable aspect-ratio letterboxing and safe-area insets.
- No decorative shell width cap, outer padding, permanent header row, or
  permanent command row makes the battlefield appear as a separate embedded
  window.
- The battlefield remains visibly dominant with every contextual panel closed.
- Resources, power, Solar Spear state, current selection, critical alerts, and
  primary orders remain immediately visible or one explicit action away.
- Opening the largest build list, production queue, or telemetry view does not
  resize the document or Phaser game.
- Every HUD surface is keyboard reachable, internally bounded, dismissible, and
  usable at 110% UI scale.
- The document never scrolls at any supported viewport, UI scale, or tested
  application state.
- Pointer-to-world commands remain accurate before and after viewport, HUD, UI
  scale, and fullscreen changes.
- Deterministic tests and replay hashes remain unchanged.
- Unit tests, viewport tests, type checking, linting, production build, and
  Graphify update pass before completion.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| HUD obscures tactical information | Keep persistent surfaces compact, provide measured safe regions, and allow contextual panels to collapse |
| Battlefield contrast makes text unreadable | Give HUD surfaces consistent opaque or blurred backing, borders, and tested contrast |
| Overlay captures map input accidentally | Define explicit pointer-event boundaries and test map input around every HUD edge |
| Panel changes produce stale canvas bounds | Size Phaser from the stage, not HUD content, and verify ScaleManager refresh behavior |
| Camera framing hides action under a large panel | Declare visual safe areas and adjust presentation-only camera framing where justified |
| Accessibility is lost in an immersive layout | Preserve semantic React controls, focus order, focus restoration, keyboard dismissal, and non-hover access |
| Full-bleed is confused with mandatory browser fullscreen | Keep browser fullscreen optional and test the same layout in ordinary windowed view |

## Definition of done

The change is complete when active play presents a viewport-filling battlefield
with a compact, accessible overlay HUD; detailed controls expand contextually;
the old embedded-window appearance is gone; and all viewport, input,
determinism, accessibility, build, and deployment gates pass.
