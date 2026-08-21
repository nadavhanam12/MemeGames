# MemeGames

Monorepo for small meme-themed web games. First title: **Hormuz Hold'em**
(`Front/`), a Phaser 3 + TypeScript + Vite browser game. Each future title is
expected to get its own folder; they all share the same backend leaderboard
server.

## IN PROGRESS: portrait + "X/Twitter feed" art direction pivot

The game is mid-rewrite from landscape/TV-broadcast art direction to a
**portrait, social-feed-native** look (the whole game reads as an X/Twitter
post — see approved mockups discussed in the session that started this;
no mockup files are saved anywhere, this doc is the source of truth for
scope). Working from a phased plan; status as of the last session:

- **Phase 0 (portrait canvas) — DONE.** `GAME_W/GAME_H` flipped to
  `720×1280` in `src/core/palette.ts`; `VIEW`/`HEADER`/`ENGAGEMENT`/`COMMENTS`
  replaced the old landscape `VIEW`/`LEFT_BOX`/`BAND`/`STRIP` rects (stacked
  vertically instead of side-by-side). `src/core/orientation.ts`'s lock and
  `index.html`'s CSS rotate-overlay flipped from landscape-only to
  portrait-only.
- **Phase 1 (geometry migration) — DONE, verified.** All 6 scenes
  (`GameScene`, `UIScene`, `GalleryScene`, `MenuScene`, `ResultsScene`,
  `LeaderboardScene`) reflow correctly into the portrait frame. Old TV-art
  was still in place at this checkpoint (art came in Phase 2).
- **Phase 2 (feed-chrome reskin) — DONE, verified.** New
  `src/core/feedChrome.ts` (sibling to `broadcast.ts`) exports
  `createPostHeader`/`createEngagementBar`/`createCommentRow`/
  `createSuggestedCard`/`createTrendingPill` — every scene now composes the
  feed look from these instead of hand-rolled TV chrome. `broadcast.ts`'s
  `broadcastCut`/`broadcastReveal` (hard "static cut" scene-swap transition)
  were deliberately KEPT as-is per requirements — only `lowerThird`/
  `createTicker` call sites were dropped in favor of feed chrome.
  **Caught and fixed during verification**: `UIScene.buildChrome()` was
  painting an opaque full-canvas background over the gameplay viewport
  (UIScene renders on top of GameScene) — fixed by punching a `VIEW`-shaped
  hole in the fill instead of `fillRect(0,0,GAME_W,GAME_H)`. If gameplay
  ever renders as a blank/black box again, check that fill logic first.
  Two old animations were dropped as no-longer-applicable to the new HUD
  (combo-lost "crumple" effect, delayed cash-reveal-on-coin-landing) —
  flagged for the user's opinion, not yet resolved either way.
