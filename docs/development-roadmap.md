# Aurelia Falling Development Roadmap

## Status

Current canonical roadmap following completion of Phases 7-11 and all Phase 9A
presentation slices. Phase 12 is active: its versioned runtime protocol,
in-process comparison adapter, dedicated worker transport, and checkpoint
parity tests are implemented, while live-client ownership and the remaining
performance gates remain.

This document defines the order of the remaining phases. Detailed technical
design remains in the supporting plans:

- [Initial v1 implementation plan](./initial-v1-implementation-plan.md)
- [Viewport-fit UI refactor plan](./viewport-fit-ui-plan.md)
- [Full-bleed battlefield and overlay HUD plan](./full-bleed-battlefield-ui-plan.md)
- [Player UI upgrade plan](./ui-upgrade-plan.md)
- [Four-player scaling plan](./four-player-scaling-plan.md)
- [TypeScript 7 adoption plan](./typescript-7-adoption-plan.md)

When a supporting plan and this roadmap differ on sequencing, this roadmap is
authoritative. The supporting plan remains authoritative for detailed work and
acceptance criteria inside its assigned phase.

## Current baseline

The implemented release through Phase 11, plus the first two Phase 12 slices,
provides:

- A deterministic 20 Hz two-player simulation on the 64 x 64 Golden Scar map.
- Six units, seven structures, economy, power, production, repairs, selling,
  fog of war, stale structure memory, combat, AI, and Solar Spear resolution.
- Easy, Normal, and Hard pacing profiles derived from one rules-legal Normal
  AI.
- A React command interface around a client-only Phaser 4.2.1 renderer.
- A fixed-height browser shell, contained Phaser canvas, bounded command dock,
  internal overflow regions, and supported 90-110% UI scaling.
- A full-bleed active battlefield with compact persistent overlays, one bounded
  contextual panel, tested safe regions, and blocking-state input isolation.
- Validated unit, structure, terrain, decal, and Aurelite atlases with
  procedural missing-asset fallbacks.
- Atlas-derived structure portraits, construction/damage treatment, stale fog
  silhouettes, and friendly Harvester cargo meters.
- Setup key art, synthesized audio, settings, and onboarding.
- Deterministic entity indices, bounded spatial queries, maintained stable
  iteration views, and checked-in headless performance evidence.
- A budgeted live path-request queue across formation movement, combat chasing,
  AI movement, harvesting, and rally orders, including deterministic caching
  and replay state.
- Runtime protocol version 1 and a Node-compatible in-process adapter with
  intended-tick command ordering, fixed snapshot cadence, pause/resume,
  termination, validation, and structured errors.
- A dedicated worker host and browser transport with a worker-owned 20 Hz
  clock, plus actual Node worker-thread parity, stall, and failure tests.
- A production build and deployment path through Sites.

The next work begins from the remaining scale limits:

- The Phaser-owned clock still owns the live simulation. Phase 12 must integrate
  the proven worker transport into the gameplay shell and close its performance
  and recovery gates.
- The runtime still publishes full object-graph snapshots. Phase 13 introduces
  versioned deltas and scalable presentation channels.
- The simulation remains a two-player world model despite its larger-army
  performance foundations.
- Player identity, visibility, victory, and setup flows assume two sides.
- Multiplayer transport and desynchronization recovery do not exist.

## Product direction

Near-term work prioritizes the quality and usability of the existing
single-player release before expanding its simulation envelope. Performance
foundations come before four-player rules, and the generalized local world
model comes before networking.

The main player UI upgrade follows the stable worker and delta-presentation
contracts in Phases 12-13 and precedes the four-player match experience in
Phase 14. UX inventory, screenshot baselines, design tokens, and isolated
low-risk usability fixes may proceed earlier, but the command-interface
restructure must not race the snapshot protocol it will consume.

The roadmap targets:

| Dimension | Normal target | Stress target |
| --- | ---: | ---: |
| Players | 1-4 human or AI slots | 4 active slots |
| Units | 600 total | 1,000 total |
| Live simulation objects | 1,000 total | 1,500 total |
| Map | 128 x 128 tiles | 192 x 192 tiles |
| Simulation rate | Deterministic 20 Hz | Deterministic 20 Hz |
| Simulation time | p95 below 10 ms | p95 below 25 ms |
| Render rate | 60 FPS | At least 30 FPS during sustained battles |
| Match duration | 60 minutes | 120-minute soak |

The stress target is a release guardrail, not the recommended balance point.

## Architectural invariants

Every phase must preserve these rules:

