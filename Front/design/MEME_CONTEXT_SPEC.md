# Meme Context Spec — Tier 1 (context-scored variants) + 2 state watchers

Status: **spec, not implemented.** Approved direction from design discussion:
memes should react to the run's *trajectory* (price trend, streaks, loss
history, contradictions), not just the discrete event that fired them.

## 1. The `MemeContext` object

Built by `GameScene` at emit time and passed with every `meme-moment`:

```ts
// src/core/memes.ts
export interface MemeContext {
  price: number;           // stats.oilPrice, rounded
  trend: 'rising' | 'falling' | 'stable';
  tankersLost: number;     // stats.tankersLost
  tankersSafe: number;     // stats.tankersSafe
  combo: number;           // stats.combo
  eventActive: boolean;
  eventsWon: number;
  eventsLost: number;
  elapsed: number;         // seconds into the run
  dangerActive: boolean;   // meltdown countdown currently running
  threats: number;         // threats.length (alive, on-screen)
}
```

- **`trend`** is derived from `stats.priceHistory`: compare `oilPrice` to the
  sample from ~8s ago (tail of the history buffer). `>= +5` → `rising`,
  `<= -5` → `falling`, else `stable`. The ±5 band and 8s window live in
  `memes.json` settings (`trendWindowSec`, `trendBand`), not in code.
- `GameScene` gets one private helper `memeContext(): MemeContext`; every
  existing `bus.emit('meme-moment', label)` becomes
  `bus.emit('meme-moment', label, this.memeContext())`.
- **Back-compat / dev console:** `ctx` is optional end-to-end. The dev handle
  `bus.emit('meme-moment', 'EVENT LOST')` keeps working — `pickMeme` treats a
  missing ctx as "no conditions match", i.e. today's uniform-random behavior.

## 2. memes.json variant schema additions

Variants gain two optional fields; everything existing stays valid unchanged.

```json
{
  "t": "vehicleAnalyst",
  "c": ["he's on a streak", "the chart hasn't noticed"],
  "when": { "trend": "rising", "combo": ">=5" },
  "weight": 2
}
```

### `when` — hard eligibility filter

All clauses must pass or the variant is excluded from the pool (it's a
requirement, not a preference). Supported keys = `MemeContext` fields.

Value grammar per field type:

| Field type | Accepted forms | Examples |
|---|---|---|
| numeric (`price`, `combo`, `tankersLost`, `threats`, `elapsed`, …) | `">=N"`, `"<=N"`, `">N"`, `"<N"`, `"N..M"` (inclusive range), bare number (exact) | `"price": ">=150"`, `"elapsed": "0..60"` |
| enum (`trend`) | string or array-of-strings (OR) | `"trend": ["rising", "stable"]` |
| boolean (`eventActive`, `dangerActive`) | `true` / `false` | `"dangerActive": true` |

Unknown keys or malformed values: warn once via `console.warn` in dev, treat
the clause as failed (variant stays out — fail closed so a typo can't make a
conditional variant fire everywhere).

### `weight` — optional multiplier, default 1

Used only among *eligible* variants (see scoring).

### Scoring in `pickMeme(label, ctx?)`

1. Pool = `triggers[label]` (or `fallback` for unknown labels), minus the
   last-shown template, same as today.
2. Drop variants whose `when` fails against `ctx`. Variants without `when`
   are always eligible. If the filter empties the pool, fall back to the
   unconditioned variants of the pool (never zero candidates).
3. Weighted random pick. Effective weight =
   `(1 + number of satisfied `when` clauses) * weight` — so a variant that
   matched two conditions is 3× likelier than a generic one, but generics
   still appear (keeps variety, avoids the same "smart" line every time).

### Caption tokens

`pickMeme` substitutes tokens in captions against `ctx` before returning:

| Token | Replacement |
|---|---|
| `{price}` | `Math.round(ctx.price)` (no `$` — author writes `"OIL AT ${price}"`) |
| `{combo}` | `ctx.combo` |
| `{lost}` | `ctx.tankersLost` |

Missing ctx → tokens replaced with `"???"` (visible in dev, signals a wiring
bug). **The substituted strings are what get pushed to `memeLog`**, so the
results-screen recap replays the real numbers from the run.

## 3. Watcher 1 — dissonance (`"WINNING BUT AT WHAT COST"`)

Fires when the player's personal performance and the world state contradict
each other — the home turf of side-eye / condescending / calm-fire formats.

Two arm conditions (either one):

- **A — thriving while it burns:** `combo >= 5 && price >= 150 && trend !== 'falling'`
- **B — market fine, your ships aren't:** `price <= 90 && tankersLost >= 2`

Mechanics:

- Checked by a 1s-cadence accumulator in `GameScene.update()` (skip when
  `this.over`).
- **Edge-triggered:** fires once on *entering* the state; re-arms only after
  the condition has been false for ≥ 10 consecutive seconds.