- **Phase 3 (scroll-down day-break transition) — DONE, verified.** The old
  `showDayCompletePanel`/`showNewUnlocksPopup`/`fadeOutModal` tap-through
  chain is gone. `onDayEnd` now calls `showDaySummaryPanel(s)` directly,
  which builds ONE stack (day-complete header → new-unlocks rows, folded in
  via the new `buildUnlocksSection` → mission/memes/intel cards → shop →
  NEXT DAY button) inside `panel`, plus a separate static full-screen
  `summaryBackdrop` rectangle (dims in, doesn't move). The stack slides in
  as a single tween from `finalY + GAME_H` up to `finalY` (below the growth
  logic that resizes `bg`/repositions `panel` for tall content), backdrop
  alpha tweens in alongside. `onDayBreak` mirrors it: `panel.y -= GAME_H`
  while `summaryBackdrop` fades out, both destroyed on complete. `settings.
  reducedMotion` skips both tweens (backdrop snaps to 0.7 alpha, panel
  stays at `finalY`). No `EV.*`/`DaySummary` contract changes.
  **Verified live** (not play-mode — see global no-play-mode-testing rule;
  this was inline JS driving `UIScene` methods directly via
  `window.phaserGame`, not gameplay): fired `showDaySummaryPanel` with mock
  `DaySummary`s (with and without `newMemesUnlocked`) and confirmed no
  overlap across the merged stack, then called `onDayBreak` and confirmed
  it tears down cleanly. Screenshots caught the entrance tween mid-flight,
  confirming the slide-from-below direction. Hit the browser-pane's
  documented `document.hidden` RAF-throttle quirk (tweens report
  `progress:1` but don't apply) while verifying — worked around by manually
  setting the end values, per the existing workaround note in this file;
  not a code bug.
- **Phase 4 (polish pass) — DONE, verified.** Three parts:
  1. **Engagement-count growth.** The ↗ share icon in `UIScene`'s
     engagement bar (`buildEngagementBar`/`pushEngagementCounts`) was a
     static placeholder (`0`, forever) — see the comment it used to carry.
     Added `TUNING.social.shareGrowthMin/Max` (50/100), `UIScene.shareCount`/
     `dayShareStart`/`dayShareTarget`: `onDayEnd` rolls next day's growth
     target from that day's performance (mission done + safe/lost ratio),
     `onDayStart` freezes `dayShareStart` at the current count, `onTimer`
     eases `shareCount` from `dayShareStart` toward `dayShareStart +
     dayShareTarget` across the day (ease-out, so it reads as early
     traction). Verified live: fired `onTimer` with synthetic elapsed
     values and confirmed the 0→25→44→54 ease-out curve, then confirmed the
     rendered ↗ count updates in the HUD.
  2. **Reduced-motion audit (Phase 2/3 additions).** Checked every
     `tweens.add` in `feedChrome.ts` and `UIScene.ts`'s day-summary/
     unlocks code (incl. Phase 3's new slide-in/out) — all correctly gated
     on `settings.reducedMotion`. The only unguarded tweens are the
     pre-existing hover-scale/quick-shake/toast conventions used
     consistently everywhere else in the codebase (not new Phase 2/3 gaps).
     No changes needed.
  3. **Mobile-aspect QA.** Screenshotted Menu, Gallery, Leaderboard,
     Results, and the Game+UI HUD (incl. the Phase 3 day-summary stack) at
     375×812. One apparent bug (Menu's "N people have played" text
     overlapping the LEADERBOARD/GALLERY row) turned out to be the
     `document.hidden` tween-freeze artifact below, not a real layout bug —
     confirmed by forcing final positions and re-screenshotting clean. No
     real layout issues found on any screen.

**To continue this work**: Phase 4 (and the whole portrait/feed-chrome
pivot) is done — no more phases queued. Pick up wherever Nadav points next.
Dev server quirk worth keeping in mind for any future UI verification in
this browser pane — the sandboxed/headless preview pane throttles Phaser's
tween/timer loop heavily while backgrounded (`document.hidden === true`),
which can look like broken layout (elements/positions stuck mid-animation,
or alpha stuck at 0) when it's actually just paused timers;
`scene.tweens.getTweens()` will report `state`/`progress` as already
complete without the property having actually been applied, so
`t.complete()` does NOT reliably force it — instead read the tween's
intended end value from your own code and assign it to the object directly
(e.g. `container.y = finalY; rect.alpha = 1;`) before trusting a
screenshot. Also: when driving scenes directly via `window.phaserGame.
scene.start(...)` for testing, stop every other scene first
(`scene.stop(key)` for each of Boot/Menu/Game/UI/Results/Leaderboard/
Gallery) — scenes render in registration order regardless of start order,
so a stale scene can visually stack on top of the one you meant to inspect.

## Repo layout

- `Front/` — Hormuz Hold'em client (the only game so far).
  - `src/main.ts` — Phaser game bootstrap and scene registration.
  - `src/scenes/` — Boot, Menu, Game, UI, Results, Leaderboard, Gallery scenes.
  - `src/core/` — game-side systems: `state.ts` (run state + `computeScore()`,
    the canonical submitted score, plus the `DayMission`/`DaySummary` types and
    day-system bus events), `art.ts`, `juice.ts`, `sfx.ts` (synthesized SFX +
    ambient ocean/tension bed via `startAmbient`/`setTension`), `palette.ts`,
    `settings.ts`, `memeUnlocks.ts` (persisted meme-collection progress),
    `broadcast.ts` (shared "TV broadcast" screen language: `broadcastCut`/
    `broadcastReveal` channel-cut scene transitions, `staticBlink`,
    `lowerThird` news straps, `createTicker` headline crawl, `stampIn` —
    used by Menu/Results/Leaderboard/Gallery and the UIScene day recap).
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

## Parallel agent workflow

Nadav keeps one dev server (`npm run dev`, in `Front/`) running from the
**main repo checkout** at all times to test changes. When multiple agents
work in parallel (git worktrees, or agents spawned via Agent/Workflow), each
gets its own directory and often its own dev server on its own port — that
port is only for the agent's own verification, never the one Nadav is
watching.

When an agent's work is done and verified (typecheck at minimum):

1. Commit it on the worktree branch.
2. Merge that branch into `main` **in the main repo checkout** (standing
   authorization for commit+merge — no need to ask; still don't push unless
   asked). See global feedback memory `merge-to-main-when-done`.
3. Do not tell Nadav to restart or switch servers — merging into `main`
   updates the files on disk in the main checkout, and the already-running
   dev server there picks it up via Vite's file watcher/HMR. Nadav just
   refreshes his existing tab.
4. Clean up the worktree once merged; don't leave finished worktrees mounted
   ("no parallel worktrees" — see the same memory rule).

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
