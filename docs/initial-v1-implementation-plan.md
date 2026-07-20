# Aurelia Falling — Initial v1 Implementation Plan

Status: Historical baseline; Phases 0-6 are implemented.

This document records the original plan that established the playable browser
RTS and polished v1 baseline. Current sequencing continues in
[development-roadmap.md](./development-roadmap.md).

## Summary

Build a single-player, 2D-isometric browser RTS about rival Meridian Coalition commanders fighting over Aurelite on the collapsing world of Aurelia.

Delivery is divided into three cuttable tiers:

- **Playable slice:** movement, combat, economy, construction, power, fog, and one Normal AI.
- **Feature-complete v1:** Solar Spear, onboarding, match screens, and essential audio.
- **Polished release:** generated artwork, Easy/Hard profiles, selling, stale structure silhouettes, portraits, and promotional art.

Work proceeds in independently playable phases. Scope may be cut only from the end of this sequence.

## Architecture and Interfaces

### Runtime

- Begin with the standard Codex Sites scaffold: React UI, Vite-based vinext build, Cloudflare Worker-compatible output, and `.openai/hosting.json`.
- Keep the game as a pure client-side module with no vinext/Next server APIs. Load Phaser 4.2.1 through a client-only dynamic import with server rendering disabled; Phaser must never be imported while rendering on the server.
- Keep simulation, rendering, and game-content modules independent of the hosting shell so they can move to a plain Vite SPA without rewrites.
- Prefer a plain Vite SPA if Phase 0 proves that Codex Sites accepts and privately deploys it with the required WebGL, audio, and asset behavior. Otherwise retain vinext only as the thin Sites-compatible shell.
- React owns menus, resource and power displays, build sidebar, tooltips, tutorial, settings, results, and a dedicated minimap canvas.
- Deploy the validated build privately through Codex Sites. Private playtesters must have the required ChatGPT access; public or non-ChatGPT distribution requires a separately approved deployment target.
- No backend, accounts, database, pointer lock, server actions, or server simulation is required.
- Before implementation, consult the version-matched official Phaser 4 agent skills and migration guide. Add a repository instruction prohibiting unverified Phaser 3 APIs and plugins; third-party Phaser plugins are excluded unless explicitly confirmed compatible with 4.2.1.

### Simulation Boundary

- Run the simulation at 20 fixed ticks per second; rendering interpolates toward the latest state at display refresh rate.
- React and Phaser submit discriminated `GameCommand` objects through `GameBridge.enqueue()`.
- The simulation publishes immutable `RenderSnapshot` data every tick, `UISnapshot` data at 10 Hz, and discrete `GameEvent` messages.
- React and Phaser adapters may never mutate simulation entities directly.
- Use integer ticks, credits, health, damage, and fixed-point millitile positions. Sort entity processing by stable numeric ID and use one seeded PRNG; trigonometry and floating-point interpolation remain renderer-only.
- Seeded replay is guaranteed only for the pinned runtime/build, not across arbitrary JavaScript engines.
- Auto-pause immediately when `document.visibilityState` becomes `hidden`. Clear the fixed-step accumulator and require an explicit resume after the tab becomes visible; never fast-forward or run accumulated catch-up steps after background throttling.

### Data Model

Expose one typed `gameData` configuration as the source of truth for:

- Unit and building costs, build times, health, armor, speed, vision, prerequisites, power, weapons, cooldowns, and counters.
- Aurelite capacity, regeneration, cargo, and harvesting rates.
- Solar Spear price, charge time, warning delay, radius, and damage.
- AI build orders, reaction intervals, aggression thresholds, and difficulty pacing.
- Match setup and tutorial trigger conditions.

Core interfaces include `GameState`, `PlayerState`, `EntityState`, `UnitDefinition`, `BuildingDefinition`, `WeaponDefinition`, `GameCommand`, `GameEvent`, `RenderSnapshot`, `UISnapshot`, `VisibilityGrid`, `MatchConfig`, and `AiProfile`.

## Phased Implementation

### Phase 0 — Framework Spike

- Create the Sites project and strictly client-only Phaser canvas integration.
- Render placeholder isometric terrain and one selectable unit.
- Prove camera movement, grid/world conversion, React HUD updates, command queuing, fixed-step simulation, hidden-tab auto-pause, production build, WebGL, audio unlock, and asset loading.
- Test whether a plain Vite SPA can satisfy the Sites build and private-deployment contract. Use it when successful; otherwise keep the portable game inside a client-only vinext shell.
- Confirm the real deployment payload limit, successful private viewer access, and compatibility of the planned 20 MB match payload.
- Treat this phase as a go/no-go hosting gate. Proceed only when a production deployment can load, select, and move one unit without SSR, WebGL, audio, or asset-delivery failures.
- If the gate fails, stop before Phase 1 and change only the hosting shell or deployment target; do not redesign the game modules.