- Per-watcher cooldown `cooldownSec: 45` on top of the global `minGapMs`.
- Before emitting, GameScene checks its own copy of the global gap
  (`elapsed - lastMemeEmit >= minGapMs/1000`); otherwise the edge would be
  consumed by UIScene's cooldown with nothing shown. Event-driven triggers
  keep their current behavior (they may still be dropped by UIScene — losing
  an *event* meme to the cooldown is fine, losing a *rare state edge* is not).

Starter variant pool (illustrative captions, final pass comes with the
full caption rewrite):

```json
"WINNING BUT AT WHAT COST": [
  { "t": "vehicleAnalyst", "c": ["{combo} straight intercepts", "oil at ${price}. hm."],
    "when": { "combo": ">=5", "price": ">=150" } },
  { "t": "condescendingExec", "c": ["KEEP 'WINNING', KID", "I GET PAID EITHER WAY"],
    "when": { "price": ">=150" } },
  { "t": "calmFireCaptain", "c": ["personal best combo", "everything else is on fire"],
    "when": { "combo": ">=5" } },
  { "t": "condescendingKhamenei", "c": ["CHEAP OIL, EMPTY SEA", "{lost} TANKERS SAY HI"],
    "when": { "tankersLost": ">=2", "price": "<=90" } },
  { "t": "vehicleDiplomat", "c": ["the market recovered", "the ships did not"] }
]
```

## 4. Watcher 2 — quiet stretch (`"SUSPICIOUSLY QUIET"`)

Fires when nothing has happened for a while — the *only* correct moment for
squint formats ("TOO QUIET" must actually follow quiet), and a natural beat
for change-my-mind editorial takes.

Arm condition (all):

- `quietSeconds >= 25` — no tanker lost, no event active or resolving, and no
  price-threshold crossing in the last 25s (GameScene tracks a
  `lastIncidentAt` timestamp bumped by: tanker loss, event start/resolve,
  threshold emit).
- `threats <= 1` on screen.
- `trend === 'stable'`.

Mechanics: same edge-trigger + re-arm pattern as watcher 1 (re-arms on any
incident), `cooldownSec: 60`, same pre-emit global-gap check. Also suppressed
during the first 15s of a run (openings are always quiet; not a joke yet).

Starter pool:

```json
"SUSPICIOUSLY QUIET": [
  { "t": "squintCaptain", "c": ["NO DRONES FOR A WHILE NOW", "THEY'RE PLANNING SOMETHING"] },
  { "t": "squintIran", "c": ["WHY IS NOBODY SHOOTING", "SUSPICIOUS"] },
  { "t": "squintAnalyst", "c": ["OIL FLAT AT ${price}", "flat is never free"] },
  { "t": "changeMindDiplomat", "c": ["PEACE IS BREAKING OUT — CHANGE MY MIND"] },
  { "t": "twoButtons", "c": ["ENJOY THE CALM", "ASSUME IT'S A TRAP"] }
]
```

## 5. Settings additions (memes.json `settings`)

```json
"settings": {
  "durationMs": 4000,
  "streakCombo": 10,
  "countdownTickMs": 500,
  "minGapMs": 15000,
  "trendWindowSec": 8,
  "trendBand": 5,
  "watchers": {
    "dissonance": { "cooldownSec": 45, "rearmSec": 10,
                    "comboMin": 5, "priceHigh": 150, "priceLow": 90, "lostMin": 2 },
    "quiet":      { "cooldownSec": 60, "rearmSec": 10,
                    "quietSec": 25, "maxThreats": 1, "graceSec": 15 }
  }
}
```

All tuning numbers live here per repo convention — the watcher code reads
them, never hardcodes.

## 6. File-touch list

| File | Change |
|---|---|
| `src/core/memes.ts` | `MemeContext` interface; `when` filter + weighted scoring + token substitution in `pickMeme(label, ctx?)`; substituted captions into `memeLog` |
| `src/scenes/GameScene.ts` | `memeContext()` helper; pass ctx on all 6 existing emits; `lastIncidentAt` bookkeeping; 1s watcher accumulator with the two edge-triggered checks + pre-emit gap check |
| `src/scenes/UIScene.ts` | `showMemeReaction(label, ctx?)` — forward ctx to `pickMeme` (one-line signature change) |
| `src/config/memes.json` | settings block above; two new trigger pools; `when`/`weight`/tokens added to existing variants where they sharpen selection (e.g. squint variants inside "MARKET CALM-ISH" gain `"trend": "stable"`) |
| `src/scenes/ResultsScene.ts` | no change — memeLog already carries final caption strings |

Non-goals for this tier: no changes to popup presentation, cooldown UX,
trigger *removal*, or the mixed-case caption rewrite (separate pass).

## 7. Notes for the caption pass that follows

Selection context makes register-matching possible; the rewrite pass should
exploit it: lowercase deadpan for `stable`/quiet states, CAPS panic for
`dangerActive`, villain voices only on pools where the speaker profits from
the state (see the expression table in `assets/raw/Meme/MEME_CATALOG.md`).
