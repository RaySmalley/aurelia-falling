# Player UI Upgrade Plan

## Status

Approved sequencing target for roadmap Phase 13A, after the Phase 13 delta
snapshot and scalable-rendering contract and before the Phase 14 four-player
world model and match experience.

Phase 12 is complete. Structural Phase 13A work remains
blocked until the Phase 13 presentation contract is complete; only the safe
prework defined below may proceed earlier.

This plan extends the
[full-bleed battlefield and overlay HUD plan](./full-bleed-battlefield-ui-plan.md)
and the completed viewport-fit work. It does not replace their layout,
responsive, input, accessibility, or deterministic architecture contracts.

## Roadmap execution order

The upgrade is intentionally split so useful preparation can start without
building the final React information architecture on a presentation contract
that Phase 13 will replace.

```text
Phase 11: Budgeted pathfinding (complete)
        -> Phase 12: Simulation worker (complete)
        -> Phase 13: Delta snapshots and stable UI/economy channel
        -> Phase 13A: Main player UI upgrade
        -> Phase 14: Four-player world model and match experience
        -> Phase 15: Deterministic multiplayer
        -> Phase 16: Scale and release hardening
```

### Safe prework during Phase 13

- Run Phase 0 UX inventory and capture representative screenshot fixtures.
- Define shared design tokens, component anatomy, copy conventions, and
  acceptance measurements from Phase 1.
- Make focused low-risk fixes that preserve the current snapshot and HUD
  architecture.

This prework must not restructure `PhaseZeroShell`, introduce the contextual
panel controller, bind components to a temporary snapshot shape, or delay the
worker and delta-protocol critical path.

### Main Phase 13A implementation

Begin the structural implementation only after Phase 13 passes and its slower
UI/economy channel is versioned and stable. Phase 13A owns UI-plan Phases 2-5
and the core release gates from Phase 6.

### Phase 14 integration

Phase 14 extends the Phase 13A status, panel, setup, and accessibility patterns
for player slots, teams, alliances, colors, observers, and configurable victory
conditions. It must not introduce a parallel four-player UI architecture.

### Phase 16 hardening

Phase 16 repeats the completed Phase 13A accessibility and responsive contracts
under multiplayer, localization, soak, network-fault, and release conditions.
Basic keyboard, screen-reader, contrast, reduced-motion, and unsupported-
viewport behavior are Phase 13A requirements, not work deferred to Phase 16.

## Product outcome

Aurelia Falling should feel like a finished strategy game rather than a
technically complete simulation wrapped in a dense debug interface. A new
player must be able to identify the battlefield state, understand what can be
acted on, issue a command, and recognize the result without first learning the
implementation vocabulary of the game.

The upgrade is successful when the interface is:

- Immediately legible during combat without reading every label.
- Learnable through contextual guidance rather than permanent instructional
  text.
- Efficient for experienced mouse-and-keyboard players.
- Fully operable by keyboard and understandable with assistive technology.
- Visually cohesive across setup, active play, pause, settings, warnings, and
  results.
- Stable at every supported viewport and UI scale without obscuring the
  battlefield or shrinking primary hit targets.

## Current baseline

The current UI has a strong industrial science-fiction identity, a
viewport-filling battlefield, persistent economy status, a bounded command
dock, deterministic command routing, onboarding, subtitles, settings, focus
styles, and automated viewport coverage.

The highest-impact remaining experience gaps are:

- Onboarding can compete with or cover persistent status information.
- Construction and detailed selection content depend on internal scrolling,
  but their overflow affordances are subtle.
- Dense uppercase labels and similarly weighted panels weaken visual
  hierarchy.
- Short-viewport compaction removes useful guidance without providing an
  alternate discovery path.
- Telemetry presents implementation-facing diagnostics alongside
  player-facing intelligence.
- Empty, selected-unit, selected-structure, production, repair, placement, and
  Solar Spear states do not yet form one consistent contextual-panel model.
- Unsupported landscape and portrait viewports lack a complete, enforced
  fallback experience.
- Localization stress, complete keyboard focus restoration, screen-reader
  announcements, fullscreen transitions, and contrast states need broader
  verification.

## Experience principles

### Battlefield first

The map is the primary surface. Persistent chrome occupies only measured safe
regions, and contextual panels collapse when their task ends. No decorative
surface may permanently reduce the Phaser host rectangle.

### One dominant task per region

The top HUD answers "How is the match going?" The bottom HUD answers "What is
selected and what can it do?" Contextual panels answer one secondary question
at a time, such as what can be built, what is queued, or what intelligence is
known.

### Recognition before recall

Actions use concise labels, stable placement, state icons, and visible keyboard
shortcuts where room permits. Hidden guidance remains available through an
explicit help surface; players are not expected to remember text removed by a
compact breakpoint.

