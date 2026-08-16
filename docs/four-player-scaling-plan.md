# Four-Player Scaling Plan

## Status

Approved implementation plan for scaling Aurelia Falling from its current
two-player world model to stable one-to-four-player matches. The indexed-entity,
spatial-query, budgeted-pathfinding, simulation-worker, and delta-rendering
phases are implemented. Phase 13's production-cadence delta gate and
hardware-accelerated 600/1,000-unit rendering gates pass on the recorded Intel
UHD minimum profile. The player UI upgrade in Phase 13A is next; later
four-player phases remain planned.

Its work is sequenced as Phases 10-16 of the
[current development roadmap](./development-roadmap.md).

This plan is intentionally narrower than matching the maximum concurrency of
Command & Conquer 3. The goal is to preserve the current deterministic gameplay
model while supporting materially larger battles without tying simulation
correctness to rendering performance.

## Target envelope

The roadmap is complete when the game can satisfy the following targets on the
agreed minimum desktop hardware profile:

| Dimension | Normal target | Stress target |
| --- | ---: | ---: |
| Players | 1-4 human or AI slots | 4 active slots |
| Units | 600 total | 1,000 total |
| Live simulation objects | 1,000 total | 1,500 total |
| Map | 128 x 128 tiles | 192 x 192 tiles |
| Simulation rate | Deterministic 20 Hz | Deterministic 20 Hz |
| Simulation time | p95 below 10 ms | p95 below 25 ms |
| Render rate | 60 FPS | Never below 30 FPS during sustained battles |
| Match duration | 60 minutes | 120-minute soak |

Live simulation objects include units, structures, projectiles, resource
fields, active abilities, and other transient gameplay entities.

The stress target is a release guardrail rather than a recommended balance
point. Normal matches should remain comfortably below it.

## Architectural invariants

Every phase must preserve these rules:

- Commands enter the fixed-step simulation through a queue.
- Simulation results are deterministic for a seed and ordered command stream.
- React and Phaser consume read-only state and never mutate simulation state.
- Gameplay systems use simulation ticks, not wall-clock time.
- Simulation code does not use `Math.random()`.
- Phaser remains client-only and dynamically imported.
- Rendering performance cannot change simulation outcomes.
- Entity and request iteration uses an explicit deterministic order.

## Delivery strategy

Each phase is a separately reviewable architecture change on a `codex/*`
branch. A phase is complete only when its acceptance gates pass and the
production build, unit tests, type checking, linting, and deterministic replay
checks succeed.

Performance numbers must be recorded with the hardware, browser, build mode,
scenario seed, entity counts, and command stream used to produce them.

## Phase 0: Establish the scale contract

### Objective

Create repeatable measurements before changing the architecture. This prevents
optimizations from silently changing gameplay or improving one synthetic case
while making real battles worse.

### Work

- Add headless simulation benchmarks for 100, 300, 600, and 1,000 units.
- Add browser benchmarks for idle armies, formation movement, converging
  armies, sustained combat, projectile saturation, fog of war, and four AIs.
- Record per-system simulation time instead of only total tick time.
- Record render-frame time, object counts, allocations, and snapshot payload
  size.
- Add deterministic replay fixtures with a final state hash.
- Add a long-running soak scenario that detects tick overruns and memory growth.
- Define the minimum desktop hardware and supported browser versions used for
  release gates.

### Acceptance gates

- The same benchmark command produces comparable machine-readable results.
- Every benchmark records p50, p95, p99, and worst-case timings.
- Existing scenarios produce identical final hashes before and after
  instrumentation.
- The current baseline is checked into a versioned benchmark report.

### Deliverables

- A benchmark runner usable from Node.js 24.19.0.
- A browser performance scene available only in development builds.
- Replay fixtures covering combat, economy, skirmish, fog, and Solar Spear use.

## Phase 1: Indexed entities and spatial queries

### Objective

Remove the linear lookup and all-pairs proximity work that prevents unit count
from scaling predictably.

