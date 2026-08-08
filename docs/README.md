# Documentation Index

This index records which project documents are authoritative, implemented,
historical, or planned. For current code behavior, tests and source remain the
final evidence; plans describe sequencing and acceptance intent.

## Start here

| Document | Status | Purpose and authority |
| --- | --- | --- |
| [Project README](../README.md) | Current | Setup, validation, architecture summary, and current milestone. |
| [Development roadmap](./development-roadmap.md) | Current and authoritative | Canonical phase order, implementation status, dependencies, and release gates. It wins when supporting plans disagree on sequencing. |
| [Initial v1 implementation plan](./initial-v1-implementation-plan.md) | Historical; Phases 0-6 complete | Original product, gameplay, and architecture baseline. Use the roadmap for current sequencing. |

## Presentation plans

| Document | Status | Scope |
| --- | --- | --- |
| [Viewport-fit UI refactor](./viewport-fit-ui-plan.md) | Implemented foundation; Phases 7-8 | Fixed-height shell, Phaser containment, responsive viewport contract, bounded overflow, and UI scaling. Its interim three-region composition was superseded by Phase 9A. |
| [Full-bleed battlefield and overlay HUD](./full-bleed-battlefield-ui-plan.md) | Implemented; Phase 9A | Current active-game composition, persistent overlays, contextual panels, safe regions, and overlay hardening. |
| [Player UI upgrade](./ui-upgrade-plan.md) | Approved future work; Phase 13A | Final single-player information architecture after Phase 13. Only its explicitly listed inventory/token prework may begin earlier. |

## Scaling and toolchain plans

| Document | Status | Scope |
| --- | --- | --- |
| [Four-player scaling](./four-player-scaling-plan.md) | In progress; roadmap Phases 10-16 | Detailed scale plan. Indexed entities/spatial queries and budgeted pathfinding are complete; the simulation-worker phase is active. |
| [TypeScript 7 adoption](./typescript-7-adoption-plan.md) | Deferred | Isolated toolchain proposal. The repository currently uses TypeScript 6; revalidate upstream compatibility before implementation. |

## Operational references

| Document | Status | Scope |
| --- | --- | --- |
| [Simulation performance contract](../benchmarks/README.md) | Current | Benchmark commands, metrics, checked-in Phase 10 evidence, Phase 11 pathfinding gates, and deterministic replay rules. |
| [Phase 6 asset notes](../art/phase-six/ASSET_NOTES.md) | Implemented asset record | Source prompts, dimensions, and packing notes for Phase 6 art. |
| [Phase 9 asset notes](../art/phase-nine/ASSET_NOTES.md) | Implemented asset record | Source prompts, dimensions, and packing notes for Phase 9 battlefield art. |
| [Agent guardrails](../AGENTS.md) | Current and authoritative for contributors | Runtime, Phaser, determinism, pull-request, deployment, and Graphify rules. |

## Verification sources

- `package.json` is authoritative for runnable npm commands and pinned package
  versions; Node.js `24.18.0` is also pinned by `.nvmrc` and `.node-version`.
- `.github/workflows/ci.yml` is authoritative for the hosted validation gate.
- `.openai/hosting.json` identifies the Sites project; `vite.config.ts` defines
  local optional D1/R2 bindings.
- `tests/` and `scripts/` define the executable gameplay, viewport, asset,
  benchmark, replay, and runtime-protocol checks.

## Audit record

The documentation set was reconciled with `main` on August 8, 2026 after the
first Phase 12 runtime-protocol slice. The audit verified local Markdown links,
runtime and package versions, npm scripts, CI workflows, implemented Phase 9A
UI slices, Phase 10 spatial indexing, Phase 11 pathfinding, and the current
Phase 12 in-process runtime boundary.
