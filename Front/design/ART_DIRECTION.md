# Art Direction v2 — "As Seen On The News"

Replaces the editorial-cartoon direction. The game should look like a breaking-news
broadcast about the Strait of Hormuz that someone turned into a playable feed post.

## Core idea

**Mixed realism:** the *world* is a satellite-style news map (realistic terrain, real
geography vibes), while the *game objects and UI* are the clean iconic overlays news
channels draw on top of such maps (arrows, ship icons, alert badges, chyrons).
This is exactly how TV explainers look, and it keeps gameplay readable.

## Format

- **Landscape, 1280×720**, phone-held-sideways first (`Scale.FIT`, touch targets ≥ 70px).
- The strait runs **horizontally** across the middle of the screen; tankers travel
  left → right along it. Coasts at top and bottom of the map.
- News UI frames the action: thin ticker/chyron at the bottom, price + timer in the
  top corners, upgrades in the bottom corners near the thumbs. The map stays dominant.

## Layers (back to front)

1. **Map background** (AI-generated, 1280×720): satellite-style terrain, desert tans,
   deep ocean blues, subtle depth shading in the water, faint lat/long grid.
2. **News overlay graphics** (AI-generated or code): dashed shipping lane, big
   direction arrows, location labels in news-graphics type ("STRAIT OF HORMUZ"),
   alert circles.
3. **Game objects** (AI-generated sprites, transparent PNG): iconic top-down ships
   and threats in news-infographic style — simplified, bold, instantly readable.
4. **Broadcast UI** (code + a few AI frames): chyron bar, BREAKING banner, tickers,
   prediction-market panel, upgrade buttons styled as studio dashboard controls.

## Palette

Keep the existing market colors for meaning, add news-graphics neutrals:

- Ocean deep `#0A3550`, ocean shallow `#0E5E86`, desert tan `#C9A96A`, terrain shadow `#8A6F45`
- News red `#C8102E` (breaking/alerts), news blue `#003A70` (chyron/frames), white `#FFFFFF`
- Market green `#35D07F`, market red `#FF4D5A`, oil gold `#F4B942`, event purple `#9B5DE5`

Threat identity stays **shape + icon**, never color alone.

## Character roster — archetype stand-ins (never named, never real likenesses)

Recurring cast, semi-realistic news-caricature illustration style, bust portraits,
strong silhouettes, exaggerated expressions. Each needs 2 expressions (calm / panic)
for meme composition.

1. **The Commander** — stern bearded leader in dark robes and headwear, heavy brows.
2. **The Dealmaker** — orange-tanned president type, too-long red tie, thumbs up.
3. **The Spokesperson** — sweating official at a podium mid-denial.
4. **The Anchor** — helmet-haired news anchor, hand to earpiece, mid-gasp.
5. **The Analyst** — disheveled finance guy, loosened tie, three monitors glow.
6. **The Captain** — exhausted tanker captain, giant coffee, thousand-yard stare.

Rules: original characters only; no real person's face, name, flag insignia, or
party/organization symbols. Archetype is carried by costume, pose, and vibe.

## Meme output (the viral deliverable)

Two families, chosen at session end by what actually happened:

**A. Fake broadcast screenshot** — a "screenshot" of GLOBAL NEWS 24: map behind,
red BREAKING bar, chyron carrying the player's stat as the headline
("LOCAL HERO SAVES 4 TANKERS; OIL DROPS $12"), anchor portrait in corner.
Triggers: default / strong runs.

**B. Classic meme structures** (structures only — never the original photos),
composed at runtime from character portraits + panels:
- Two-button dilemma (Dealmaker sweating over two red buttons)
- Panik → Kalm → Panik (Analyst, 3 panels) — triggers on near-miss-heavy runs
- Expectation vs Reality (split panel) — triggers on tanker losses
- Press-conference denial (Spokesperson + player stat as the denied fact)

All memes: 1280×720 landscape (feed-friendly), stat baked in, small game branding,
composed on a hidden canvas and exported as PNG via Web Share API / download.

## Pipeline (Phase A, v2 — atlas-based)

Assets are generated via ChatGPT using `assets/CHATGPT_BRIEF.md` (the drop-in brief)
and delivered as **atlas sheets** where possible: `tankers_atlas.png` (1×3 grid,
1024×512 cells), `threats_atlas.png` (2×2, 512×512 cells), `characters_atlas.png`
(4×2, 512×512 cells, opaque flat backgrounds), plus standalone `map_bg.png`
(1920×1080), `ui_chyron_frame.png`, `meme_frame_broadcast.png`, and
`meme_twobuttons_blank.png`. `assets/raw/ASSET_GUIDE.md` documents the delivered
pack; `assets/manifest.json` (v2) holds the machine-readable frame coordinates and
target sizes. `npm run art` slices atlases per the manifest, trims transparent
padding, resizes, and outputs to `public/assets/`; the game loads whatever exists
and falls back to programmatic art for the rest.

Decisions carried into v2: `map_labels_overlay` was rejected — all labels, route
lines, arrows, tickers and captions are rendered by the game at runtime (crispness +
localization), never baked into PNGs except meme template frames. Missile sprite
faces right, patrol boat faces left (flip in code as needed). Phase C later swaps
manual generation for API calls against the same manifest.

## Consistency rules

- Every prompt starts with the same STYLE block (see manifest).
- Generate all variants of a category in one ChatGPT conversation and reference
  "same style as the previous image" to fight drift.
- Regenerate rather than accept an off-style asset — one mismatched sprite breaks
  the "single broadcast" illusion.
- No text baked into sprites (localization + crispness); text is rendered by the game.
  Exception: map labels and meme template frames.