### Phase 1 — Movement Sandbox

- Add the 64×64 Golden Scar map, blocked terrain, selection rectangle, contextual movement, control groups, attack-move, stop, hold, rally markers, and camera bounds.
- Implement grid A*, shared formation paths, local separation, blocked-destination fallback, and dynamic occupancy.
- Use geometric, flat-shaded placeholder assets.
- Exit with several controllable formations navigating the complete map.

### Phase 2 — Combat Slice

- Add all six unit definitions, projectiles, range, cooldowns, target acquisition, armor counters, health, destruction, and prebuilt opposing armies.
- Support manual targeting and autonomous engagement without economy or construction.
- Exit with a complete combat-only match and deterministic seeded results.

### Phase 3 — Economy and Base Slice

- Add credits, Harvesters, Aurelite fields, unloading, production queues, prerequisites, build radius, placement validation, power, repairs, and victory through Citadel destruction.
- Implement all seven structures and the complete build tree.
- Existing structures remain operational if their build-radius connection is severed, but disconnected structures stop projecting new construction radius.
- The Citadel cannot be sold. Selling other structures is deferred to polish.
- Exit with a single-operator sandbox that can switch control between both local sides for debugging and progress from starting base to final assault. This is not multiplayer and includes no networking.

### Phase 4 — Complete Skirmish

- Add explored terrain, current visibility, hidden enemies, and a dirty-updated fog texture. Stale enemy-building silhouettes remain deferred.
- Recalculate visibility on simulation ticks only when vision sources move or change; never recompute it every render frame.
- Implement one build-order-driven Normal AI with reactive scouting, defense, rebuilding, army composition, expansion, and attacks.
- AI uses legal placement, actual credits, actual production time, and its own visibility memory; it receives no hidden information or resource bonuses.
- Exit with a complete 20–30 minute player-versus-AI skirmish.

### Phase 5 — Feature-Complete v1

- Add the Solar Spear, match setup, pause, surrender, restart, results, settings, and first-match onboarding.
- Contextual onboarding advances from observed player state: camera and selection, Reactor, Refinery, Barracks, production, control groups, attack-move, Operations Center, and Solar Spear. Prompts are nonblocking, dismissible, and remembered locally.
- Add original procedural radio tones, selection/build alerts, weapon and explosion effects, warning sounds, and one industrial ambient loop. Include master, music, and effects volume controls plus browser audio unlock on first interaction.
- Exit with the complete functional v1. If production must stop here, the game remains releasable with placeholder art and Normal AI.

### Phase 6 — Polished Release

- Generate and integrate the final industrial-sci-fi terrain, buildings, and unit sprites only after gameplay is stable.
- Validate each unit as a side-by-side eight-facing sheet for silhouette, scale, anchor, palette, lighting, and weapon consistency before replacing its placeholder.
- Apply team colors at runtime rather than duplicating sprite sheets.
- Pack assets into atlases no larger than 2048×2048. Keep the menu transfer under 3 MB compressed and the complete match payload under 20 MB, with preload progress and retry handling.
- Derive Easy and Hard from the Normal AI through reaction delay, action-rate limits, scouting frequency, attack thresholds, retreat discipline, and aggression—never separate AI implementations or cheats.
- Add structure selling, stale fog silhouettes, optional camera zoom, portraits, promotional artwork, screen-shake reduction, and final audiovisual polish.

## Gameplay Rules and Edge Cases

### Identity and Roster

- **Game:** Aurelia Falling
- **Faction:** Meridian Coalition
- **Resource:** Aurelite
- **Map:** The Golden Scar
- **Superweapon:** Solar Spear

Buildings:

1. Citadel Command Hub
2. Prometheus Reactor
3. Midas Refinery
4. Aegis Barracks
5. Vulcan Foundry
6. Oracle Operations Center
7. Cerberus Turret

Units:

1. Midas Harvester
2. Argus Rifle Squad
3. Cyclops Rocket Team
4. Hermes Scout
5. Atlas Battle Tank
6. Gorgon Siege Walker

### Economy

