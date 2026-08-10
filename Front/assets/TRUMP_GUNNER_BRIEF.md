# TRUMP GUNNER ATLAS BRIEF — player turret sprite sheet

One deliverable: `trump_gunner_atlas.png`, **2048×1536**, PNG with a **true
transparent background** across the whole sheet. Drop it into `assets/raw/` and
run `npm run art` — no code changes needed (slicing is already wired in
`assets/manifest.json`).

## What it is

The player's weapon in "Strait Shooter": a satirical caricature of Trump
manning a mounted machine gun at the bottom of the screen, seen **from behind**
(we look over his shoulders out to sea). Match the caricature style already
used in the meme atlases (same face/hair treatment as the Trump cell in
`meme_calmfire` — editorial-caricature, semi-realistic, NOT photoreal). Style
must match the existing broadcast-graphics art package: same palette, lighting
and line weight as `threats_atlas.png` / `tankers_atlas.png`.

Composition per cell:
- Lower half: Trump from behind — dark suit, shoulders and back of head
  dominate, signature blond hair clearly readable from behind.
- Mounted machine gun on a pintle/tripod in front of him, barrel pointing
  away from camera toward the aim direction.
- Slight over-the-shoulder perspective; no ground/base shadow baked in.
- No text, no flags, no logos, no muzzle smoke trails (the game adds tracers).

## Grid — 4 columns × 3 rows, every cell exactly 512×512

Cells must be aligned exactly to the grid; the subject must NOT cross cell
boundaries. **Identical framing in all 12 cells**: same camera, same scale,
same position of the body — only the pose changes. The game hard-swaps these
frames, so any drift between cells reads as jitter.

| Row | Aim direction | Col 1 | Col 2 | Col 3 | Col 4 |
|---|---|---|---|---|---|
| Top (y 0) | RIGHT — gun swung to the right | idle frame 1 | idle frame 2 | firing frame 1 | firing frame 2 |
| Middle (y 512) | CENTER — gun straight ahead/up | idle frame 1 | idle frame 2 | firing frame 1 | firing frame 2 |
| Bottom (y 1024) | LEFT — gun swung to the left | idle frame 1 | idle frame 2 | firing frame 1 | firing frame 2 |

State definitions:
- **idle 1 / idle 2**: relaxed grip, gun steady. The two frames differ only by
  a subtle breathing/shoulder shift (small — this loops at 2 fps).
- **firing 1 / firing 2**: braced recoil pose. Frame 1 = muzzle flash visible
  at the barrel tip; frame 2 = no flash, gun kicked back slightly. These
  alternate fast (10 fps) to read as automatic fire.

LEFT and RIGHT rows: rotate the gun and torso roughly 35–45° to that side;
head follows the gun. Keep both feet/base planted in the same spot as the
CENTER row.

## Delivery checklist

1. 2048×1536 exactly — the pipeline rejects any other size.
2. Genuinely transparent background (no white or letterboxed cells — if any
   cell renders with a background, regenerate the whole sheet).
3. All 12 cells consistent; if one cell is wrong, regenerate the WHOLE sheet
   keeping the good cells as close to identical as possible.
4. Save as `trump_gunner_atlas.png`.

If content policy blocks a named-person likeness, fall back to the same
generic "blond president in a dark suit and long red tie, seen from behind"
caricature used by the meme sheets — do not change the style.
