# Aurelia Falling Development Roadmap

## Status

Current canonical roadmap following completion of the initial Phase 0-6 browser
RTS plan.

This document defines the order of the next ten phases. Detailed technical
design remains in the supporting plans:

- [Initial v1 implementation plan](./initial-v1-implementation-plan.md)
- [Viewport-fit UI refactor plan](./viewport-fit-ui-plan.md)
- [Four-player scaling plan](./four-player-scaling-plan.md)
- [TypeScript 7 adoption plan](./typescript-7-adoption-plan.md)

When a supporting plan and this roadmap differ on sequencing, this roadmap is
authoritative. The supporting plan remains authoritative for detailed work and
acceptance criteria inside its assigned phase.

## Current baseline

The implemented Phase 6 release provides:

- A deterministic 20 Hz two-player simulation on the 64 x 64 Golden Scar map.
- Six units, seven structures, economy, power, production, repairs, selling,
  fog of war, stale structure memory, combat, AI, and Solar Spear resolution.
- Easy, Normal, and Hard pacing profiles derived from one rules-legal Normal
  AI.
- A React command interface around a client-only Phaser 4.2.1 renderer.
- An eight-facing texture atlas for all six units, setup key art, procedural
  structure and terrain graphics, synthesized audio, settings, and onboarding.
- A production build and deployment path through Sites.

The next work begins from several known presentation and scale limits:

- The command dock is now hidden before a match begins, but the complete
  in-game document still exceeds common viewport heights.
- The shell, Phaser canvas, command dock, overlays, and whole-shell UI scaling
  do not yet share a fixed viewport-height contract.
- Units have final-facing artwork, while structures, Aurelite fields, terrain,
  and several portraits remain procedural or placeholder visuals.
- Harvester cargo is available in immutable snapshots and the selection panel
  but has no battlefield capacity indicator.
- The simulation is deterministic but still optimized for a two-player,
  small-skirmish object count.
- The simulation runs on the main thread and publishes full object-graph
  snapshots.
- Player identity, visibility, victory, and setup flows assume two sides.
- Multiplayer transport and desynchronization recovery do not exist.

## Product direction

Near-term work prioritizes the quality and usability of the existing
single-player release before expanding its simulation envelope. Performance
foundations come before four-player rules, and the generalized local world
model comes before networking.

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
- Asset dimension and transfer-budget validation passes.

## Phase 10: Performance contract and deterministic spatial indexing

### Objective

Create repeatable scale measurements and remove the linear lookups and
all-pairs proximity work that prevent predictable growth.

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
  matches.
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
| 10. Performance and spatial indexing | Phases 7-9 release baseline | Measurable deterministic scale |
| 11. Budgeted pathfinding | Phase 10 spatial index | Predictable large-group movement |
| 12. Simulation worker | Phases 10-11 predictable costs | Main-thread-independent simulation |
| 13. Delta rendering | Phase 12 protocol | Scalable snapshots and renderer |
| 14. Four-player world model | Phases 10-13 | General local player model |
| 15. Deterministic multiplayer | Phase 14 | Synchronized remote matches |
| 16. Release hardening | Phases 7-15 | Maintained production envelope |

## Recommended next pull requests

1. Add the viewport browser harness and contain the fixed-aspect Phaser canvas.
2. Lock the shell to the viewport and make setup plus active play pass at 100%.
3. Replace whole-shell zoom and build the bounded desktop command dock.
4. Add compact dock tabs, overlay hardening, and the full UI-scale matrix.
5. Add the Harvester cargo meter and structure atlas with procedural fallback.
6. Add Aurelite, terrain, portrait, and asset-budget completion.
7. Add replay hashes, benchmark instrumentation, entity indices, and the first
   deterministic spatial-grid consumers.

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
