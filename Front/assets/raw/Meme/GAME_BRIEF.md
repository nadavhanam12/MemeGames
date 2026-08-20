# Game Brief — Hormuz Hold'em

Per-game context for the meme art pipeline. Read together with
`INSTRUCTIONS.md` (the game-agnostic pipeline rules). **When production moves
to a new game, replace this file entirely and keep `INSTRUCTIONS.md`
unchanged.**

## The game

**Hormuz Hold'em** is a satirical 2D arcade game in which the player protects
oil tankers crossing the Strait of Hormuz from missiles, drones, naval mines
and patrol boats. Player decisions affect oil prices, political escalation
and shipping safety. Memes appear as contextual reactions to gameplay events
and are captioned dynamically at runtime — the art itself carries no text.

## Gameplay situation palette

Draw each atlas cell from recognizable situations such as:

- a tanker being saved, lost, delayed, or used as bait;
- a missile, drone, naval mine, or patrol boat appearing or being destroyed;
- oil prices rising, falling, or producing confusing market signals;
- a VIP tanker distracting from ordinary ships;
- a peace deal, blockade, retreat, reload, escalation, or premature victory
  claim;
- media, diplomatic, military, civilian, shipping, or financial reactions.

Mapping to the pipeline's default four-scenario spread:

1. **Player victory / smart decision** — tanker saved, threat destroyed,
   profitable price call.
2. **Player failure / avoidable disaster** — tanker lost, missed threat,
   price crash after a bad call.
3. **Antagonist action / failure / escalation** — Iranian launch, blockade,
   botched attack, escalation move.
4. **World reaction** — anchors, traders, diplomats, civilians, or oil
   executives reacting to the above.

## Main-cast rule (applies to every quadrant)

Every individual 1024×1024 meme quadrant must visibly include **Donald Trump
and/or Mojtaba Khamenei** — no quadrant may omit both. Prefer including both
when the reference composition naturally contains two or more characters, but
never add a person if that would break the locked character count. This rule
**overrides older cast assignments** in spec packs — adapt the cast while
preserving the scenario category and joke tension.

When the same main character appears in multiple quadrants, give each
occurrence a clearly different role, costume, environment, and scenario.
Example treatments for Trump: tanker captain on a blue ship bridge; oil
analyst in a gray trading office; diplomat in a teal press room; civilian in
a burgundy jacket at a fuel station. Apply equivalent differentiation to
Mojtaba.

## Cast

Choose the cast that best communicates each joke. Available options include:

- Donald Trump;
- Mojtaba Khamenei whenever the meme specifically calls for Iran's leader;
- fictional Iranian, American, or European civilians;
- soldiers, commanders, sailors, tanker crews, emergency responders, and
  drone operators;
- anchors, analysts, traders, oil executives, diplomats, and government
  spokespeople.

### Mojtaba Khamenei — required likeness

Mojtaba Khamenei must appear as a **younger middle-aged Iranian cleric with a
black turban, short neatly trimmed salt-and-pepper beard, dark eyebrows and
no glasses**. Do NOT depict Ali Khamenei's elderly face, long white beard or
eyeglasses — the generator frequently confuses the two; regenerate if it
does.

## Approved visual style

- Flat hand-drawn **2D adult-animation screenshot** style.
- Simple cel shading, thick clean outlines, restrained colors, and readable
  silhouettes.
- No photorealism, CGI, polished 3D rendering, excessive glow, or cinematic
  color grading unless a specific experiment explicitly requests documentary
  photography.
