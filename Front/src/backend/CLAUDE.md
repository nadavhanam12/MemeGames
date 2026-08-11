# src/backend — leaderboard server client

Reusable client layer for the Meme Games leaderboard server (contract:
`docs/backend-contract.md` at the repo root, server default port 3151). Designed to be copied
into future MemeGames titles — nothing in here knows about Hormuz gameplay.

## Files

- `src/backend/api.ts` — raw typed HTTP client for the three endpoints
  (`POST /api/token`, `POST /api/score`, `GET /api/leaderboard`). Base URL from
  `VITE_API_BASE` env (default `http://localhost:3151`), overridable at runtime
  via `configureApi()`. 8s timeout; failures throw `ApiError` (status `null`
  = network/timeout). No Phaser imports.
- `src/backend/leaderboard.ts` — `LeaderboardService` orchestrates the token
  lifecycle and persistence. Exports the shared `leaderboard` instance
  (localStorage key `hormuz-leaderboard-v1`; new games create their own
  instance with their own key).
- `src/backend/submitOverlay.ts` — DOM overlay form (name/email) used by the
  results screen; DOM because text input needs the real keyboard/IME. Calls
  `service.submit()` and reports progress into the form's status line.
- `src/backend/analytics.ts` — fire-and-forget event tracker, `POST /api/event`
  (spec in `docs/backend-contract.md`; endpoint not yet implemented
  server-side, so sends currently fail silently). Exports `analytics`
  (`AnalyticsService('hormuz')`); `startRun()` mints a `runId`, `track(event,
  payload)` sends one event. Never awaited by callers — must not affect
  gameplay if the server is unreachable.

## Key flow (server contract constraints)

1. Tokens are single-use, IP-bound, expire, and must be **≥60s old** when the
   score is submitted. `GameScene.create()` calls `leaderboard.beginRun()` so
   the token ages during play; `submit()` waits out any remaining min-age
   (with 1.5s clock-slack buffer) and re-acquires if the token expired/errored.
2. On an accepted **saved** submit, the used token is stored as `bestToken` —
   passing it to `GET /api/leaderboard` returns `myRanking` even off-page.
   That's the only way to show the player's own rank (emails never come back).
3. Player identity (name/email) persists in the same localStorage record and
   prefills the submit form.

## Game integration points (this title)

- `src/core/state.ts` — `computeScore(stats)` is the canonical submitted score.
- `src/scenes/ResultsScene.ts` — auto flow after the results reveal: submit
  form (SKIP allowed) → LeaderboardScene. Runs once per run via registry flags
  (`autoFlowFor`/`submittedFor` keyed to the run's stats object identity);
  SUBMIT SCORE / LEADERBOARD buttons remain for manual use.
- `src/scenes/LeaderboardScene.ts` — period tabs, paging, myRanking row;
  launched with `{ from: 'Menu' | 'Results' }` for the back button.
- `src/scenes/MenuScene.ts` — LEADERBOARD button next to start.
