# Dev-server session confusion across concurrent Claude sessions

**Date:** 2026-08-11
**Severity:** medium — no shipped bugs, but repeated wasted diagnostic time and at least one false-negative verification (checking a stale server and concluding a fix hadn't landed).

## Context

Nadav frequently runs multiple Claude Code sessions against the MemeGames repo at the same time (e.g. one doing font work, one doing gameplay tuning). Each session tends to start its own Vite dev server if it doesn't see one obviously running, and the project's `launch.json` originally allowed auto-port fallback.

## What happened

Across the week, sessions repeatedly:
- Started a second (or third) dev server on a random port because the default port was held by a sibling session, producing user-visible confusion ("why are there two ports?", "is there two versions of the game?").
- Verified a change against a server instance that turned out to be a *different* session's stale build, initially reading as "the fix didn't work."
- Had to manually hunt down and kill zombie Vite/esbuild processes left over from earlier sessions.

A partial fix landed mid-week (`--strictPort` pinning in `launch.json`, plus a documented attach-only config), but the underlying pattern — a new session not checking for/clearly reporting on sibling servers — kept recurring afterward.

## What was actually correct

Per-incident, Claude generally diagnosed correctly once asked ("that port is another session's server, running an older copy") — the gap was doing this check proactively, before reporting a verification as conclusive, rather than reactively after confusion surfaced.

## Root cause

**incomplete-context** — each session's browser-verification step assumed it was looking at its own dev server without checking, when in a repo this actively multi-sessioned that assumption fails often enough to matter.

## Recommended fix

1. `.claude/PROMPTING.md` — added a browser-verification-gotchas section (this incident is the backing evidence for the "which dev server are you looking at" note).
2. `/run` skill — tune-up suggestion to detect sibling dev servers before starting a new one and to state which port/instance is being shown.

## Prompt tip

If a fix appears not to have worked in a live browser check, verify which dev server (port, and whose session started it) you're actually looking at before concluding the fix is wrong — a stale sibling-session server is a likely false negative in this repo.
