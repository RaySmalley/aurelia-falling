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

Dependabot checks npm dependencies weekly and GitHub Actions monthly. Minor and
patch updates are grouped to reduce pull request noise.

The fixed-step simulation and gameplay modules live under `app/game/`. Phaser
is dynamically imported behind the client-only React boundary in
`app/phase-zero/`.

## Current milestone

Phase 6, the polished release, is implemented on the 64×64 Golden Scar map.
The deterministic skirmish now adds a validated 8-facing industrial unit atlas,
runtime Gold/Cyan team markers, stale fog silhouettes, structure selling,
persistent battlefield zoom, reduced screen shake, promotional key art, and
Easy/Normal/Hard AI pacing profiles derived from the canonical Normal ruleset.
Phaser retries match assets twice and retains procedural unit silhouettes as a
missing-asset fallback.

The browser audio layer synthesizes original radio tones, selection and
construction alerts, weapon and explosion effects, warnings, and an industrial
ambient bed at runtime. Master, ambient, and effects volumes, alert subtitles,
interface scale, reduced motion, and onboarding progress persist locally.

All gameplay commands—including Solar Spear launch and surrender—continue to
enter the 20 Hz fixed-step simulation through a queue. React and Phaser consume
frozen snapshots and never mutate simulation state. Choose a deterministic seed
and AI pacing profile in match setup, then build through the Oracle, keep it
powered, and arm the Solar Spear before selecting currently visible ground.

Phase 6 compressed assets are verified with `npm run assets:validate`. The menu
transfer remains below 3 MB, the complete match payload below 20 MB, and every
atlas edge below 2048 pixels.

## Hosting

The project uses Codex Sites with the project identity recorded in
`.openai/hosting.json`. Optional local D1 and R2 bindings are configured through
`vite.config.ts`.
