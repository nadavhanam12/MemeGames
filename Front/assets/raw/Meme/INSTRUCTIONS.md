# Strait Shooter — Meme Art Pipeline Instructions

Use this workflow whenever creating additional meme assets for **Strait Shooter**.

## 1. Deliverable structure

- Every reference meme produces **one 2048×2048 opaque PNG atlas**.
- Every atlas contains **four equal 1024×1024 cells** arranged as a strict **2×2 grid**.
- Use thin black dividers and do not allow characters or props to cross cell boundaries.
- Generate four game-relevant variations from the same reference rather than four unrelated meme formats.
- Use descriptive filenames such as `meme_vehicle_sideeye_blank_atlas.png`.

## 2. The reference composition is locked

Treat the supplied meme as a structural template, not loose inspiration. Preserve as closely as possible:

- panel structure and aspect relationship;
- camera angle and crop;
- character count;
- left, center, and right placement;
- body pose, hand gesture, gaze direction, and facial expression;
- foreground/background depth;
- prop placement;
- negative space and caption zones.

Change only the character identities, clothing, game-specific background details, and runtime narrative. If the central joke depends on looking left, holding a phone, touching a temple, resting a cheek on a fist, or another precise action, that action is mandatory. Regenerate or correct the result when the pose, gaze, or composition reverses the joke.

## 3. Connect every variation to gameplay

Each of the four cells must represent a recognizable **Strait Shooter** situation, such as:

- a tanker being saved, lost, delayed, or used as bait;
- a missile, drone, naval mine, or patrol boat appearing or being destroyed;
- oil prices rising, falling, or producing confusing market signals;
- a VIP tanker distracting from ordinary ships;
- a peace deal, blockade, retreat, reload, escalation, or premature victory claim;
- media, diplomatic, military, civilian, shipping, or financial reactions.

The meme must be useful as responsive game feedback, not merely a generic reaction image.

## 4. Runtime text only

- Do **not** bake captions, labels, letters, numbers, logos, or watermarks into new atlases.
- Preserve clean caption areas based on the reference meme.
- Render captions dynamically in the game so one image can support multiple situations and localization.
- Large blank boards, placards, white panels, phone screens, and caption strips must remain completely empty.

## 5. Character selection

Do not repeat the same four characters automatically. Choose the cast that best communicates each joke. Available options include:

- Donald Trump;
- Mojtaba Khamenei whenever the meme specifically calls for Iran's leader;
- fictional Iranian, American, or European civilians;
- soldiers, commanders, sailors, tanker crews, emergency responders, and drone operators;
- anchors, analysts, traders, oil executives, diplomats, and government spokespeople.

Keep public-figure caricatures restrained and recognizable. Fictional characters must remain distinct and consistent within an atlas. Do not add real flags, insignia, channel logos, or organizational symbols unless explicitly requested.

## 6. Visual style

- Default to the approved **flat hand-drawn 2D adult-animation screenshot** style.
- Use simple cel shading, thick clean outlines, restrained colors, and readable silhouettes.
- Avoid photorealism, CGI, polished 3D rendering, excessive glow, and cinematic color grading unless a specific experiment explicitly requests documentary photography.
- Keep the style consistent across all four cells of an atlas.
- Composition fidelity is more important than decorative polish.

## 7. Safety and substitutions

- Replace copyrighted or trademarked characters with original or game-related characters while preserving the reference pose and composition.
- Do not recreate a private person's identity.
- If the reference centers on a child and generation is unsuitable or blocked, use a fictional adult while preserving the camera framing and reaction.
- Do not depict gore or injuries; background destruction should focus on vehicles, infrastructure, or distant non-graphic events.

## 8. Companion catalog

Maintain one cumulative file: `MEME_CATALOG.md`.

For every approved atlas, add:

- the atlas filename;
- its 2×2 layout and 1024×1024 cell size;
- one entry for each cell in top-left, top-right, bottom-left, bottom-right order;
- one sentence explaining what appears in the cell and when the game should use it.

Do not create a separate Markdown file for every atlas.

## 9. Required QA before delivery

Verify all of the following:

- atlas is exactly 2048×2048;
- four cells are equal and aligned;
- reference composition is recognizable immediately;
- pose, hand gesture, and gaze direction match the reference;
- every cell communicates a different game scenario;
- caption zones are unobstructed;
- no accidental text or watermarks appear;
- no extra characters, hands, fingers, props, or panels appear;
- `MEME_CATALOG.md` contains four matching descriptions.

Only package approved atlases; exclude rejected experiments, captioned tests, temporary files, and superseded versions.
