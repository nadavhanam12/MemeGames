# Prompting Claude — team-facing tips for this codebase

Short, actionable advice for prompting Claude on the MemeGames / Hormuz Hold'em codebase. Each entry should solve a real misunderstanding or wasted-effort pattern that has happened.

## Verifying changes in the browser

Two gotchas show up almost every session that does live browser verification:

1. **Simulated clicks don't reliably reach the Phaser canvas.** Standard click-simulation (via the browser automation tool) often doesn't register on Phaser's input pipeline. The reliable path is to use `window.phaserGame`, which is exposed in dev builds, and drive scene transitions / fire events directly through it (or via the dev event bus) instead of clicking buttons.
2. **Screenshot dimensions don't match the game's native resolution.** The captured screenshot is commonly 800×450 while the canvas/game runs at a different internal resolution (e.g. 1280×720) — clicking at "doubled" or otherwise unscaled coordinates misses the target. If you do need to click, scale coordinates to the screenshot's actual reported size first, or prefer the `window.phaserGame` approach above.

## Checking which dev server you're actually looking at

Multiple Claude Code sessions are often working this repo concurrently, each possibly running its own Vite dev server on a different port. Before treating a browser verification as conclusive, confirm which server/port you're pointed at and whether it's serving your latest edit (a stale sibling-session server showing old behavior is a recurring false negative here) — see the "sibling dev servers" note if using `/run`.

## How to use this file

Add a new section when a recurring misunderstanding or wasted-effort pattern surfaces. Keep entries terse; if a section grows long, promote it into a proper doc and link to it from here.


## Worktree / background-session changes

Background sessions in this repo work in isolated git worktrees, separate from the live main checkout the dev server actually serves. A change reported as "done" on a worktree branch is invisible on `http://localhost:5173` (or the phone-accessible LAN URL) until it's merged into main. When finishing a worktree change, proactively note that it needs merging and offer to do it (or ask), rather than waiting for the user to separately ask "is it merged?" or "merge to main" after the fact. Also check for uncommitted local changes in the main checkout before merging — the worktree branches from `origin/main`, not local state, so it can miss in-flight edits the user is making in their own session.
