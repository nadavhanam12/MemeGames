# Meme Art Pipeline Instructions (game-agnostic)

Use this workflow whenever creating meme atlases for a MemeGames title.

**Always read this file together with `GAME_BRIEF.md`** — the per-game context
file that sits next to it. This file defines the pipeline and never changes
between games; `GAME_BRIEF.md` defines the current game (what the player does,
which gameplay situations exist, the available cast, and the approved visual
style). When production moves to a new game, copy this file unchanged and
write a new `GAME_BRIEF.md`. If the two ever conflict, this file wins on
format/technical rules and `GAME_BRIEF.md` wins on content/creative choices.

## 1. Deliverable structure

- Every reference meme produces **one 2048×2048 opaque PNG atlas**.
- Every atlas contains **four equal 1024×1024 cells** arranged as a strict
  **2×2 grid**.
- Separate the four atlas cells cleanly with a thin neutral divider
  appropriate to the reference (black, white, or seamless — whatever the
  source composition supports). Do not add a heavy decorative frame unless
  the reference requires one. Characters and props must never cross cell
  boundaries.
- Generate four game-relevant variations from the same reference rather than
  four unrelated meme formats.
- Use descriptive filenames such as `meme_vehicle_sideeye_blank_atlas.png`.

### Nested meme layouts

Each atlas quadrant represents **one complete meme variation**. If the
reference meme contains two or more internal panels (Drake, Expanding Brain,
Boardroom Suggestion, and similar formats), reproduce that complete internal
structure inside every 1024×1024 quadrant — the 2×2 grid is four copies of
the whole format, never four panels of one meme. Examples: Expanding Brain =
four stacked stages inside every quadrant; Gru's Plan = a complete four-panel
sequence inside every quadrant; Panik/Kalm/Panik = all three reaction panels
inside every quadrant. Never use the atlas's four quadrants as the internal
panels of one meme.

### No duplicate quadrants

The four quadrants may share the same locked reference format, but they must
never look identical or nearly identical. Reject an atlas when two quadrants
appear interchangeable before captions are added. Differentiate every
quadrant through several of: gameplay scenario, character role, wardrobe and
color treatment, environment or venue, background palette and lighting,
supporting cast, relevant props, emotional context, and stage of
victory/failure/escalation/reaction. When the same character appears in more
than one quadrant, give each occurrence a clearly different role, costume,
environment, and scenario while preserving the locked pose and panel rhythm.

## 2. The reference composition is locked

Treat the supplied meme as a structural template, not loose inspiration.
Preserve as closely as possible:

- panel structure and aspect relationship;
- camera angle and crop;
- character count;
- left, center, and right placement;
- body pose, hand gesture, gaze direction, and facial expression;
- foreground/background depth;
- prop placement;
- negative space and caption zones.

Change only the character identities, clothing, game-specific background
details, and runtime narrative. If the central joke depends on looking left,
holding a phone, touching a temple, resting a cheek on a fist, or another
precise action, that action is mandatory. Regenerate or correct the result
when the pose, gaze, or composition reverses the joke.

Improvisation is permitted when necessary to distinguish the four quadrants,
satisfy the game brief's main-cast rule, or communicate gameplay clearly —
but it must never destroy the recognizable composition or the core joke.

## 2A. Inventing original meme formats (no reference supplied)

When no reference is supplied, first **invent and describe a reusable meme
format** before generating anything. Lock its camera, staging, character
count, emotional contrast and caption zones in writing, exactly as if it were
a supplied reference. Then produce four variations using that exact invented
composition, following every other rule in this file. Reject ideas that
merely reskin an existing famous meme.

## 3. Connect every variation to gameplay

Each of the four cells must represent a recognizable situation from the
current game. `GAME_BRIEF.md` contains the game summary and the palette of
gameplay situations to draw from — read it before planning cells. The meme
must be useful as responsive game feedback, not merely a generic reaction
image.

### Default four-scenario spread

Unless the meme structure supports a better combination, spread the four
cells across these categories (one each):

1. **Player victory or smart decision**
2. **Player failure or avoidable disaster**
3. **Antagonist action, failure or escalation**
4. **World reaction** (political, diplomatic, media or market)

Deviate when the reference format genuinely favors a different mix, but never
deliver four near-identical escalation scenes. Give all four cells distinct
gameplay states and casts.

## 3A. Apply the five meme-quality principles

Use these as selection and scenario-design tests without overriding the
locked reference composition:

- **Universal relatability:** anchor each cell in a basic emotion such as
  smugness, panic, denial, temptation, regret, or awkwardness.
- **High modularity:** keep characters, props, labels, and runtime captions
  swappable while preserving the underlying visual joke.