### Progressive disclosure

Primary status and orders remain visible. Build catalogs, queue detail,
telemetry, extended statistics, and help expand on demand. Opening one large
surface closes the previous surface unless the viewport has measured room for
both.

### State communicates through more than color

Selected, unavailable, charging, damaged, unpowered, disconnected, queued,
targeting, and failed states combine text, shape, iconography, and motion where
appropriate. Color never carries the complete meaning.

### Presentation remains non-authoritative

Tabs, disclosures, focus, tooltips, and animation are presentation-only React
state. Gameplay commands continue to enter the fixed-step simulation through
the command queue. React and Phaser consume read-only snapshots and events.

## Target information architecture

```text
+------------------------------------------------------------------------+
| MATCH / ECONOMY / POWER / OBJECTIVE                 SETTINGS / PAUSE    |
|                                                                        |
|                       FULL-BLEED BATTLEFIELD                         |
|                                                                        |
| CONTEXT ALERT OR ONBOARDING                                            |
| [SELECTED ASSET] [PRIMARY ACTIONS] [BUILD] [PRODUCTION] [INTEL] [HELP] |
+------------------------------------------------------------------------+
```

### Persistent top HUD

- Keep credits, power balance, Solar Spear readiness, match identity,
  settings, and pause visible.
- Give shortage, low power, launch readiness, and critical alerts a stronger
  priority than decorative match metadata.
- Use compact grouped status blocks with consistent icon, label, and value
  anatomy.
- Never allow onboarding, warnings, or subtitles to cover the top HUD.

### Persistent command strip

- Keep selection identity and the most common valid orders visible.
- Show concise disabled reasons for actions that are visible but unavailable.
- Preserve minimum 44 CSS pixel targets at every UI scale.
- Keep action ordering stable between unit and structure selections where the
  meaning is shared.

### Contextual panels

Use one panel controller for these mutually exclusive player tasks:

- Build: structure catalog, costs, prerequisites, power effect, and placement
  guidance.
- Production: producible units, active queue, progress, cancellation, repair,
  and sell actions.
- Selection: formation composition, integrity, cargo, current order, and
  structure connection state.
- Intel: visible contacts, explored area, opponent profile when rules permit,
  and player-relevant system status.
- Help: controls, command glossary, objective, and onboarding restart.

Every panel has a visible title, selected tab state, close action, internal
scroll boundary, keyboard focus target, and focus restoration behavior.

### Transient communication

- Place onboarding, placement feedback, subtitles, targeting guidance, and
  combat warnings in declared safe regions.
- Assign priorities so critical warnings displace guidance rather than overlap
  it.
- Pair every transient message with an appropriate persistent or historical
  location when the player may need to review it later.

## Visual system upgrade

### Typography

- Reserve uppercase monospace text for metadata, shortcuts, and machine-like
  status.
- Use sentence case for instructions, empty states, settings, confirmations,
  and longer action labels.
- Define a small type scale for display, panel title, body, label, and numeric
  status instead of styling each component independently.
- Guarantee readable line height and prevent critical values from truncating.

### Color and contrast

- Preserve teal and amber as the core identity while defining semantic tokens
  for success, warning, danger, disabled, selected, and informational states.
- Test text and meaningful icons against their actual translucent battlefield
  backdrops, not only against solid token colors.
- Increase separation between interactive surfaces and informational cards.

### Spacing and shape

- Introduce shared density, panel-padding, control-gap, radius, border, and
  elevation tokens.
- Reduce nested borders where adjacent panels already establish containment.
- Keep the current angular military language, but use it consistently for
  selection, tabs, alerts, and focus rather than as decoration everywhere.

### Icons and portraits

- Establish a single icon family for resources, power, orders, production,
  health, visibility, and panel navigation.
- Provide visible text or accessible names for every icon action.
- Use portraits to reinforce selection identity, not to consume space needed
  for primary commands.

### Motion and audio feedback

- Use brief transitions for panel entry, selection change, queue progress,
  targeting activation, and completed construction.
- Avoid decorative continuous animation in the HUD.
- Honor reduced-motion settings without removing state-change feedback.
- Coordinate visual confirmation with existing audio cues without making audio
  mandatory for understanding an outcome.

## Responsive contract

The supported interactive minimum remains 1024 x 640 CSS pixels in landscape.
The release baseline remains 1366 x 650, with 90%, 100%, and 110% UI scales.

### Wide mode

- Show selection identity, primary orders, and contextual tabs together.
- Permit two contextual surfaces only when measured space keeps both usable and
  the battlefield dominant.
- Show shortcut hints and descriptive secondary labels.

### Compact mode

- Show one contextual panel at a time.
- Replace clipped horizontal content with explicit previous/next controls,
  tabs, or a visible scroll affordance.