- Commands enter the fixed-step simulation through a queue.
- A seed and ordered command stream produce deterministic simulation results.
- Gameplay uses integer ticks and deterministic data, not wall-clock time or
  `Math.random()`.
- Entity and request iteration that can affect outcomes uses an explicit stable
  order.
- React and Phaser consume read-only snapshots and events.
- Layout, animation, rendering performance, and UI scale cannot change
  simulation outcomes.
- Phaser remains client-only, dynamically imported, and isolated from
  server-rendered modules.
- New Phaser work uses Phaser 4.2.1 APIs verified against the version-matched
  skills under `node_modules/phaser/skills/`.
- Rendering and simulation types remain framework-independent where they cross
  runtime boundaries.
- Node.js 24.18.0 remains the required development and verification runtime
  until a separately reviewed toolchain plan changes it.

## Delivery rules

Each phase is a large change and must use a `codex/*` branch and pull request.
A phase may be split into several pull requests, but each merge must leave the
game deployable and preserve all invariants.

Every phase ends with:

```text
npm run test:unit
npm run typecheck
npm run lint
npm run build
graphify update .
```

Add phase-specific browser, performance, replay, asset, or network checks to
that common gate. After every merge into `main`, synchronize the exact merged
commit to Sites, save one version for that commit, deploy it, poll to a terminal
state, and verify the production URL.

## Phase 7: Viewport contract and Phaser containment

### Objective

Turn the browser shell into a fixed-height game application and make the
viewport, rather than child content, authoritative for layout height.

### Work

- Add browser-driven viewport measurements for setup and active play.
- Establish 1024 x 640 as the minimum interactive landscape viewport.
- Treat 1366 x 650 as the primary laptop-browser release baseline.
- Test 90%, 100%, and 110% UI scales across the complete release matrix.
- Give the shell a bounded `100dvh` layout with a `100vh` fallback.
- Use rows for the compact header, `minmax(0, 1fr)` battlefield, and bounded
  command region.
- Remove the 420 px intrinsic minimum from the battlefield and game host.
- Give Phaser a sized, padding-free parent that cannot enlarge the grid row.
- Remove external canvas sizing that conflicts with Phaser's ScaleManager.
- Preserve the 1280 x 720 logical game and `Phaser.Scale.FIT` first.
- Configure the scale parent explicitly, evaluate `expandParent: false`, and
  use `game.scale.refresh()` if host-size observation proves necessary.
- Verify camera clamping, zoom, pointer transformation, drag selection,
  placement, rally, attack, and Solar Spear targeting after resize.
- Show a fixed, non-scrolling viewport notice below the supported minimum or in
  portrait orientation.

### Acceptance gates

- Setup and active play do not introduce document-level horizontal or vertical
  scrolling at the supported 100% scale matrix.
- The canvas remains centered and completely inside the battlefield.
- Repeated viewport and fullscreen changes do not produce stale canvas bounds.
- Pointer commands select the same world location before and after resize.
- The unsupported-viewport notice prevents starting an unusable match.

### Detailed plan

See Phases 0-2 of the
[viewport-fit UI refactor plan](./viewport-fit-ui-plan.md).

## Phase 8: Bounded command dock, UI scaling, and overlay hardening

### Objective

Keep every gameplay control visible or reachable inside the fixed viewport at
all supported UI scales and application states.

### Work

- Remove whole-shell CSS `zoom`.
- Replace it with bounded typography, spacing, icon, and control-size tokens.
- Redesign the economy deck as a height-budgeted command dock.
- Keep high-frequency commands and critical status visible while allowing
  detail panels to scroll internally.
- Compact Solar Spear status so it cannot enlarge the dock.
- Replace narrow-width vertical stacking with Build, Selection/Production, and
  Orders/Telemetry dock tabs.
- Add normal, compact, and minimum height modes.
- Keep the command dock absent throughout pre-match setup.
- Constrain settings, pause, results, onboarding, subtitles, warnings, and
  fatal-load UI to the battlefield or their own bounded overlay.
- Test keyboard entry, traversal, and exit for every tab and internal overflow
  region.
- Add automated document and element-bound assertions for all supported
  viewports and UI scales.

### Acceptance gates

- The document does not scroll in any supported setup, gameplay, overlay, or
  UI-scale combination.
- Selecting the largest structure, production list, or queue does not resize
  the application.
- All text and controls remain usable at 110% UI scale.
- Compact mode never stacks all complete command panels vertically.
- Critical warnings and actions remain visible and keyboard reachable.

### Detailed plan

