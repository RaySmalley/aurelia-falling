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
npm run build
npm test
npm run lint
```

The fixed-step simulation and gameplay modules live under `app/game/`. Phaser
is dynamically imported behind the client-only React boundary in
`app/phase-zero/`.

## Current milestone

Phase 1, the Movement Sandbox, is implemented on the 64×64 Golden Scar map.
It includes deterministic fixed-point unit motion, grid A*, shared formation
routes, dynamic occupancy, blocked-destination fallback, local separation,
drag selection, contextual movement, attack-move, stop/hold, rally markers,
control groups, and bounded camera navigation.

## Hosting

The project uses Codex Sites with the project identity recorded in
`.openai/hosting.json`. Optional local D1 and R2 bindings are configured through
`vite.config.ts`.