- **Binary visual contrast:** where the reference supports it, make the
  conflict immediately legible as success versus failure, action versus
  inaction, or confidence versus chaos.
- **Zero-friction processing:** expressions, gestures, and background events
  must communicate the emotional state before runtime text is read.
- **Ironic tension:** pair casual behavior with severe consequences,
  confident reactions with obvious failure, or excessive responses with
  minor triggers.

Keep any future runtime overlay under eight words per label whenever
practical.

## 4. Runtime text and symbols

- Do **not** bake captions, labels, letters, numbers, logos, or watermarks
  into new atlases.
- The prohibition extends beyond literal text. Also exclude: flags, military
  badges, rank markings, medals, currency symbols, channel branding, fake
  graph labels, and pseudo-writing (squiggles that imitate text). Any such
  element that appears accidentally is grounds for regeneration or cleanup.
- Preserve clean caption areas based on the reference meme.
- Render captions dynamically in the game so one image can support multiple
  situations and localization.
- Large blank boards, placards, white panels, phone screens, and caption
  strips must remain completely empty.

## 5. Character selection

Do not repeat the same four characters automatically. Choose the cast that
best communicates each joke, drawing from the roster in `GAME_BRIEF.md`
(which includes exact likeness descriptions for any required public figures
— follow them precisely).

If `GAME_BRIEF.md` defines a **main-cast rule** (characters that must appear
in every quadrant), it applies to each individual 1024×1024 quadrant, not
merely to the atlas as a whole, and it **overrides older cast assignments**
from spec packs or earlier concepts — adapt the cast while preserving the
spec's scenario category and joke tension. Never add a person if that would
break the reference's locked character count.

Keep public-figure caricatures restrained and recognizable. Fictional
characters must remain distinct and consistent within an atlas. Do not add
real flags, insignia, channel logos, or organizational symbols unless
explicitly requested.

## 6. Visual style

- Follow the approved style defined in `GAME_BRIEF.md`.
- Keep the style consistent across all four cells of an atlas.
- Avoid photorealism, CGI, polished 3D rendering, excessive glow, and
  cinematic color grading unless a specific experiment explicitly requests
  otherwise.
- Composition fidelity is more important than decorative polish.

## 7. Safety and substitutions

- Replace copyrighted or trademarked characters with original or
  game-related characters while preserving the reference pose and
  composition.
- Do not recreate a private person's identity.
- If the reference centers on a child and generation is unsuitable or
  blocked, use a fictional adult while preserving the camera framing and
  reaction.
- Do not depict gore or injuries; background destruction should focus on
  vehicles, infrastructure, or distant non-graphic events.

## 8. Technical normalization

Image generators frequently return a different square resolution than
requested (e.g. ~1254×1254 despite a 2048×2048 prompt). **Inspect the actual
exported dimensions of every delivery.** If the generator returned another
square resolution, resize the approved final image to exactly 2048×2048
using high-quality Lanczos resampling. Never assume the prompt-requested
dimensions were honored.

## 9. Versioning

- Never overwrite an approved atlas without explicit instruction.
- Name regenerated alternatives with `_v2`, `_v3`, etc.
- Only the currently approved version enters the final package.
- Keep experiments outside the approved package directory.

## 10. Companion catalog

Maintain one cumulative file: `MEME_CATALOG.md`.

For every approved atlas, add:

- the atlas filename;
- its 2×2 layout and 1024×1024 cell size;
- one entry for each cell in top-left, top-right, bottom-left, bottom-right
  order;
- one sentence explaining what appears in the cell and when the game should
  use it.

Do not create a separate Markdown file for every atlas.

## 11. Required QA before delivery

Verify all of the following:

- exported atlas dimensions were inspected and the file is exactly 2048×2048
  (resized per section 8 if the generator returned something else);
- four cells are equal and aligned;
- reference composition is recognizable immediately;
- pose, hand gesture, and gaze direction match the reference;
- every cell communicates a different game scenario (default spread from
  section 3, or a justified deviation);
- no two quadrants are identical or nearly identical, and no character
  treatment is reused without meaningful visual changes;
- nested formats are complete inside every quadrant;
- the game brief's main-cast rule (if any) is satisfied in every quadrant,
  and required likenesses match `GAME_BRIEF.md` exactly;
- caption zones are unobstructed;
- no accidental text, symbols, flags, badges, branding, or pseudo-writing
  appear;
- no extra characters, hands, fingers, props, or panels appear;
- `MEME_CATALOG.md` contains four matching descriptions.

Only package approved atlases; exclude rejected experiments, captioned
tests, temporary files, and superseded versions.
