# Meme asset workflow (atlas-based, v2)

The original "10 blank classic templates" brief is retired. Meme art is now
generated as **2×2 character-variation atlases** — the generation-side rules live
in `assets/raw/Meme/INSTRUCTIONS.md` and every approved atlas is documented in
`assets/raw/Meme/MEME_CATALOG.md` (layout, cell contents, suggested triggers).

## Generation (in the art chat)

Follow `assets/raw/Meme/INSTRUCTIONS.md`. Summary of the contract the game
relies on:

- One reference meme → one **2048×2048 opaque PNG**, a strict 2×2 grid of
  **1024×1024 cells** (four game-relevant character/situation variations).
- No baked text anywhere; caption zones stay clean (the game renders captions).
- Update `MEME_CATALOG.md` with the atlas layout + one line per cell.

## Integration (in this repo) — per new atlas

1. Drop the atlas PNG into `assets/raw/Meme/` (keep the catalog next to it).
2. Add an atlas entry in `assets/manifest.json`: `kind: "atlas"`,
   `file: "Meme/<name>.png"`, `size: [2048, 2048]`, `targetWidth: 720`, and a
   `frames` block naming each cell (`meme_<format>_<character>` → x/y/w/h).
   If a sheet is letterboxed (black band at the bottom), measure the real
   content height and use it as the frame `h` for the bottom row.
3. Add one template per cell in `src/config/memes.json` → `templates`
   (`artKey` camelCase, `artFile` = `<frame name>.png`, `aspect` = h/w of the
   frame, caption `slots`), then wire variants into `triggers` with captions.
   No code changes needed — `src/core/art.ts` and `scripts/art.mjs` pick meme
   art keys up from `memes.json` automatically.
4. Run `npm run art` (inside `Front/`) and reload the game.

Slot geometry conventions used by existing templates (fractions of the rendered
cell, origin at center):

- Full-bleed art: white stroked captions top `y: -0.40` and bottom `y: 0.40`.
- White top caption band (podcast/crying style): one dark-text slot `y: -0.40`.
- Blank placard/board in the art: one dark-text slot centered on the board.
- Multi-figure label memes (distracted style): one small stroked slot per figure.
