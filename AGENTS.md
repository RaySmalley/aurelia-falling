# Aurelia Falling implementation guardrails

- Use Phaser 4.2.1 APIs. Consult `node_modules/phaser/skills/` before adding Phaser systems.
- Do not use Phaser 3 plugins or copy Phaser 3 idioms without verifying Phaser 4 compatibility.
- Phaser imports must remain client-only and dynamically loaded. Server-rendered modules may import only framework-independent simulation types and data.
- Commands enter the fixed-step simulation through a queue. React and Phaser consume read-only snapshots/events and must not mutate simulation state directly.
- Keep gameplay values data-driven and deterministic. Avoid wall-clock time and `Math.random()` in simulation code.
