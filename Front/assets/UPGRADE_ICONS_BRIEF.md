# UPGRADE ICONS BRIEF — one deliverable, 2-cell atlas

One deliverable: `upgrade_icons_atlas.png`, **1024×512**, PNG with a **true
transparent background**. Drop it into `assets/raw/` and run `npm run art` —
slicing is already wired in `assets/manifest.json`.

## What it is

Two broadcast-graphics icons representing 2 of the game's 3 shop upgrades,
shown on small cards in the upgrades panel. The third upgrade, Hull Armor,
reuses the existing tanker sprite art (`tanker_red.png`, canonical key
`tanker0`) directly — no new icon needed there.

Style must match the existing package: same palette, lighting and line
weight as `threats_atlas.png` / `tankers_atlas.png` — semi-realistic TV-news
icon look, NOT cartoon, NOT photoreal. Bold, simple, readable at small size
(cards render these at roughly 40×28px).

No text or lettering baked into any cell.

## Grid — 2 columns × 1 row, every cell exactly 512×512

| Col 1 (x 0) | Col 2 (x 512) |
|---|---|
| `upgrade_icon_air` | `upgrade_icon_gold` |

- **Col 1 — Air Assistance**: a friendly jet fighter silhouette banking
  in from above, three-quarter angle, clean gray-blue livery, small
  contrail. Reads as "air support," not combat threat.
- **Col 2 — Oil Money**: a stack of gold coins with a subtle oil-droplet
  glint, warm gold/amber tones matching `PAL.gold`. Reads as "profit."

Center each icon in its cell with even padding; subjects must not cross
cell boundaries.

## Delivery checklist

1. 1024×512 exactly — the pipeline rejects any other size.
2. Genuinely transparent background across the whole sheet.
3. Both cells consistent in style, lighting and line weight.
4. Save as `upgrade_icons_atlas.png`.

Until this art exists, the game draws simple vector placeholder icons at
runtime (see `BootScene.makeUpgradeIcons()`) — no blocker to shipping the
layout change first.
