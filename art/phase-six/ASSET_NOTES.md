# Phase 6 asset notes

The production assets in `public/assets/phase-six/` were generated with the
built-in image-generation tool, then normalized locally for deterministic
runtime use.

## Golden Scar key art

- Output: `golden-scar-key-art.webp`
- Source prompt: wide industrial-science-fiction promotional key art for
  Aurelia Falling, with Gold and Cyan forces divided by a luminous Aurelite
  fault line, a distant Solar Spear strike, amber dusk, teal industrial
  emissives, no text, logos, UI, watermarks, or third-party designs.
- Runtime treatment: decorative match-setup background with a dark contrast
  veil. Compressed to WebP without changing its composition.

## Unit facing atlas

- Output: `unit-facing-atlas.webp`
- Source prompt: six Meridian Coalition unit rows in roster order, each with
  eight clockwise compass facings, neutral team-mark panels, consistent
  top-left lighting, fixed scale and anchor, on a flat chroma-key background.
- The first result had only seven columns, so it was rejected and is not
  shipped. A targeted edit corrected the sheet to exactly 8 columns × 6 rows.
- Post-processing removed the chroma key and normalized the sheet to
  1280×1248, producing exact 160×208 cells. Phaser loads frames 0–47 from one
  atlas; runtime Gold/Cyan markers provide team identity without duplicate
  sheets.
- The runtime retains the previous procedural shapes as a missing-asset
  fallback after Phaser exhausts its configured loader retries.

Run `npm run assets:validate` to verify dimensions, cell alignment, and the
3 MB menu / 20 MB match compressed-payload budgets.