See Phases 3-6 of the
[viewport-fit UI refactor plan](./viewport-fit-ui-plan.md).

## Phase 9: Battlefield art and operational readability

### Objective

Complete the battlefield's visual language after its final display dimensions
are stable, while preserving clear gameplay state and procedural fallbacks.

### Work

- Create and integrate a structure atlas for the Citadel, Reactor, Refinery,
  Barracks, Foundry, Operations Center, and Turret.
- Reuse structure textures for stale fog silhouettes through tinting and alpha
  rather than duplicating art.
- Add construction and damaged presentation without making art state
  authoritative for gameplay.
- Add Aurelite field textures, a resource icon, and a subtle emissive
  animation compatible with reduced-motion settings.
- Add industrial-sci-fi terrain tiles and scorched-ground decals without
  changing blocked tiles, navigation, or visibility rules.
- Replace placeholder structure portraits with atlas-derived or dedicated
  portraits.
- Keep unit, structure, and resource procedural renderers as missing-asset
  fallbacks.
- Retain procedural projectiles, fog, selection rings, health bars, build
  radii, route markers, and Solar Spear effects for clarity.
- Add a secondary Harvester cargo bar derived from the existing immutable
  `cargo` and `cargoCapacity` snapshot fields.
- Render the cargo bar as a thin segmented Aurelite-colored meter below the
  health bar.
- Show it for selected friendly Harvesters even when empty, and for unselected
  friendly Harvesters only while carrying cargo; do not expose it for enemy
  Harvesters.
- Preserve exact cargo values in the selected-asset panel.
- Extend the asset manifest and validation scripts for every new texture.
- Keep atlases at or below 2048 x 2048, menu transfer below 3 MB compressed,
  and complete match transfer below 20 MB compressed.

### Ground material and decal implementation plan

Deliver the terrain as a renderer-owned visual layer. It must never change
simulation coordinates, blocked tiles, pathfinding, fog authority, or command
results.

1. **Establish a measured baseline.** Record frame time, draw calls, texture
   memory, and allocations for the minimum supported browser/hardware profile
   before and after each terrain slice. Keep the terrain cached or chunked;
   do not redraw a map-wide texture every frame.
2. **Ship a static material pass first.** Expand the battlefield atlas to four
   to eight compatible ground variants. Select variants deterministically from
   world tile coordinates using a blue-noise-like distribution, then apply a
   low-frequency macro color field to break repetition without random runtime
   state. Use authored or deterministic material masks (for example blocked,
   worn, rocky, or resource-adjacent zones) for grass, dirt, and rock blends;
   the current map has no rendered elevation, so do not introduce a physical
   height dependency.
3. **Add zoom-based detail only when it earns its cost.** Blend macro and
   detail treatment from camera zoom, not camera distance. At wider zooms,
   prefer the cached macro material; reveal fine variation only at close zooms
   where it is visible and still meets the frame-time budget.
4. **Add bounded runtime decals.** Render building footprints, scorch marks,
   craters, and vehicle tracks in dirty world chunks with a fixed decal budget,
   deterministic ordering, and explicit fade/eviction rules. Static footprints
   may be baked into their affected chunk; moving or transient effects must
   update only their dirty chunks. Derive decal events from immutable snapshots
   or renderer events, but keep the resulting decal state non-authoritative.
5. **Treat custom shader materials as a profiled upgrade.** Texture arrays,
   stochastic texture bombing, and custom WebGL2 sampling are deferred until
   the atlas-based material pass is visually insufficient and measurements show
   adequate headroom on the release profile. Any such pipeline must retain a
   capable fallback and cannot add Phaser 3-era rendering dependencies.

The first reviewable slice is therefore deterministic atlas variation, macro
color variation, and static footprint/scorch decals. Profile it before adding
dynamic tracks, extra detail layers, or a custom material shader.

### Acceptance gates

- Every structure and resource field is immediately distinguishable at the
  minimum battlefield size and supported camera zooms.
- Team identity remains readable through color, outline, emblem, and selection
  treatment rather than color alone.
- Cargo fill, return, and unload transitions are readable without selecting
  every Harvester.
- Missing or failed assets fall back cleanly without blocking a match.
- Texture integration does not affect simulation snapshots, coordinates,
  selection bounds, fog authority, or deterministic tests.
- Terrain and decal rendering stays within the recorded release-profile frame
  budget, uses bounded texture memory and decal counts, and does not perform
  map-wide texture updates every frame.
- Asset dimension and transfer-budget validation passes.

## Phase 9A: Full-bleed battlefield and overlay HUD

### Objective