### Work

- Introduce deterministic entity stores with constant-time lookup by ID.
- Preserve a stable sorted-ID iteration order for systems whose order affects
  outcomes.
- Add a uniform spatial grid keyed by map cell or small cell region.
- Update the grid after movement and entity creation or destruction.
- Route targeting, local separation, area damage, spawn checks, harvesting,
  selection, and nearby-entity queries through the spatial grid.
- Replace repeated `sortedUnits()` and `sortedStructures()` allocations with
  maintained deterministic indices or reusable ordered views.
- Split entity indexing and spatial queries out of the simulation monolith
  without changing command or snapshot contracts.

### Acceptance gates

- Unit and structure lookup is constant-time.
- Local separation examines nearby spatial cells rather than every unit pair.
- Target acquisition returns the same deterministic winner as the current
  distance-then-ID ordering.
- The 600-unit idle and sustained-targeting benchmarks remain below the normal
  10 ms p95 simulation budget.
- Existing deterministic replay hashes remain unchanged unless an explicitly
  reviewed bug fix requires a versioned replay migration.

### Dependencies

Phase 0 must be complete.

## Phase 2: Budgeted formation pathfinding

### Objective

Prevent move orders and chase behavior from producing unbounded tick spikes.

### Work

- Replace repeated open-list sorting with a deterministic binary heap.
- Add a path-request queue with a fixed work budget per simulation tick.
- Assign explicit request priorities for direct player orders, combat chasing,
  AI movement, harvesting, and background replanning.
- Share a formation corridor or anchor path across compatible group orders.
- Use local steering and the spatial grid for short-range separation.
- Cache reusable paths and invalidate them when relevant occupancy or terrain
  revisions change.
- Stagger chase replanning and reject redundant requests for the same unit and
  destination.
- Add a coarse sector graph for hierarchical routing on maps larger than
  128 x 128.
- Expose deterministic states such as queued, planning, following, blocked, and
  retrying so units never depend on wall-clock completion.

### Acceptance gates

- A simultaneous move order for 200 units does not create a simulation tick
  above 25 ms on the minimum hardware profile.
- All units receive a route or deterministic failure within the documented
  maximum number of ticks.
- Pathfinding never consumes more than its configured per-tick work budget.
- Formation movement avoids issuing one full-map A* search per unit.
- Pathfinding tests cover request ordering, cancellation, cache invalidation,
  unreachable destinations, and replay determinism.

### Dependencies

The Phase 1 spatial grid supplies occupancy and local-neighbor queries.

## Phase 3: Simulation Web Worker

### Objective

Make the simulation independent of React and Phaser frame time.

### Work

- Move ownership of mutable simulation state into a dedicated Web Worker.
- Define a versioned, framework-independent runtime protocol.
- Send commands to the worker with their intended simulation tick.
- Keep pause, restart, seed, scenario, and settings transitions explicit in the
  protocol.
- Publish simulation state at a fixed cadence independent of render frames.
- Add a Node-compatible worker/runtime adapter for deterministic tests.
- Preserve the existing in-process runtime temporarily as a comparison oracle
  until replay parity is proven.
- Detect worker failure and surface a recoverable runtime error instead of
  silently continuing with divergent state.

### Acceptance gates

- The same replay produces the same per-checkpoint and final hashes in the
  in-process and worker runtimes.
- Artificially reducing Phaser to 15 FPS does not change simulation tick
  results or command ordering.
- The worker maintains 20 Hz in the 600-unit normal benchmark.
- Main-thread stalls cannot cause more than the documented command-input delay.
- No server-rendered module imports Phaser or browser-only worker code.

### Dependencies

Phases 1 and 2 must establish predictable simulation costs before the worker
boundary is finalized.

## Phase 4: Delta snapshots and scalable rendering

### Objective

Prevent snapshot allocation and per-object rendering work from becoming the
next bottleneck after the simulation moves off the main thread.

### Work

