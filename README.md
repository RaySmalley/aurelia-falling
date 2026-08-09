# Aurelia Falling

A browser real-time strategy game built with React, vinext, and Phaser 4.

## Required runtime

Use Node.js `24.19.0`, the pinned Node 24 LTS build for this project. The
`.nvmrc`, `.node-version`, `package.json`, and npm engine check all declare the
same version. `npm run runtime:verify` also checks the running Node.js binary,
lockfile, and worker-benchmark acceptance contract; CI runs this guard after
setting up Node from `.node-version`.

## Local development

```bash
npm ci
npm run dev
```

The local development server defaults to:

```text
http://localhost:4000
```

`npm start` also uses port 4000 for the local production server. Pass a
different port explicitly only when a task requires it.

## Validation

```bash
npm run typecheck
npm run lint
npm test
```

`npm test` runs the production build followed by the complete deterministic unit
suite. Additional release checks are available as `npm run test:viewport`,
`npm run assets:validate`, `npm run replay:verify`,
`npm run benchmark:simulation`, and `npm run benchmark:pathfinding`.

## Automated pull request review

Every non-draft pull request runs one deterministic CI job that installs the
locked dependencies, typechecks, lints, builds, and runs the complete test
suite. The same job runs after pushes to `main`, and it can be started manually.

Automatic Codex reviews provide diff-focused code review using the repository's
`AGENTS.md` guardrails. Codex complements CI: review catches contextual risks,
while CI provides the reproducible pass/fail signal.

An advisory code-review-graph workflow also posts one updated PR comment with
structural risk, blast-radius, affected-flow, and apparent test-gap findings. It
does not gate merges. Its scope is limited to PR deltas; Graphify remains the
repository-wide architecture and codebase-navigation system.

Dependabot checks npm dependencies weekly and GitHub Actions monthly. Minor and
patch updates are grouped to reduce pull request noise.

The fixed-step simulation and gameplay modules live under `app/game/`. Phaser
is dynamically imported behind the client-only React boundary in
`app/phase-zero/`.

## Current milestone

Phase 12 is complete. Its first two slices define a
versioned, framework-independent simulation runtime protocol, an in-process
comparison oracle, and a dedicated Web Worker transport with a worker-owned
20 Hz clock. Actual Node worker-thread tests prove fixed-checkpoint parity,
main-thread-stall independence, and recoverable worker-failure reporting. The
third slice makes that worker authoritative in live play. Phaser now consumes
fixed-cadence snapshots and sends tick-stamped commands with a two-tick input
lead; worker publication timestamps keep that delay bounded after main-thread
stalls. A dedicated 600-unit Normal worker benchmark now exercises the 20 Hz
clock and fixed-cadence snapshot cloning, failing on missed deadlines or work
that exceeds the 50 ms tick budget. Phase 13 is now active: its first slice
defines a versioned render-delta contract with packed hot unit and structure
fields, explicit create/update/hide/reveal/destroy records, sequence-checked
reconstruction, and no full unit paths or production queues in the render
channel. Worker transport and Phaser consumption remain subsequent slices.

Phase 9A now presents active play as a full-bleed battlefield with compact
persistent status and command overlays. Construction, production, detailed
asset data, telemetry, and help expand through bounded contextual panels without
resizing the Phaser host or mutating simulation state.

Phase 10 established deterministic entity indices and a uniform spatial grid.
Phase 11 then integrated a deterministic, budgeted live path-request queue across
formation movement, combat chasing, AI movement, harvesting, and rally orders.
Compatible formations share anchor routes, pending work participates in replay
state, and large-army performance gates enforce the per-tick planning budget.
Successful routes are cached against the terrain and exact occupancy revision;
cache hits replay their original expansion cost so simulation timing remains
unchanged.

Unit and structure ID resolution is
constant-time; target acquisition uses bounded radius queries while preserving
distance-then-ID selection; and local separation examines nearby cells instead
of every unit pair. Solar Spear area damage, turret targeting, placement
coverage, and spawn occupancy also use bounded spatial queries instead of
map-wide entity scans. Resource fields are indexed, and Harvesters use
deterministic nearest-neighbor queries for fields and operational refineries.
Stable unit and structure iteration now reuses maintained ID-ordered views
instead of allocating and sorting new arrays throughout each simulation tick.
The 600-unit idle benchmark improved from 1.4333 ms to 0.8506 ms p95 on the
recorded hardware, while all versioned replay hashes remain unchanged.

The Node.js headless benchmark measures balanced 100, 300, 600, and 1,000-unit
idle armies without loading React or Phaser, records machine-readable
p50/p95/p99/worst timings and snapshot metrics, and preserves checked-in
before-and-after evidence. Versioned replay fixtures verify canonical state
hashes for combat, economy, skirmish AI, fog movement, and Solar Spear impact.
Run them with `npm run benchmark:simulation` and `npm run replay:verify`.

Phase 9 established battlefield art and operational readability on the 64×64
Golden Scar map. The deterministic skirmish uses validated unit, structure,
terrain, decal, and Aurelite atlases; runtime Gold/Cyan identity marks; stale
fog silhouettes; damaged and construction presentation; atlas-derived
portraits; and a segmented Harvester cargo meter. Phaser retries match assets
twice and retains procedural unit, structure, terrain, and resource renderers
as missing-asset fallbacks.

Phases 7 and 8 established the fixed viewport-height contract, Phaser
containment, bounded overflow, and 90–110% UI scaling across the supported
1024×640 minimum and 1366×650 laptop baselines. Phase 9A retained those
contracts while replacing the interim three-region layout with the current
full-bleed battlefield and overlay HUD.

The browser audio layer synthesizes original radio tones, selection and
construction alerts, weapon and explosion effects, warnings, and an industrial
ambient bed at runtime. Master, ambient, and effects volumes, alert subtitles,
interface scale, reduced motion, and onboarding progress persist locally.

All gameplay commands—including Solar Spear launch and surrender—continue to
enter the 20 Hz fixed-step simulation through a queue. React and Phaser consume
frozen snapshots and never mutate simulation state. Choose a deterministic seed
and AI pacing profile in match setup, then build through the Oracle, keep it
powered, and arm the Solar Spear before selecting currently visible ground.

Compressed assets are verified with `npm run assets:validate`. The menu
transfer remains below 3 MB, the complete match payload below 20 MB, and every
atlas edge below 2048 pixels.

## Planning

Start with the [documentation index](docs/README.md) for each document's scope,
status, and authority.

The initial Phase 0-6 baseline is recorded in the
[initial v1 implementation plan](docs/initial-v1-implementation-plan.md).
The completed Phase 7-12 work and remaining scaling phases are sequenced in the
[development roadmap](docs/development-roadmap.md), with detailed supporting
plans for the [overlay HUD](docs/full-bleed-battlefield-ui-plan.md), viewport
fit, the [player UI upgrade](docs/ui-upgrade-plan.md), four-player scaling, and
the deferred TypeScript 7 transition under `docs/`.

The main player UI upgrade is scheduled as roadmap Phase 13A: after the Phase
13 delta snapshot and stable UI/economy presentation contract, and before the
Phase 14 four-player match experience. UX inventory and design-token work may
start earlier, but structural command-panel migration waits for Phase 13.

## Hosting

The project uses Codex Sites with the project identity recorded in
`.openai/hosting.json`. Optional local D1 and R2 bindings are configured through
`vite.config.ts`.
