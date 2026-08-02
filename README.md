# Aurelia Falling

A browser real-time strategy game built with React, vinext, and Phaser 4.

## Required runtime

Use Node.js `24.18.0`, the pinned Node 24 LTS build for this project. The
`.nvmrc`, `.node-version`, `package.json`, and npm engine check all declare the
same version.

## Local development

```bash
npm install
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
npm run build
npm test
npm run lint
```

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

Phase 11 is underway with A* open nodes managed by a deterministic binary
min-heap instead of repeated full-list sorting. Priority remains path score
followed by tile ID, preserving existing path and replay outcomes while
establishing the first boundary for budgeted path requests.

Phase 10 established deterministic entity indices and a uniform spatial
grid integrated into the simulation. Unit and structure ID resolution is
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

Phases 7 and 8 also established the fixed viewport-height contract, Phaser
containment, bounded command dock, internal overflow regions, and 90–110% UI
scaling across the supported 1024×640 minimum and 1366×650 laptop baselines.
That bounded three-region layout is now the implementation baseline rather than
the final presentation target. Planned Phase 9A makes the battlefield full-bleed
and layers compact status, primary commands, and collapsible contextual panels
over it.

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

The initial Phase 0-6 baseline is recorded in the
[initial v1 implementation plan](docs/initial-v1-implementation-plan.md).
The completed Phase 7-9 presentation work, approved Phase 9A full-bleed
battlefield direction, Phase 10 performance baseline, and remaining scaling
phases are sequenced in the
[development roadmap](docs/development-roadmap.md), with detailed supporting
plans for the [overlay HUD](docs/full-bleed-battlefield-ui-plan.md), viewport
fit, four-player scaling, and the deferred TypeScript 7 transition under
`docs/`.

## Hosting

The project uses Codex Sites with the project identity recorded in
`.openai/hosting.json`. Optional local D1 and R2 bindings are configured through
`vite.config.ts`.