- Each starting field holds 12,000 credits of Aurelite and regenerates 50 credits per minute below capacity.
- Two contested central vents each hold 18,000 credits and regenerate 300 credits per minute.
- Central control therefore sustains late-game production; starting fields cannot support indefinite turtling.
- The Midas Refinery is the production structure for replacement Midas Harvesters, and every newly completed Refinery includes one free Harvester.
- If a player owns a Citadel but has no active or queued Harvester and cannot afford the cheapest valid income-restoration path, a once-per-match Coalition Relief Grant triggers after 30 seconds. With a Refinery, it grants only the missing credits needed to queue one Harvester there; without a Refinery, it grants only the missing credits for one Refinery, whose completion includes a Harvester.
- After the grant has been spent, an unrecoverable economy shows a persistent Economic Collapse warning and surrender prompt but does not force defeat while the player has an active or queued mobile combat unit, or a charging, ready, or already-launched Solar Spear. This preserves all-in attacks.
- A visible 60-second defeat countdown begins only when the player has no active or queued income path and no remaining offensive path defined above. Restoring either path cancels the countdown; otherwise it ends in defeat. The AI receives the identical grant, warning, viability, and defeat rules.

### Solar Spear and Match Resolution

- The Oracle charges the Solar Spear only while adequately powered.
- Once ready, the player selects currently visible ground; stale silhouettes are not valid targeting information.
- Launch creates a four-second public warning. Losing vision afterward does not cancel impact, and destroying or moving the original target does not redirect it.
- Destroying the Oracle before launch loses the charge; destroying it after launch does not stop impact.
- Citadel destruction ends the match. If both Citadels are destroyed on the same simulation tick, the result is a draw.

### Accessibility

- Distinguish teams by color, outline, emblem, and selection shape rather than color alone.
- Give Aurelite an emissive animation and resource icon so it remains readable against scorched terrain.
- Include UI scaling, subtitles/text equivalents for alerts, independent volume controls, and reduced screen shake.
- Key rebinding and mobile/touch controls remain out of scope.

## Test and Acceptance Plan

- Unit-test fixed-step progression, seeded PRNG, snapshot immutability, coordinate conversion, pathfinding, placement, build connectivity, harvesting, Refinery-based Harvester production, free Refinery Harvesters, both Relief Grant paths, Economic Collapse warning/cancellation/defeat, power states, prerequisites, refunds, combat counters, fog transitions, Solar Spear rules, and simultaneous victory.
- Test chokepoints, formations, blocked destinations, moving obstacles, unreachable targets, Harvester recovery, orphaned build radius, low-power charging, hidden-tab pause/resume without catch-up, and missing asset/audio fallback.
- Verify that a grant-spent player or AI with a standing/queued army or viable Solar Spear is never auto-defeated, and that the 60-second countdown begins only after the final offensive path is lost.
- Run seeded headless matches against Normal AI and verify legal economy, legal vision, rebuilding, attacks, match termination, and zero resource or visibility cheats.
- Run the same match seed repeatedly in the pinned Node/runtime version and compare state hashes at fixed intervals.
- Profile toward 60 FPS at 1280×720 with roughly 80 units and 25 structures; specifically measure pathfinding queues, fog updates, snapshot production, and React update frequency.
- Validate asset budgets, atlas dimensions, preload failure recovery, audio unlock, mute persistence, and local tutorial/settings persistence.
- Phase 0 acceptance additionally requires a successful private production deployment, documented payload limits, confirmed viewer-access requirements, and proof that the game can move between the selected Sites shell and a plain Vite shell without changing simulation or rendering modules.
- Feature-complete acceptance requires a new player to establish income, construct a powered base, understand counters, produce a mixed army, survive Normal AI, unlock the Solar Spear, and finish within 20–30 minutes.
- Final balance uses Normal as canonical; Easy and Hard must remain the same ruleset with pacing-only differences.

## Assumptions

- The repository is greenfield aside from planning documentation and has no existing Sites configuration.
- Phaser 4, vinext, and Codex Sites are a comparatively young stack; Phase 0 is an explicit feasibility gate rather than an assumption that the combined stack will work.
- Chrome and Edge desktop browsers with mouse and keyboard are the supported v1 targets.
- The game contains one map, one mirrored faction, and no multiplayer, campaign, match save/resume, aircraft, naval units, modding, or backend services.
- All artwork and gameplay milestones use placeholders until Phase 6, preventing generated-art consistency from blocking the simulation.
- All artwork, audio, lore, terminology, and maps are original. “Aurelia Falling” remains provisional pending formal trademark clearance.