Make the battlefield the viewport-filling primary application surface and
layer compact, contextual controls and information over it. Remove the visual
impression of a game running inside a smaller dashboard window.

This is an approved correction to the presentation direction after the
completed Phase 7-9 baseline. It preserves the fixed-height, no-scroll,
ScaleManager, accessibility, and deterministic architecture already delivered.

### Current implementation slice

All four full-bleed UI slices are complete. Active play keeps selection
identity, primary orders, camera controls, and Solar Spear access in compact
overlays while construction, production, detailed asset data, telemetry, and
help use one bounded contextual panel. Overlay safe regions, blocking states,
viewport and fullscreen transitions, reduced motion, keyboard traversal, focus
restoration, and gameplay-input gating are covered by release tests.

### Work

- Replace the active-game header, battlefield, and command-dock rows with one
  viewport-sized layered stage.
- Remove the active-game shell max-width, decorative outer padding, and framed
  canvas treatment.
- Let the Phaser host fill the application viewport beneath React HUD layers.
- Convert resources, power, Solar Spear status, match actions, and pause/settings
  access into a compact top overlay.
- Convert selection identity and high-frequency build and order controls into a
  compact bottom overlay.
- Move build catalogs, production queues, detailed asset statistics, telemetry,
  and help into collapsible contextual panels.
- Keep browser fullscreen optional and user initiated; the same full-bleed
  composition must work in an ordinary browser window.
- Define tested HUD safe regions for alerts, onboarding, subtitles, placement
  feedback, and targeting guidance.
- Preserve the 1280 x 720 logical game with `Phaser.Scale.FIT` first, then
  evaluate `EXPAND` only if measured viewport use remains unsatisfactory.

### Acceptance gates

- Active play presents the battlefield to all four application edges except
  unavoidable aspect-ratio letterboxing and safe-area insets.
- No permanent header or command row subtracts from the battlefield rectangle.
- The battlefield is visually dominant whenever contextual panels are closed.
- High-frequency commands and critical status remain visible or one explicit
  action away at every supported viewport and UI scale.
- The largest contextual panel does not resize the document or Phaser game and
  remains keyboard reachable and dismissible.
- Pointer-to-world commands remain correct through viewport, panel, UI-scale,
  and browser-fullscreen changes.
- Deterministic tests and replay hashes remain unchanged.

### Detailed plan

See the
[full-bleed battlefield and overlay HUD plan](./full-bleed-battlefield-ui-plan.md).

## Phase 10: Performance contract and deterministic spatial indexing

### Objective

Create repeatable scale measurements and remove the linear lookups and
all-pairs proximity work that prevent predictable growth.

### Current implementation slice

The first slice established a Node.js headless benchmark for deterministic
100, 300, 600, and 1,000-unit idle armies, opt-in per-system timing boundaries,
machine-readable percentile and snapshot metrics, and versioned replay hashes
for combat, economy, skirmish AI, fog movement, and Solar Spear impact.

The second slice adds constant-time unit and structure lookup plus a
deterministic uniform spatial grid with insert, move, remove, and radius-query
operations. Target acquisition preserves distance-then-ID selection, and local
separation now examines nearby cells. On the recorded hardware, 600-unit idle
p95 improved from 1.4333 ms to 0.8506 ms and 1,000-unit idle p95 improved from
3.7106 ms to 1.7310 ms without changing any versioned replay hash.

The third slice routes Solar Spear area damage, turret acquisition,
building-placement coverage, and spawn occupancy through bounded unit and
structure queries. Exact distance, visibility, tile-occupancy, and
distance-then-ID rules remain unchanged.

The fourth slice adds deterministic nearest-neighbor traversal to the spatial
grid, indexes resource fields, and routes Harvester field and refinery selection
through spatial queries. Nearest choices preserve distance-then-ID ordering and
ignore depleted fields or inoperable refineries.

The fifth slice replaces repeated per-system unit and structure sorting with
maintained deterministic ID-ordered views. Rebuilds establish the views once,
while entity creation and removal update them without per-tick array copies.

### Work

- Add headless simulation benchmarks for 100, 300, 600, and 1,000 units.
- Add browser scenarios for idle armies, formation movement, convergence,
  combat, projectiles, fog, and multiple AIs.
- Record per-system p50, p95, p99, and worst-case time, render-frame time,
  allocations, object counts, and snapshot payload size.
- Add deterministic replay fixtures and checkpoint/final state hashes.
- Add a long-running soak scenario that detects tick overruns and memory
  growth.
- Define the minimum hardware and supported browser profile used for release
  gates.