- Remove redundant headings and decorative copy before shortening labels.
- Keep an explicit Help action when inline shortcut guidance is hidden.

### Short mode

- Preserve the top status strip, selection identity, critical alerts, and
  primary order row.
- Collapse build, production, selection detail, intel, and help into one
  bounded panel body.
- Keep subtitles above the command strip and move onboarding away from required
  controls.

### Unsupported mode

- Below 1024 x 640 or in portrait orientation, prevent match start and show a
  fixed, keyboard-usable notice.
- Explain the minimum size and offer clear options to enlarge the window,
  rotate to landscape, or enter optional fullscreen.
- Do not create document scrolling behind the notice.

## Accessibility and input contract

- Maintain a logical focus order that follows the visual reading order.
- Move focus into an opened contextual panel and restore it to the invoking
  control when the panel closes.
- Support Escape to close non-critical panels without dismissing critical
  warnings accidentally.
- Expose selected tab, expanded disclosure, disabled reason, queue progress,
  targeting mode, warning urgency, and match result through semantics.
- Keep live-region announcements concise and prevent tick-driven status from
  repeatedly interrupting screen readers.
- Verify all primary play and menu workflows without a pointer.
- Preserve pointer-to-world accuracy around every overlay boundary.
- Maintain visible focus, 44 CSS pixel primary targets, UI scaling, subtitles,
  reduced motion, and persisted settings.

## Implementation phases

### Phase 0: UX inventory and measurable baseline

#### Work

- Capture setup and active-play screenshots across the release viewport and UI
  scale matrix.
- Inventory every HUD state, overlay, action, error, empty state, and focus
  transition.
- Record truncation, internal scrolling, overlap, hidden-action, and contrast
  failures in machine-readable fixtures where practical.
- Define representative gameplay states: no selection, mixed formation,
  Harvester cargo, damaged structure, longest production queue, placement
  failure, low power, Solar Spear ready/targeting/warning, pause, settings,
  victory, defeat, and runtime failure.

#### Exit gate

The team can reproduce each prioritized usability problem at a named viewport,
UI scale, application state, and input method.

### Phase 1: Shared design tokens and component anatomy

#### Work

- Consolidate type, spacing, semantic color, panel, icon, focus, motion, and
  control-size tokens.
- Create reusable status-block, action-button, tab, panel-header, empty-state,
  warning, progress, and disabled-reason patterns.
- Reduce one-off CSS rules without coupling the design system to simulation
  types.
- Document component states before migrating the complete HUD.

#### Exit gate

The same visual and semantic rules render equivalent states consistently in
the top HUD, command strip, contextual panels, setup, and overlays.

### Phase 2: Status hierarchy and safe regions

#### Work

- Recompose the top HUD around economy, power, objective readiness, and match
  actions.
- Define collision-free safe regions for onboarding, subtitles, placement
  feedback, Solar Spear warnings, and targeting guidance.
- Add message priority and displacement rules.
- Ensure alerts remain readable over light and dark battlefield regions.

#### Exit gate

No transient surface covers a persistent status value or required action in
any supported viewport state.

### Phase 3: Unified command strip and contextual panels

#### Work

- Introduce presentation-only active-panel state for Build, Production,
  Selection, Intel, and Help.
- Keep selection identity and primary valid orders persistent.
- Replace implicit construction overflow with visible navigation or scroll
  affordances.
- Consolidate production, repair, sell, queue, Solar Spear, and structure state
  into a predictable selected-structure flow.
- Replace implementation telemetry with player-facing intelligence; retain
  diagnostic data only in an explicitly labeled development surface.
- Add complete open, close, Escape, focus-entry, and focus-restoration behavior.

#### Exit gate

A new player can discover every gameplay action, and an experienced player can
reach every primary order without opening a detail panel.

### Phase 4: Onboarding and action feedback

#### Work

- Anchor onboarding to safe regions or relevant UI controls without covering
  match status.
- Make each step state-driven, concise, dismissible, restartable, and resilient
  to actions completed out of order.
- Add immediate accepted, unavailable, queued, completed, and failed feedback
  for construction, production, repair, sell, control groups, attack-move, and
  Solar Spear interactions.
- Keep critical explanations available in Help after transient guidance ends.

#### Exit gate

First-time players can complete the core economy-to-Solar-Spear loop without
external instructions, while returning players can disable guidance entirely.

### Phase 5: Responsive and unsupported experiences

#### Work

- Implement explicit wide, compact, short, and unsupported layout modes.
- Add the missing unsupported-viewport notice and prevent match start behind
  it.
- Test fullscreen entry and exit without making fullscreen mandatory.
- Stress long labels, numeric values, localized copy, browser zoom, safe-area
  insets, and 110% application UI scale.
- Ensure panel contents remain reachable without document-level scrolling.

#### Exit gate