- Replace full object-graph snapshots with a versioned delta protocol.
- Encode hot positional and combat fields in packed typed arrays.
- Send explicit create, update, hide, reveal, and destroy records.
- Exclude complete unit paths from routine render snapshots.
- Double-buffer or transfer snapshot memory to avoid unnecessary cloning.
- Keep slower UI/economy data on a lower-frequency channel.
- Cull unit and structure views outside the camera plus a small margin.
- Pool frequently created views, effects, and projectile visuals.
- Batch health bars, selection markers, route lines, and projectiles.
- Redraw graphics only when their underlying values change.
- Add distance-based detail rules for shadows, bars, particles, and labels.
- Cap transient visual and audio effects by priority without changing
  simulation outcomes.

The active Phase 13 implementation caps only expendable presentation polish:
full-detail projectile halo strokes have a fixed per-redraw budget, and
synthesized selection/weapon sounds share a fixed low-priority budget per
snapshot. Projectile bodies and gameplay-significant subtitles, alerts,
warnings, Solar Spear effects, match results, and camera shake bypass that
budget.

The final Phase 13 acceptance run records 0.620 ms p95 delta production,
0.679 ms p95 transfer and reconstruction, a 321-byte one-unit update versus a
247,269-byte initial payload, 59.76 FPS with 600 units, and 59.96 FPS with 1,000
units. The headed Chromium run used an Intel UHD Direct3D 11 renderer on an
11th-generation Core i7-11800H with 16 GB RAM. Fixture identity, unit counts,
WebGL selection, thresholds, and gate evaluation are machine-readable.

### Acceptance gates

- Snapshot production and transfer remain below 2 ms p95 at the normal target.
- Snapshot payload size is proportional to changed entities, not all entities.
- A scene with 600 visible units sustains the agreed 60 FPS target.
- The 1,000-unit stress scene remains at or above 30 FPS.
- Camera culling and detail changes do not affect selection or command results.
- React updates do not scale with the render-frame rate or total unit count.

### Dependencies

The Phase 3 worker protocol provides the versioning and transport boundary.

After this scaling-plan phase maps to roadmap Phase 13 and passes its acceptance
gates, roadmap Phase 13A implements the main player UI upgrade against the
stable delta and slow UI/economy channels. The UI inventory and token foundation
may start earlier, but contextual-panel migration must not be coupled to this
protocol phase.

## Phase 5: Four-player world model

### Objective

Generalize the deterministic simulation from two fixed sides to one-to-four
player slots while scaling map and visibility work.

At the roadmap level, the Phase 13A player UI upgrade sits between this plan's
Phases 4 and 5. Phase 5 extends that interface for four-player setup and match
state; it does not create a separate presentation architecture.

### Work

- Replace `PlayerId = 1 | 2` with validated player-slot IDs.
- Replace fixed player records with indexed collections.
- Add teams, alliances, diplomacy, player colors, starting positions, and
  configurable victory conditions.
- Give each active player an independent visibility state.
- Store visibility and explored state as compact bitsets.
- Update only visibility regions affected by moved, created, or destroyed
  sources.
- Make map dimensions and blocked terrain data-driven.
- Divide larger maps into sectors used by visibility, pathfinding, AI, and
  rendering.
- Budget strategic AI decisions separately from per-unit tactical updates.
- Ensure eliminated, disconnected, observer, and unoccupied slots have explicit
  behavior.
- Extend setup and HUD flows for free-for-all and team matches.

### Acceptance gates

- One-, two-, three-, and four-player configurations pass deterministic replay
  tests.
- A four-AI, 600-unit, 60-minute match completes without tick-budget failure,
  unbounded memory growth, or visibility leakage.
- Team and free-for-all victory conditions resolve deterministically.
- Visibility work scales with changed sources and dirty regions rather than
  total map area every tick.
- Existing two-player scenarios remain supported.

### Dependencies

The worker and delta protocol must be stable enough to represent multiple
player views without another transport redesign.