- Introduce constant-time unit and structure lookup by ID.
- Preserve stable sorted-ID iteration wherever order affects results.
- Add a deterministic uniform spatial grid with insert, move, remove, and
  neighborhood queries.
- Route targeting, separation, area damage, spawn checks, harvesting,
  selection, and nearby-entity work through the spatial index.
- Split indexing and spatial queries out of the simulation monolith without
  changing command or snapshot semantics.

### Acceptance gates

- Benchmarks are machine-readable and reproducible with recorded hardware,
  browser, build, seed, object count, and command stream.
- Existing replay hashes remain unchanged unless an explicitly reviewed bug
  fix requires a versioned migration.
- Target selection preserves the current deterministic distance-then-ID
  winner.
- Local separation examines nearby cells rather than every unit pair.
- The 600-unit idle and targeting scenarios remain below 10 ms p95 simulation
  time on the minimum hardware profile.

### Detailed plan

Combines Phases 0-1 and the recommended first implementation slice from the
[four-player scaling plan](./four-player-scaling-plan.md).

## Phase 11: Budgeted formation pathfinding

### Objective

Prevent group movement and chase behavior from creating unbounded simulation
tick spikes.

### Current implementation slice

The first slices replaced A*'s repeated full open-list sorting with a
deterministic binary min-heap, then added a pausable search and deterministic
request queue. The current slice integrates that queue into formation anchors,
combat chasing, AI movement, harvesting, and rally movement. Two planning
passes share one exact per-tick expansion budget, compatible formations reuse
one anchor route, pending searches participate in authoritative replay state,
and snapshots expose queued, planning, following, blocked, and retrying states.
Each request is capped at 16,384 node expansions. With the 4,096-expansion
tick budget, a finite batch of `R` full-cost requests therefore completes or
fails within at most `4R` planning ticks; shared formations normally consume
one request rather than one request per unit.

The final caching slice reuses successful routes only when the static terrain
revision and exact occupied and reserved tile revisions match. Cache hits replay
the original expansion cost through the same priority queue, so they reduce A*
work without changing completion ticks, movement outcomes, or replay timing.

### Work

- Replace repeated open-list sorting with a deterministic binary heap.
- Add a path-request queue with a fixed work budget per simulation tick.
- Prioritize direct player orders, combat chasing, AI movement, harvesting,
  and background replanning explicitly.
- Share formation corridors or anchor paths across compatible group orders.
- Use the Phase 10 spatial grid for short-range separation and occupancy.
- Cache reusable paths and invalidate them through deterministic terrain and
  occupancy revisions.
- Stagger chase replanning and reject redundant requests.
- Add a coarse sector graph before supporting maps larger than 128 x 128.
- Expose queued, planning, following, blocked, and retrying states through
  deterministic simulation data.

### Acceptance gates

- A simultaneous move order for 200 units does not create a tick above 25 ms
  on the minimum hardware profile.
- Pathfinding never exceeds its configured per-tick work budget.
- Every request resolves or fails within a documented deterministic tick
  bound.
- Formation movement does not issue one full-map A* search per unit.
- Replay hashes and existing movement outcomes remain stable.

### Detailed plan

See Phase 2 of the
[four-player scaling plan](./four-player-scaling-plan.md).

## Phase 12: Simulation worker boundary

### Objective

Move mutable simulation ownership off the main thread without weakening the
command queue or deterministic runtime contract.

### Current implementation slice

The first slice defines protocol version 1 as framework-independent request and
event types. Commands carry an intended simulation tick and a unique sequence;
the Node-compatible in-process adapter applies same-tick commands by sequence,
publishes full snapshots at a fixed tick cadence, rejects late or duplicate
commands, and models pause, resume, termination, and recoverable protocol
errors explicitly. The second slice adds a dedicated worker host, browser-only
factory and entry point, worker-owned 20 Hz clock, and transport-independent
client. Actual Node worker-thread tests prove fixed-checkpoint parity,
main-thread-stall independence, and recoverable worker-failure events. The
third slice integrates that worker into the live gameplay shell: Phaser now
consumes published snapshots for presentation and input only, commands use a
documented two-tick input lead corrected by the worker publication timestamp,
and runtime failures enter the existing recoverable retry flow. The in-process
adapter remains the comparison oracle. The dedicated 600-unit worker benchmark
is still required before Phase 12 closes.

### Work

- Define a versioned, framework-independent worker protocol.
- Move mutable simulation ownership into a dedicated Web Worker.
- Send commands with their intended simulation tick and deterministic
  same-tick ordering.