Every supported state fits and remains operable at the release matrix; every
unsupported state presents a usable recovery path.

### Phase 6: Accessibility, motion, and release polish

#### Work

- Complete keyboard-only and screen-reader workflow audits.
- Verify focus visibility, focus trapping, focus restoration, names, roles,
  states, live regions, and disabled explanations.
- Run contrast checks against representative battlefield frames.
- Add restrained transitions and state feedback with reduced-motion parity.
- Perform final visual consistency, copy, loading, retry, and error-state passes.

#### Exit gate

The UI satisfies the acceptance matrix below without accessibility-specific
alternate gameplay behavior.

## Verification matrix

For setup and active play, test:

- 1024 x 640, 1366 x 650, 1366 x 768, 1280 x 720, 1440 x 900, and
  1920 x 1080.
- 90%, 100%, and 110% application UI scale.
- Mouse, keyboard-only, and representative screen-reader navigation.
- Default and reduced motion.
- Onboarding enabled and disabled.
- Every representative state defined in Phase 0.
- Repeated viewport resize and optional fullscreen entry/exit.
- Pointer commands adjacent to every interactive overlay edge.

Automated validation remains:

```powershell
npm run typecheck
npm run lint
npm run test:unit
npm run build
npm run test:viewport
graphify update .
```

Add targeted automated checks for:

- No document overflow or offscreen primary actions.
- Minimum hit targets at every UI scale.
- Contextual panel containment and dismissibility.
- Focus entry and restoration.
- Unsupported-viewport match-start prevention.
- Alert and onboarding safe-region separation.
- Pointer-to-world accuracy after panel and viewport changes.

## Product acceptance gates

- The battlefield remains visually dominant with contextual panels closed.
- A first-time player can begin a match, select assets, construct the required
  tech path, produce units, understand power, and arm Solar Spear without
  external documentation.
- Primary status and actions never require scrolling.
- Secondary content has an obvious expansion and overflow affordance.
- No onboarding, subtitle, warning, targeting, or placement message covers a
  required status value or action.
- All primary actions have clear enabled, disabled, active, success, and failure
  states.
- Player-facing terminology is consistent across HUD copy, onboarding,
  settings, and results.
- Keyboard and assistive-technology users can complete the same core gameplay
  loop as pointer users.
- Supported viewports pass without document scrolling; unsupported viewports
  prevent play and explain recovery.
- UI changes do not alter simulation state, command ordering, replay hashes,
  camera rules, or pointer-to-world results.

## Recommended pull-request slices

Safe prework during Phase 13:

1. Add the UX state inventory and representative screenshot fixtures.
2. Add shared design tokens, copy conventions, and primitive component anatomy
   without restructuring presentation consumers.

Main Phase 13A, after Phase 13 passes:

1. Recompose the top status hierarchy and implement collision-free transient
   safe regions.
2. Build the unified command strip and contextual-panel controller against the
   stable UI/economy channel.
3. Migrate Build, Production, Selection, Intel, and Help into the new panel
   model.
4. Upgrade onboarding, action feedback, and disabled explanations.
5. Add responsive modes, the unsupported-viewport experience, and fullscreen
   verification.
6. Complete core accessibility, motion, copy, and visual-regression gates.

Phase 14 extends these patterns for four-player match state. Phase 16 performs
the final multiplayer, localization, soak, and release-hardening pass.

Each slice is a large change under the repository workflow and must use a
`codex/*` branch with a ready-for-review pull request.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| A redesign hides expert controls | Keep stable primary actions and shortcuts; move only secondary detail behind explicit panels |
| Contextual panels obscure tactical play | Enforce one-panel-at-a-time behavior and measured safe regions |
| More React state leaks into gameplay | Limit UI state to presentation and route every command through the simulation queue |
| Visual polish reduces readability | Validate contrast, motion, density, and representative battlefield backdrops |
| Compact layouts become cryptic | Preserve Help access, disabled reasons, recognizable icons, and concise text labels |
| Internal scrolling hides content | Use visible overflow cues, panel titles, close controls, and keyboard-reachable scroll regions |
| Onboarding becomes brittle | Derive progress from accepted commands and snapshots, not DOM interaction order |
| Accessibility arrives too late | Add semantic and focus acceptance criteria to every phase and pull request |
| UI work destabilizes camera input | Retain the full-bleed host contract and rerun pointer-transform tests after every panel change |
| Scope expands into gameplay redesign | Keep simulation values, world rules, and content balance explicitly out of scope |

## Definition of done

The upgrade is complete when Aurelia Falling presents a cohesive, readable,
learnable, and efficient strategy-game interface across the complete viewport
and UI-scale matrix; primary information and actions remain immediately
available; contextual detail is discoverable and bounded; overlays never
collide; accessibility workflows pass; and simulation, input, build, viewport,
and Graphify verification remain green.
