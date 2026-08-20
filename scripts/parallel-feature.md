# Parallel feature workflow

How to build several independent features at once, each in its own git
worktree with its own dev server, without them colliding or losing work.

## Setup rules

1. **Branch from the current checkout's HEAD, not `origin/main`.**
   Use `git rev-parse HEAD` in the working checkout you're actually looking
   at, and create each worktree's branch from that commit
   (`git worktree add -b <branch> <path> <that-sha>`), not from
   `origin/main`. This keeps in-progress local commits in the loop.

2. **Uncommitted local changes must carry over, or the setup must warn.**
   Before creating any worktree, run `git status --porcelain`. If it's
   non-empty:
   - Preferred: commit a WIP checkpoint in the working checkout (or stash
     with `git stash push -u`) and apply the same diff on top of each new
     worktree branch (`git stash show -p | git apply` in the new worktree,
     or `git cherry-pick`/`git diff | apply` for a WIP commit).
   - If applying cleanly isn't possible (conflicts, binary changes), stop
     and explicitly tell the user which files couldn't be carried over —
     never silently drop uncommitted work.

3. **One dev server port per worktree — never share.**
   Each feature worktree runs `npm run dev -- --port <N>` inside `Front/`.
   Assign ports sequentially starting at 5180 (Vite's own default 5173 is
   left free for the main checkout) and record the mapping here as you
   create worktrees:

   | Worktree path | Branch | Port | Feature |
   |---|---|---|---|
   | _(none active)_ | | | |

   Update this table every time a worktree is created or pruned — it's the
   single source of truth for "is this port free."

## Definition of done (per feature)

A feature is **not** complete until all four are true:

1. `npm run build` (typecheck via `tsc --noEmit` + vite build) passes with
   no errors, run inside the feature's worktree.
2. The change is verified live in a browser against that worktree's dev
   server/port, with a screenshot taken as evidence.
3. The branch is merged into the *running checkout's* current branch (the
   branch that was HEAD when the worktree was created) — not into
   `origin/main` directly.
4. The worktree is pruned: `git worktree remove <path>` (and
   `git branch -d <branch>` once merged), and its row removed from the port
   table above.

## Running the workflow

1. Confirm the working checkout is clean or has changes safely captured
   (rule 2).
2. For each feature: `git worktree add -b feature/<slug> ../worktrees/<slug> <HEAD sha>`,
   assign the next free port, launch a subagent scoped to that worktree
   directory to implement + verify the feature per the "definition of
   done" above.
3. Once all agents report done, merge branches into the running checkout
   one at a time (not all at once) — after each merge, re-run
   `npm run build` and a quick browser smoke test in the main checkout's
   dev server before merging the next, so cross-feature conflicts surface
   immediately rather than after everything's merged.
4. Prune every worktree once merged.
5. Report a summary table: feature, files touched, merge status,
   screenshot, any conflicts resolved.