- Keep pause, resume, visibility, restart, seed, scenario, and settings
  transitions explicit in the protocol.
- Publish state at a fixed cadence independent of Phaser frame time.
- Add a Node-compatible worker/runtime adapter for deterministic tests.
- Keep the in-process runtime as a temporary comparison oracle.
- Detect worker failure and surface a recoverable runtime error rather than
  silently continuing from divergent state.

### Acceptance gates

- In-process and worker runtimes produce identical checkpoint and final hashes.
- Reducing Phaser to 15 FPS does not change simulation results or command
  ordering.
- The worker maintains 20 Hz in the 600-unit normal benchmark.
- Main-thread stalls cannot create unbounded command delay.
- Server-rendered modules import neither Phaser nor browser-only worker code.

### Detailed plan

See Phase 3 of the
[four-player scaling plan](./four-player-scaling-plan.md).

## Phase 13: Delta snapshots and scalable rendering

### Objective

Prevent full snapshots and per-object presentation work from becoming the next
scale limit.

### Work

- Replace full object-graph render snapshots with a versioned delta protocol.
- Encode hot positional and combat fields in packed typed arrays.
- Send explicit create, update, hide, reveal, and destroy records.
- Exclude complete unit paths from routine render state.
- Double-buffer or transfer memory to reduce cloning and allocation.
- Publish slower UI and economy state on a lower-frequency channel.
- Cull off-camera unit and structure views with a safe interaction margin.
- Pool frequently created views, projectiles, and effects.
- Batch health bars, Harvester cargo bars, selection markers, routes, and
  projectiles.
- Redraw graphics only when the underlying value or revision changes.
- Add distance-based detail for shadows, meters, particles, and labels.
- Cap low-priority audiovisual effects without changing simulation outcomes.

### Acceptance gates

- Snapshot production and transfer stay below 2 ms p95 at the normal target.
- Payload size is proportional to changed entities rather than all entities.
- A scene with 600 visible units sustains 60 FPS on the minimum profile.
- The 1,000-unit stress scene remains at or above 30 FPS.
- Culling and detail rules never affect selection, visibility, or command
  results.
- React update cost does not scale with render rate or total entity count.

### Detailed plan

See Phase 4 of the
[four-player scaling plan](./four-player-scaling-plan.md).

## Phase 13A: Player UI upgrade

### Objective

Build the final single-player information architecture on the stable Phase 13
presentation contract before Phase 14 adds four-player identities, alliances,
setup, and match-state complexity.

### Execution boundary

The UI upgrade uses a deliberately split schedule:

- Before Phase 13A, only the UI plan's Phase 0 inventory, screenshot fixtures,
  shared design tokens, component anatomy, and focused low-risk usability fixes
  may proceed in parallel with Phases 11-13.
- Phase 13A begins only after the Phase 13 acceptance gates pass and the
  versioned slow UI/economy channel is stable.
- The structural command-interface work in UI-plan Phases 2-5 belongs to Phase
  13A and must not be folded into the worker or delta-rendering pull requests.
- Core keyboard, screen-reader, motion, contrast, and responsive acceptance
  gates ship in Phase 13A. Phase 16 repeats them under four-player, network,
  soak, localization, and release conditions rather than deferring basic
  accessibility until the end.

### Work

- Recompose the top status hierarchy and declare collision-free safe regions
  for onboarding, subtitles, placement feedback, targeting, and warnings.
- Introduce the unified command strip and presentation-only contextual-panel
  controller for Build, Production, Selection, Intel, and Help.
- Keep selection identity and primary valid orders visible while moving
  secondary detail into bounded, dismissible, keyboard-operable surfaces.
- Replace implementation-facing telemetry with player-facing intelligence and
  retain diagnostics only in an explicitly labeled development surface.
- Upgrade onboarding and action feedback for accepted, unavailable, queued,
  completed, and failed commands.
- Implement explicit wide, compact, short, and unsupported viewport modes,
  including match-start prevention below the supported minimum.
- Complete focus entry and restoration, live-region, disabled-reason,
  reduced-motion, contrast, and keyboard-only workflows.
- Consume the Phase 13 UI/economy presentation channel without coupling React
  updates to render frequency or mutating simulation state.

### Acceptance gates

- The battlefield remains visually dominant with contextual panels closed.
- Primary match status and commands never require scrolling at any supported
  viewport or UI scale.
- Secondary content has an obvious open, close, and overflow affordance.
- No onboarding, subtitle, warning, targeting, or placement surface covers a
  required status value or action.
