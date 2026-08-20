# Integrate Art Pack

Runs the standard procedure for bringing a new art or meme drop (a zip/folder of raw images plus a catalog/guide) into the game, replacing or extending placeholder art.

## Usage

`/integrate-art-pack <path to zip or folder>` — or just describe where the new art pack is; use this skill whenever the request is "here's new art/memes, integrate it" in any phrasing.

## Steps

1. **Locate and open the pack.** If it's a zip, extract to a scratch location. Read any included catalog/guide doc (e.g. `ASSET_GUIDE.md`, `MEME_CATALOG.md`) before touching anything.
2. **Validate geometry and alpha before integrating.** Check each raw file against the manifest's expected dimensions/atlas grid and alpha-channel requirements. Files that don't match a required frame size (e.g. not a clean multiple of the atlas cell) need to be flagged back to the user, not silently resized/cropped.
3. **Check for duplicates against what's already integrated.** New drops sometimes re-deliver content that's already in `assets/raw/` — diff filenames/checksums before assuming everything is new (this has happened before: a "new" pack turned out to be identical to existing content).
4. **Update the manifest** (`manifest.json` or equivalent) with new atlas/template entries, in the same style/ordering as existing entries.
5. **Run the art pipeline** (`npm run art`) on just the new entries first if possible, to catch geometry/corruption issues early and cheaply, before writing the full template/caption content.
6. **Write template and trigger content** (e.g. `memes.json` templates + trigger wiring) for every new asset — confirm every new template is wired into at least one trigger, not just present in the templates list.
7. **Run the full pipeline and build** (`npm run art` full run + `npm run build`/typecheck) to confirm zero errors across everything, not just the new entries.
8. **Verify live in the browser**, per this project's browser-verification gotchas (see `PROMPTING.md`) — fire a few of the new templates/triggers via the dev bus and confirm they render with art and captions in the right place, including any letterboxed/multi-panel formats.
9. **Report exactly what's new** — counts, filenames, and anything the pack was missing or duplicated, so the user knows what to regenerate versus what's done.

## Don't

- Don't silently resize/crop a raw file that doesn't match the required geometry — flag it and ask for a re-export, or get explicit sign-off before touching it.
- Don't skip the "already integrated?" duplicate check — it has produced a wasted validation pass before.
- Don't declare the integration done without the live-browser check in step 8, even if the build/typecheck passes.
