# MemeGames

Monorepo for small meme-themed web games. First title: **Hormuz Hold'em**
(`Front/`), a Phaser 3 + TypeScript + Vite browser game. Each future title is
expected to get its own folder; they all share the same backend leaderboard
server.

## Repo layout

- `Front/` — Hormuz Hold'em client (the only game so far).
  - `src/main.ts` — Phaser game bootstrap and scene registration.
  - `src/scenes/` — Boot, Menu, Game, UI, Results, Leaderboard, Gallery scenes.
  - `src/core/` — game-side systems: `state.ts` (run state + `computeScore()`,
    the canonical submitted score, plus the `DayMission`/`DaySummary` types and
    day-system bus events), `art.ts`, `juice.ts`, `sfx.ts`, `palette.ts`,
    `settings.ts`, `memeUnlocks.ts` (persisted meme-collection progress).
  - **Day/mission system**: each 45s "day" (`tuning.json` → `dayNight.dayLengthSec`)
    is a mini-level with one rolled mission (price / escort / intercept / combo /
    perfect). `GameScene.startDay/endDay` drive it; between days the world
    freezes (`dayBreakT`) while the breaking-news band plays the recap + intel
    warnings. Threats and upgrades unlock by day (`tuning.json` → `days`).
    The news band is **reserved for day-system news** — per-event gameplay
    headlines were removed; silent market nudges use `EV.MARKET_NUDGE`.
  - **Meme collection system**: `src/core/memeUnlocks.ts` persists which meme
    templates have ever fired (localStorage `hormuz-memes-v1`, per-account like
    `src/backend/`), populated by `pickMeme()` in `src/core/memes.ts`.
    `GameScene.startDay/endDay` track same-day unlocks (`resetDayUnlocks`/
    `getDayUnlocks`) and attach them to `DaySummary.newMemesUnlocked`;
    `UIScene.showNewUnlocksPopup` shows them as an interstitial before the
    day-end shop panel. `src/scenes/GalleryScene.ts` ('Gallery') is a paged
    grid of every template in `memes.json` — full color once unlocked, grey
    while locked — reachable from the Menu and from Results (`GALLERY x/y`
    button); the zoom view has a SAVE MEME share/export button for unlocked
    memes. Results (`src/scenes/ResultsScene.ts`) is a newspaper front page
    ("THE HORMUZ HOLD'EM TIMES"): day-count headline, eyewitness subhead
    (`stats.memeMoment`), the run's last meme from `getMemeLog()` as the
    "photo", score/stat briefs, an oil-price sparkline from
    `stats.priceHistory`, and this run's new unlocks (`getRunUnlocks()` in
    `memeUnlocks.ts`, reset at run start next to `resetMemeLog()`), with
    slide-in entrance and a shared slide-out exit before every scene change;
    score submission auto-flows into the leaderboard once per run.
  - **Share/export system**: `src/core/share.ts` — `captureAndShare()`
    snapshots a logical-coordinate rect of the rendered frame
    (`renderer.snapshotArea`, DPR-scaled), stamps a "HORMUZ HOLD'EM"
    watermark bottom-right, then opens the OS share sheet (mobile web share
    with files) or downloads the PNG (desktop fallback), tracking a `share`
    analytics event. Used by the Results SHARE button (exports the newspaper
    card), the in-game meme popup's SAVE chip (`UIScene.showMemeReaction`),
    and the gallery zoom's SAVE MEME button. The tile list is read live from `MEMES.templates`, so adding or
    removing a meme in `memes.json` needs no code change to the gallery.
  - `src/config/` — `tuning.ts` + `tuning.json` (gameplay values),
    `layout.json` (UI layout), `memes.json` (meme reaction library: templates,
    slot geometry, per-trigger caption variants — picked/rendered by
    `src/core/memes.ts`). Tweak values in the JSON, not in code.
  - `src/backend/` — **the layer between front and back**; see below.
  - `src/dev/` — lil-gui devtools, layout/tuning live-editing helpers.
  - `scripts/art.mjs` (`npm run art`) — asset pipeline (sharp) that processes
    `assets/raw/` per `assets/manifest.json`.
  - `design/ART_DIRECTION.md`, `assets/CHATGPT_BRIEF.md` (core game art),
    `assets/MEME_BRIEF.md` (meme atlas workflow; generation rules + per-cell
    catalog live in `assets/raw/Meme/`) — art direction docs.
- `docs/backend-contract.md` — API contract for the leaderboard server
  (a separate Bun + SQLite repo; consumed over HTTP, no backend code here).

## Front ↔ back layer (`Front/src/backend/`)

Full details in `Front/src/backend/CLAUDE.md` — read it before touching
anything leaderboard-related. Summary:

- The backend is a standalone **leaderboard server** (default
  `http://localhost:3151`, overridable via `VITE_API_BASE` or `configureApi()`)
  with three endpoints: `POST /api/token`, `POST /api/score`,
  `GET /api/leaderboard`.
- `api.ts` is the raw typed HTTP client (game-agnostic, no Phaser),
  `leaderboard.ts` orchestrates the token lifecycle + localStorage
  persistence, `submitOverlay.ts` is the DOM name/email submit form.
- Key contract constraint: score tokens are single-use, IP-bound, and must be
  **≥60s old** at submit time — `GameScene` acquires the token at run start so
  it ages during play.
- The whole `src/backend/` folder is designed to be copied into future
  MemeGames titles unchanged (each game uses its own localStorage key).

## Commands (run inside `Front/`)

- `npm run dev` — Vite dev server.
- `npm run build` — typecheck (`tsc --noEmit`) + production build.
- `npm run art` — regenerate processed assets from `assets/raw/`.

## Conventions

- TypeScript strict, Phaser 3 scene-based architecture.
- Gameplay/UI numbers belong in `src/config/*.json`, not hardcoded.
- Keep `src/backend/` free of game-specific imports so it stays portable.

## Visual Verification Protocol

Applies to any UI/gameplay change in `Front/`:

1. Never claim a UI/gameplay change is done based on `tsc`/`npm run build` alone —
   those only prove it compiles, not that it renders or behaves correctly.
2. Start the dev server on a deterministic port, killing any stale Vite
   instance first (duplicate-port collisions have caused false verification
   against a stale build).
3. Never rely on browser-automation clicks against the Phaser `<canvas>` —
   they don't reach Phaser's input handler. Instead expose a `window.__dev`
   scene handle (current scene instance + a way to trigger transitions/state
   changes) and drive navigation/state through `javascript_tool` calls
   against that handle.
4. After every change: screenshot the affected screen, read console
   messages, and confirm zero uncaught errors before reporting anything.
5. If a screen renders blank or partial, debug it live (read console/network,
   inspect the scene state) and fix it before reporting back — never hand a
   broken screen to the user.