- Keyboard and assistive-technology users can complete the core
  economy-to-Solar-Spear loop.
- Unsupported viewports prevent match start and provide a non-scrolling
  recovery path.
- React UI update cost follows the slower presentation channel and does not
  scale with render-frame frequency or total entity count.
- Pointer-to-world commands, deterministic tests, replay hashes, worker parity,
  and Phase 13 performance gates remain unchanged.
- The complete viewport/UI-scale matrix, unit tests, type checking, linting,
  production build, and Graphify update pass.

### Detailed plan

See the [player UI upgrade plan](./ui-upgrade-plan.md).

## Phase 14: Four-player world model and match experience

### Objective

Generalize the deterministic local game from two fixed sides to one-to-four
player slots before adding networking.

### Work

- Replace `PlayerId = 1 | 2` and fixed records with validated player-slot
  collections.
- Add teams, alliances, diplomacy, colors, starting positions, observers, and
  configurable victory conditions.
- Give each active player independent visibility and explored state.
- Store visibility as compact bitsets and update only dirty regions.
- Make map dimensions and blocked terrain data-driven.
- Divide larger maps into sectors shared by visibility, pathfinding, AI, and
  rendering.
- Budget strategic AI decisions independently from per-unit tactics.
- Define eliminated, disconnected, observer, and unoccupied-slot behavior.
- Extend setup and the bounded command interface for team and free-for-all
  matches by extending the Phase 13A panel and status patterns rather than
  introducing a second interface architecture.
- Preserve the current one-player-versus-AI configuration as the default
  regression case.

### Acceptance gates

- One-, two-, three-, and four-player local configurations pass deterministic
  replay tests.
- Team and free-for-all victory conditions resolve deterministically.
- A four-AI, 600-unit, 60-minute match completes without budget failure,
  visibility leakage, or unbounded memory growth.
- Visibility work scales with changed sources and regions rather than total map
  area.
- Existing two-player seeds and scenarios remain supported or receive an
  explicit versioned migration.
- Four-player setup, team, alliance, color, observer, and victory status fit the
  Phase 13A responsive and accessibility contracts.

### Detailed plan

See Phase 5 of the
[four-player scaling plan](./four-player-scaling-plan.md).

## Phase 15: Deterministic multiplayer

### Objective

Synchronize one-to-four remote players by exchanging ordered commands, hashes,
 and recovery checkpoints rather than streaming authoritative world state.

### Work

- Add lobby, slot, team, ready-state, map, seed, and version negotiation.
- Relay tick-numbered command batches with a configurable input delay.
- Define deterministic ordering for commands received for the same tick.
- Exchange periodic simulation hashes and identify the earliest divergence.
- Persist the authoritative command log for replay and diagnostics.
- Add checkpoint snapshots for reconnect and explicit resynchronization.
- Specify timeout, surrender, host departure, reconnect, observer, and
  abandoned-slot behavior.
- Validate commands against ownership and match rules before relay.
- Simulate latency, jitter, duplication, reordering, and packet loss.
- Version the simulation, command protocol, maps, and gameplay data so
  incompatible clients cannot join the same match.

### Acceptance gates

- Four clients remain synchronized through a 60-minute automated match.
- Tests pass with 150 ms round-trip latency, 30 ms jitter, and 1% packet loss.
- A deliberately corrupted client is detected by the next hash checkpoint.
- A disconnected client can rejoin from a checkpoint and command log.
- Saved replays reproduce the final hash in Node.js and supported browsers.
- Network traffic scales primarily with command volume, not entity count.

### Detailed plan

See Phase 6 of the
[four-player scaling plan](./four-player-scaling-plan.md).

## Phase 16: Scale hardening and release operations

### Objective

Turn successful demonstrations into a maintained performance, determinism, and
deployment contract.

### Work

- Run cross-browser and cross-platform replay determinism suites.
- Add nightly performance, network-fault, and long-soak jobs.
- Track benchmark history and fail on agreed regressions.
- Capture tick overruns, path backlog, snapshot backlog, network lateness,
  worker restarts, memory growth, and hash mismatches.
- Test maximum production, projectiles, destruction, fog exploration,
  reconnects, fullscreen changes, and UI-scale changes during long matches.
- Repeat the Phase 13A keyboard, screen-reader, contrast, localization,
  responsive, and reduced-motion matrix against four-player and multiplayer
  states.
- Document supported hardware, browsers, viewports, maps, players, and known
  stress behavior.
- Tune gameplay only after the technical envelope is stable.
- Keep exact-commit Sites synchronization and production verification in every
  merge-completion checklist.

