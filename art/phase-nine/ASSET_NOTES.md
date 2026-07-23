# Phase 9 asset notes

The production atlases in `public/assets/phase-nine/` were generated with the
built-in image-generation tool, then normalized locally for deterministic
runtime use. Both atlases use exact 256 x 288 cells in a 4 x 2 grid and retain
transparent padding for Phaser sprite-sheet loading.

## Structure atlas

- Output: `structure-atlas.webp`
- Source: `art/phase-nine/structure-atlas-source.png`
- Prompt: seven original Meridian Coalition industrial-science-fiction
  structures in roster order (Citadel, Reactor, Refinery, Barracks, Foundry,
  Operations Center, Turret), with one empty cell; consistent three-quarter
  isometric camera, charcoal gunmetal materials, restrained amber/cyan
  emissives, and a flat magenta chroma background.
- Runtime treatment: one atlas supplies live structures, construction alpha,
  damaged tinting, fog-memory silhouettes, and CSS portraits. Team-colored
  battlefield marks remain separate so color is not the only identity cue.

## Battlefield atlas

- Output: `battlefield-atlas.webp`
- Source: `art/phase-nine/battlefield-atlas-source.png`
- Prompt: two industrial basalt ground tiles, two blocked/scorched tiles, two
  subtle ground decals, one luminous Aurelite field, and one Aurelite icon in
  a consistent isometric 4 x 2 grid on a flat magenta chroma background.
- Runtime treatment: terrain frames are stamped once into a Phaser 4 render
  texture in deterministic painter order. The Aurelite field and icon are
  reused independently; procedural terrain and field shapes remain available
  when the asset load fails.

The built-in Imagegen path was used for both sheets. Chroma removal used the
installed Imagegen helper with border sampling, soft matte, and despill. The
alpha sheets were normalized to 1024 x 576 and compressed as WebP without
changing cell order.

Run `npm run assets:validate` to verify dimensions, alpha, cell alignment, the
2048 px atlas ceiling, and the 3 MB menu / 20 MB match payload budgets.
