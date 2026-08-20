# Meme asset workflow (atlas-based, v2)

The original "10 blank classic templates" brief is retired. Meme art is now
generated as **2×2 character-variation atlases** — the generation-side rules are
split into two files in `assets/raw/Meme/`:

- `INSTRUCTIONS.md` — the **game-agnostic pipeline** (atlas format, composition
  locking, text/symbol bans, normalization, versioning, QA). Reused unchanged
  by every future MemeGames title.
- `GAME_BRIEF.md` — the **per-game context** (game summary, gameplay-situation
  palette, cast + likeness descriptions, approved style). Rewritten per game.
- `MEME_SPEC_PACK.md` — **pre-written meme concepts** (format, tension, all
  four cell scenarios, cast, caption zones locked upfront); the art chat
  executes specs one at a time instead of inventing concepts. New batches are
  authored per game.

Every approved atlas is documented in `assets/raw/Meme/MEME_CATALOG.md`
(layout, cell contents, suggested triggers).

## Generation (in the art chat)

Paste **both** `INSTRUCTIONS.md` and `GAME_BRIEF.md` into the art chat.
Summary of the contract the game relies on:

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
   (`artKey` camelCase, `artFile` = `Memes/<frame name>.png`, `aspect` = h/w of
   the frame, caption `slots`), then wire variants into `triggers` with
   captions. No code changes needed — `src/core/art.ts` and `scripts/art.mjs`
   pick meme art keys up from `memes.json` automatically.
4. Run `npm run art` (inside `Front/`) and reload the game.

Processed meme art is written to `public/assets/Memes/`, kept separate from
core game art in `public/assets/` — `scripts/art.mjs` routes any output
filename starting with `meme_` there automatically (see `isMemeFile` in that
script), so nothing extra is needed as long as new meme filenames keep that
prefix.

Slot geometry conventions used by existing templates (fractions of the rendered
cell, origin at center):

- Full-bleed art: white stroked captions top `y: -0.40` and bottom `y: 0.40`.
- White top caption band (podcast/crying style): one dark-text slot `y: -0.40`.
- Blank placard/board in the art: one dark-text slot centered on the board.
- Multi-figure label memes (distracted style): one small stroked slot per figure.