### Acceptance gates

- All normal targets pass on the minimum hardware profile.
- A 120-minute four-player stress match completes without divergence,
  sustained performance below the floor, or unbounded memory growth.
- Memory returns to an expected steady state after large battles.
- Performance, viewport, determinism, network, production-build, and Sites
  deployment checks are maintained release gates.

### Detailed plan

See Phase 7 of the
[four-player scaling plan](./four-player-scaling-plan.md).

## Deferred parallel track: TypeScript 7

TypeScript 7 adoption is deliberately outside the critical gameplay sequence.
It must not be bundled with the viewport refactor, renderer changes, worker
protocol, multiplayer work, or another architecture phase.

The track may start when current official compatibility guidance confirms a
safe path for TypeScript, `typescript-eslint`, `eslint-config-next`, Next.js,
Vinext, and the project's editor tooling.

At that point:

- Re-check current versions and official compatibility notes.
- Use the dual TypeScript 7 compiler/TypeScript 6 API arrangement only if it is
  still the recommended transition.
- Keep temporary TypeScript 6 comparison type-checking until diagnostic parity
  is understood.
- Verify lint rule coverage, production builds, deterministic tests, and Sites
  compatibility.
- Deliver the change on its own `codex/*` branch with a documented rollback.

See the [TypeScript 7 adoption plan](./typescript-7-adoption-plan.md) for the
current proposal and exit condition.

## Dependency summary

| Phase | Depends on | Enables |
| --- | --- | --- |
| 7. Viewport and Phaser containment | Implemented Phase 6 baseline | Stable canvas and layout geometry |
| 8. Command dock and UI scaling | Phase 7 | No-scroll accessible application shell |
| 9. Battlefield art/readability | Phase 7; may overlap late Phase 8 | Final visual language and asset baseline |
| 9A. Full-bleed battlefield/overlay HUD | Phases 7-9 baseline | Immersive final game-screen composition |
| 10. Performance and spatial indexing | Phases 7-9 release baseline | Measurable deterministic scale |
| 11. Budgeted pathfinding | Phase 10 spatial index | Predictable large-group movement |
| 12. Simulation worker | Phases 10-11 predictable costs | Main-thread-independent simulation |
| 13. Delta rendering | Phase 12 protocol | Scalable snapshots and renderer |
| 13A. Player UI upgrade | Phase 13 presentation contract; UI inventory/tokens may start earlier | Final single-player information architecture and interaction model |
| 14. Four-player world model | Phases 10-13A | General local player model and match experience |
| 15. Deterministic multiplayer | Phase 14 | Synchronized remote matches |
| 16. Release hardening | Phases 7-15 | Maintained production envelope |

## Recommended next pull requests

The critical execution path is the remaining Phase 12 work -> Phase 13 -> Phase
13A -> Phase 14 -> Phase 15 -> Phase 16.

1. Integrate the proven Phase 12 worker transport into the gameplay shell and
   move live mutable simulation ownership off the main thread.
2. Exercise live pause, visibility, restart, termination, stall, failure
   recovery, and the 600-unit performance gate to close Phase 12.
3. Deliver the Phase 13 delta protocol, slow UI/economy channel, and scalable
   renderer before restructuring React presentation consumers.
4. Execute Phase 13A in the pull-request slices defined by the player UI
   upgrade plan: status/safe regions, command-panel architecture, panel
   migrations, onboarding/feedback, responsive modes, and accessibility polish.
5. Begin Phase 14 player-slot and match-experience integration only after the
   Phase 13A acceptance gates pass.

UI-plan Phase 0 inventory and Phase 1 token/component-foundation work may run as
isolated parallel pull requests during the remaining Phases 12-13. They must not
change the runtime snapshot contract, perform the contextual-panel migration,
or delay the critical simulation sequence.

These are pull-request slices, not replacements for the phase acceptance gates.

## Roadmap definition of done

This roadmap is complete when Aurelia Falling:

- Fits every supported viewport and UI scale without document scrolling.
- Presents a complete and readable textured battlefield with robust fallbacks.
- Maintains deterministic 20 Hz simulation at the normal four-player target.
- Survives the documented stress envelope without falling below release floors.
- Reproduces matches from ordered command logs and detects divergence.
- Supports one-to-four local or remote players with deterministic victory,
  visibility, reconnect, and replay behavior.
- Maintains automated viewport, accessibility, asset, performance,
  determinism, network, build, and deployment gates.
- Deploys the exact validated merged commit to Sites after every release merge.
