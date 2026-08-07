# ART GENERATION BRIEF v2 — read this fully, then follow the workflow at the bottom

You are the art generator for a mobile browser game called **"Strait Shooter"** — an
arcade game styled like a TV news broadcast about the Strait of Hormuz. Your job in
this chat is to generate the game's image assets in a single consistent visual style.

> v2 change: sprites are delivered as **ATLAS SHEETS** (grids of same-size cells),
> not individual images. One sheet per category. Cells must be exactly aligned to
> the stated grid because the game slices them by fixed coordinates.

## The look (applies to EVERY image)

Television news broadcast graphics. Think of the satellite maps and overlay icons a
news channel shows during a shipping-crisis explainer, plus editorial-caricature
portraits for the human characters. Semi-realistic, clean, professional — NOT cartoon,
NOT childish, NOT photoreal military simulation.

Hard rules for every image:
- No text or lettering unless the asset description explicitly asks for it.
  (Map labels, route arrows, tickers and captions are rendered by the game engine —
  do NOT bake them into images.)
- No watermarks, no channel logos, no real flags, no national or organizational symbols.
- All human characters are completely fictional archetypes and must not resemble any
  real person.
- When an asset says "transparent", deliver a PNG with a genuinely transparent
  background across the whole sheet.
- Atlas sheets: center each subject in its cell with even padding; subjects must not
  cross cell boundaries.

## Consistency is the #1 priority

All images must look like they belong to ONE broadcast graphics package. Atlases
enforce this within a category; across images, reuse the exact style, palette,
lighting and line weight of what came before. If asked for a revision, keep
everything else identical and change only what is named.

## Workflow — follow exactly

1. Generate the assets **in the order listed below, ONE image at a time**.
2. After each image, state the exact filename to save it as (e.g. `map_bg.png`)
   and wait for "next" or revision notes before continuing.
3. If a "transparent" asset renders with a background, immediately regenerate it
   with a true transparent background without being asked.
4. If a cell in an atlas comes out wrong, regenerate the WHOLE sheet keeping the
   good cells as close to identical as possible.
5. If content policy prevents part of a prompt, say so and propose the closest
   compliant alternative — do not silently change the style.

---

## ASSET LIST (generate in this order)

### 1. `map_bg.png` — 1920×1080, opaque — THE MOST IMPORTANT IMAGE
A television news satellite map of a narrow strategic sea strait between two desert
coastlines, landscape 16:9. The waterway runs horizontally across the middle of the
frame, slightly curved, occupying about 40% of the height. Desert land at top and
bottom with subtle mountains and a few coastal cities as small clustered light-gray
shapes, tiny port cranes and circular oil tank farms on both shores. Deep blue-teal
water with a gentle depth gradient and very subtle wave texture. Faint thin
latitude/longitude grid over everything. The water surface stays clean and empty —
game objects render on top. No ships, no aircraft, no labels. Photorealistic
high-altitude terrain, muted desert tans, professional broadcast-map look.

### 2. `tankers_atlas.png` — 1024×1536, transparent, grid 1 column × 3 rows (cells 1024×512)
Three oil tanker ship icons for placing on the news map, one per cell, all in the
same simplified semi-realistic broadcast-map icon style, high top-down angle, facing
right, bold readable silhouettes, subtle shading:
- Row 1: standard tanker, long dark-red hull, visible deck piping, white bridge at stern.
- Row 2: stockier tanker, dark-blue hull with orange deck containers.
- Row 3: luxury VIP tanker, gleaming gold-painted hull, polished highlights, subtle
  sparkle glints, slightly longer than the others.

### 3. `threats_atlas.png` — 1024×1024, transparent, grid 2×2 (cells 512×512)
Four threat icons in the same broadcast-map icon style, menacing but clean, one per cell:
- Top-left: cruise missile, side profile facing right, sleek gray-red body, small
  fins, short bright exhaust flame. No explosion.
