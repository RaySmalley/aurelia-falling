# Aurelia Falling implementation guardrails

- Use Phaser 4.2.1 APIs. Consult `node_modules/phaser/skills/` before adding Phaser systems.
- Do not use Phaser 3 plugins or copy Phaser 3 idioms without verifying Phaser 4 compatibility.
- Phaser imports must remain client-only and dynamically loaded. Server-rendered modules may import only framework-independent simulation types and data.
- Commands enter the fixed-step simulation through a queue. React and Phaser consume read-only snapshots/events and must not mutate simulation state directly.
- Keep gameplay values data-driven and deterministic. Avoid wall-clock time and `Math.random()` in simulation code.
- Use Node.js 24.18.0 for local development, builds, and deterministic test runs.
- Run local development and production servers on port 4000 unless the user explicitly requests another port.

## Pull request review workflow

- When addressing a pull request review comment, implement and verify the fix first. Once the issue is resolved, reply in the original review thread with a concise summary of the change and verification performed, then mark the thread as resolved.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run all required tests, type checking, linting, and the production build before updating graphify.
- Only after every required verification command passes, run `graphify update .` as the final verification step (AST-only, no API cost).
- Do not report the task complete, commit, or push until the graphify update succeeds.
- If the graphify update fails, report the task as incomplete and include the failure.