## Phase 6: Deterministic multiplayer

### Objective

Synchronize one-to-four remote players by exchanging commands rather than
streaming complete simulation state.

### Work

- Add lobby, slot, team, ready-state, map, seed, and version negotiation.
- Relay tick-numbered command batches with a configurable input delay.
- Define deterministic ordering for commands received for the same tick.
- Exchange periodic simulation hashes and identify the earliest divergence.
- Persist the authoritative command log for replay and diagnostics.
- Add checkpoint snapshots for reconnect and explicit resynchronization.
- Specify timeout, surrender, host departure, reconnect, and observer behavior.
- Simulate latency, jitter, duplication, reordering, and packet loss in tests.
- Validate commands against player ownership and match rules before relay.
- Version the simulation data, command protocol, map, and gameplay data so
  incompatible clients cannot join the same match.

### Acceptance gates

- Four clients remain synchronized through a 60-minute automated match.
- Tests pass with 150 ms round-trip latency, 30 ms jitter, and 1% packet loss.
- A deliberately corrupted client is detected by the next hash checkpoint.
- A disconnected player can rejoin from a checkpoint and command log.
- Saved replays reproduce the final match hash in Node.js and supported
  browsers.
- Network traffic scales primarily with command volume, not entity count.

### Dependencies

Phase 5 supplies the generalized player model. Phases 0-4 ensure each client can
simulate the target match locally before networking is introduced.

## Phase 7: Hardening and release gates

### Objective

Turn successful scale demonstrations into a maintained performance contract.

### Work

- Run cross-browser and cross-platform replay determinism suites.
- Add nightly performance and long-soak jobs.
- Track benchmark history and fail on agreed regressions.
- Add diagnostic captures for tick overruns, path backlog, snapshot backlog,
  network lateness, hash mismatches, and worker restarts.
- Test long matches with maximum production, projectiles, destroyed entities,
  fog exploration, and repeated reconnects.
- Tune gameplay values only after the technical target is stable.
- Document supported hardware, browsers, map limits, player limits, and known
  stress behavior.

### Acceptance gates

- All target-envelope scenarios pass on the minimum hardware profile.
- A 120-minute four-player stress match completes without divergence or
  sustained performance below the defined floor.
- Memory returns to an expected steady state after large battles.
- Performance and determinism checks are part of the merge gate for future
  simulation changes.

## Remaining implementation sequence

The scale contract, entity indices, spatial queries, and budgeted pathfinding
are established. Continue from the active worker boundary before changing the
delta, world-model, or network architecture:

1. Integrate the proven worker ownership boundary with the live client,
   including pause, visibility, restart, termination, stall, and recoverable
   failure behavior.
2. Close the Phase 3 performance and server-boundary gates.
3. Begin delta snapshots only after the worker protocol is stable.

This sequence keeps worker ownership reviewable without coupling it to the
Phase 4 delta format or later multiplayer behavior.

## Key risks

| Risk | Mitigation |
| --- | --- |
| Optimizations change deterministic ordering | Make ordering explicit and compare replay hashes at every phase |
| Path requests are delayed enough to feel unresponsive | Reserve budget for direct player commands and expose queue metrics |
| Worker messaging creates allocation pressure | Use versioned packed buffers and measure transfer cost before committing the protocol |
| Rendering optimization changes gameplay visibility | Keep simulation visibility authoritative and treat renderer culling as presentation only |
| Four-player AI exceeds the budget | Separate strategic and tactical frequencies and enforce per-tick work budgets |
| Multiplayer desynchronizes across runtimes | Use integer simulation values, checkpoint hashes, command logs, and cross-runtime replay tests |
| A larger map multiplies every grid cost | Chunk terrain and visibility before increasing the default map size |

## Definition of done

The scaling initiative is complete when a release build can run a deterministic
four-player match at the normal target, survive the stress target without
dropping below the defined floor, reproduce the match from its command log, and
detect or recover from a multiplayer divergence without corrupting simulation
state.