- Top-right: military quadcopter drone seen from directly above, dark angular
  X-shaped body, four rotors, glowing orange sensor core.
- Bottom-left: naval sea-mine, dark spiked sphere half-submerged, small red light on top.
- Bottom-right: small fast patrol boat, top-down, facing left, compact dark-gray
  hull, prominent red siren light and radar mast.

### 4. `ui_chyron_frame.png` — 1920×240, transparent
A breaking-news lower-third: bold red tab on the left reading "BREAKING" in white
capitals; a dark navy glossy banner spanning the width with an EMPTY white text area;
thin red accent line on top; slim empty ticker strip along the bottom edge.

### 5. `meme_frame_broadcast.png` — 1920×1080, transparent
An empty TV broadcast frame overlay for meme screenshots: red "BREAKING NEWS" banner
top-left, a large empty lower-third chyron (dark navy, empty white text area, thin
red top line), slim empty ticker at the very bottom, a small empty picture-in-picture
box with a thin white border top-right, subtle corner vignette, faint scanline
texture. The center of the frame and the PiP interior stay fully transparent.
No other text.

### 6. `characters_atlas.png` — 2048×1024, opaque, grid 4 columns × 2 rows (cells 512×512)
Eight bust portraits, editorial news-caricature illustration, semi-realistic digital
painting, strong silhouettes, soft studio lighting, each on its own plain flat
single-color background (backgrounds may differ per character), one per cell.
All characters are completely fictional archetypes:
- Row 1, cell 1: female TV news anchor, CALM — helmet-like chestnut hair, sharp
  blazer, composed professional smile, hand touching earpiece. Flat medium-blue bg.
- Row 1, cell 2: SAME anchor, PANIC — eyes wide, mouth open in a gasp, hand pressed
  hard on earpiece, hairs out of place. Same bg.
- Row 1, cell 3: male financial analyst, CALM — mid-30s, disheveled dark hair,
  loosened tie, tired eyes, monitor glow, faint smug half-smile. Flat dark-gray bg.
- Row 1, cell 4: SAME analyst, PANIC — hands gripping hair, tie over shoulder,
  mouth open in despair, reddish glow. Same bg.
- Row 2, cell 1: stern elderly military-religious leader archetype — long gray
  beard, dark robes, dark cloth headwear, heavy lowered brows. Flat dark-green bg.
  No symbols.
- Row 2, cell 2: boastful president archetype — heavy orange tan, blond combover,
  navy suit, extremely long bright-red tie, confident smirk, thumbs up. Flat
  light-gray bg. No symbols.
- Row 2, cell 3: government spokesperson mid-denial — gray suit, sweat drops,
  strained smile, palm raised, two microphones at bottom edge. Flat beige bg.
- Row 2, cell 4: exhausted oil-tanker captain — weathered face, gray stubble,
  crumpled captain's hat, hi-vis vest, thousand-yard stare, oversized coffee mug.
  Flat teal bg.

### 7. `meme_twobuttons_blank.png` — 1024×1536, opaque
A blank two-button-dilemma meme template as an ORIGINAL illustration (not copied
from any existing photograph): top panel — two large red arcade buttons side by side
on a control console, each with an empty white label area; bottom panel — the back
of a sweating man in a suit wiping his forehead with a handkerchief, facing the
buttons. Editorial news-caricature illustration style. No text anywhere.

---

## Meme template pack — separate brief

The ten blank meme-template images (`meme_*_blank.png` beyond the two-buttons one)
are generated in their own chat from `assets/MEME_BRIEF.md` — do not generate them
from this brief.

---

## Removed in v2 (do not generate)

- `map_labels_overlay.png` — rejected; the game renders labels, route lines and
  arrows at runtime.
- Standalone single-sprite ship/threat/character images — superseded by the atlases.

Start now with asset #1 (`map_bg.png`) — or, if I say some assets already exist,
skip to the first one I still need. After each render, state the filename and wait
for my feedback before moving on.
