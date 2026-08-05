# Strait Shooter — Asset Guide

## Final assets

| File | Dimensions | Alpha | Purpose |
|---|---:|:---:|---|
| `map_bg.png` | 1920×1080 | No | Main gameplay map |
| `tankers_atlas.png` | 1024×1536 | Yes | Three tanker sprites |
| `threats_atlas.png` | 1024×1024 | Yes | Four threat sprites |
| `ui_chyron_frame.png` | 1920×240 | Yes | Reusable breaking-news lower-third |
| `meme_frame_broadcast.png` | 1920×1080 | Yes | Full-screen meme/broadcast overlay |
| `characters_atlas.png` | 2048×1024 | No | Eight 512×512 portraits |
| `meme_twobuttons_blank.png` | 1024×1536 | No | Blank two-button meme template |

## Atlas slicing

Coordinates use a top-left origin.

### `tankers_atlas.png`

One column × three rows. Each cell is **1024×512**.

| Sprite | X | Y | W | H |
|---|---:|---:|---:|---:|
| Standard red tanker | 0 | 0 | 1024 | 512 |
| Stocky blue tanker | 0 | 512 | 1024 | 512 |
| Gold VIP tanker | 0 | 1024 | 1024 | 512 |

### `threats_atlas.png`

Two columns × two rows. Each cell is **512×512**.

| Sprite | X | Y | W | H |
|---|---:|---:|---:|---:|
| Cruise missile, facing right | 0 | 0 | 512 | 512 |
| Quadcopter drone | 512 | 0 | 512 | 512 |
| Naval mine | 0 | 512 | 512 | 512 |
| Patrol boat, facing left | 512 | 512 | 512 | 512 |

### `characters_atlas.png`

Four columns × two rows. Each cell is **512×512**.

| Portrait | X | Y | W | H |
|---|---:|---:|---:|---:|
| Anchor — calm | 0 | 0 | 512 | 512 |
| Anchor — panic | 512 | 0 | 512 | 512 |
| Analyst — calm | 1024 | 0 | 512 | 512 |
| Analyst — panic | 1536 | 0 | 512 | 512 |
| Commander | 0 | 512 | 512 | 512 |
| Dealmaker | 512 | 512 | 512 | 512 |
| Spokesperson | 1024 | 512 | 512 | 512 |
| Captain | 1536 | 512 | 512 | 512 |

## Recommended import settings

- Use bilinear filtering for the map, portraits, overlays, and illustrated sprites.
- Keep atlas textures uncompressed during development; use high-quality RGBA compression for release builds.
- Preserve alpha on both atlases and broadcast overlays.
- Disable mipmaps for browser UI and fixed-camera 2D sprites unless the game visibly scales them down over a wide range.
- Use sprite pivots at center by default. For ships, a center pivot makes steering and rotation predictable.
- Add runtime headline and ticker copy as text components rather than baking text into the PNG files.

## Notes

- `map_labels_overlay.png` and the earlier standalone tanker are intentionally excluded because they were replaced or rejected.
- The broadcast frame center and picture-in-picture interior are transparent.
