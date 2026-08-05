// Art pipeline (Phase A): slice/trim/resize raw AI-generated art into game-ready
// assets, driven entirely by assets/manifest.json.
//
//   input:  assets/raw/<file>        (ChatGPT downloads, per assets/CHATGPT_BRIEF.md)
//   spec:   assets/manifest.json
//   output: public/assets/<name>.png
//
// Usage: npm run art

import { readFile, mkdir, access, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const RAW = path.join(root, 'assets', 'raw');
const OUT = path.join(root, 'public', 'assets');

// Final on-screen sizes for standalone images (game world is 1280x720).
const IMAGE_TARGETS = {
  map_bg: { width: 1280, height: 720 },
  ui_chyron_frame: { width: 1280 },
  meme_frame_broadcast: { width: 1280, height: 720 },
  meme_twobuttons_blank: { width: 720 }
};

const errors = [];
const warnings = [];
const produced = [];

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function processImage(asset) {
  const src = path.join(RAW, asset.file);
  const meta = await sharp(src).metadata();
  if (meta.width !== asset.size[0] || meta.height !== asset.size[1]) {
    errors.push(
      `${asset.file}: expected ${asset.size[0]}x${asset.size[1]}, got ${meta.width}x${meta.height} — regenerate it (see assets/CHATGPT_BRIEF.md)`
    );
    return;
  }
  if (asset.alpha && !meta.hasAlpha) {
    errors.push(`${asset.file}: expected an alpha channel but none found — regenerate with a true transparent background`);
    return;
  }
  const target = IMAGE_TARGETS[asset.name] ?? {};
  const outFile = path.join(OUT, `${asset.name}.png`);
  let img = sharp(src);
  if (target.width || target.height) img = img.resize(target.width ?? null, target.height ?? null);
  await img.png({ compressionLevel: 9 }).toFile(outFile);
  produced.push(`${asset.name}.png`);
}

async function processAtlas(asset) {
  const src = path.join(RAW, asset.file);
  const meta = await sharp(src).metadata();
  if (meta.width !== asset.size[0] || meta.height !== asset.size[1]) {
    errors.push(
      `${asset.file}: expected ${asset.size[0]}x${asset.size[1]}, got ${meta.width}x${meta.height} — regenerate the whole sheet`
    );
    return;
  }
  if (asset.alpha && !meta.hasAlpha) {
    errors.push(`${asset.file}: expected an alpha channel but none found — regenerate with a true transparent background`);
    return;
  }
  for (const [frameName, f] of Object.entries(asset.frames)) {
    const cell = await sharp(src)
      .extract({ left: f.x, top: f.y, width: f.w, height: f.h })
      .toBuffer();
    let img = sharp(cell);
    if (asset.trim) {
      // remove transparent padding so sprite bounds match visible pixels
      img = img.trim({ threshold: 10 });
    }
    const trimmed = await img.toBuffer();
    const targetW = asset.targetWidths?.[frameName];
    let out = sharp(trimmed);
    if (targetW) out = out.resize({ width: targetW });
    const outFile = path.join(OUT, `${frameName}.png`);
    const info = await out.png({ compressionLevel: 9 }).toFile(outFile);
    produced.push(`${frameName}.png (${info.width}x${info.height})`);
  }
}

async function main() {
  const manifest = JSON.parse(await readFile(path.join(root, 'assets', 'manifest.json'), 'utf8'));
  await mkdir(OUT, { recursive: true });

  for (const asset of manifest.assets) {
    const src = path.join(RAW, asset.file);
    if (!(await exists(src))) {
      warnings.push(`${asset.file}: not found in assets/raw/ — skipped (game falls back to programmatic art)`);
      continue;
    }
    try {
      if (asset.kind === 'atlas') await processAtlas(asset);
      else await processImage(asset);
    } catch (e) {
      errors.push(`${asset.file}: processing failed — ${e.message}`);
    }
  }

  // index of available generated assets, read by the game's loader
  const index = produced.map(p => p.split(' ')[0]);
  await writeFile(path.join(OUT, 'index.json'), JSON.stringify(index, null, 2));

  // canonical game texture keys -> generated file (keep in sync with src/core/art.ts)
  const ART_MAP = {
    map_bg: 'map_bg.png',
    tanker0: 'tanker_red.png',
    tanker1: 'tanker_blue.png',
    tankerVip: 'tanker_vip.png',
    missile: 'threat_missile.png',
    drone: 'threat_drone.png',
    mine: 'threat_mine.png',
    patrol: 'threat_patrol.png',
    chyron: 'ui_chyron_frame.png',
    memeFrame: 'meme_frame_broadcast.png',
    memeTwoButtons: 'meme_twobuttons_blank.png',
    charAnchorCalm: 'char_anchor_calm.png',
    charAnchorPanic: 'char_anchor_panic.png',
    charAnalystCalm: 'char_analyst_calm.png',
    charAnalystPanic: 'char_analyst_panic.png',
    charCommander: 'char_commander.png',
    charDealmaker: 'char_dealmaker.png',
    charSpokesperson: 'char_spokesperson.png',
    charCaptain: 'char_captain.png'
  };
  const fallbackKeys = Object.entries(ART_MAP)
    .filter(([, file]) => !index.includes(file))
    .map(([key, file]) => `${key} (missing ${file})`);

  console.log('\n=== art pipeline ===');
  for (const p of produced) console.log('  ✓', p);
  for (const w of warnings) console.log('  ⚠', w);
  for (const e of errors) console.log('  ✗', e);
  if (fallbackKeys.length) {
    console.log('\n  game will use programmatic FALLBACK art for:');
    for (const k of fallbackKeys) console.log('    →', k);
  }
  console.log(`\n${produced.length} assets written to public/assets/, ${warnings.length} skipped, ${errors.length} errors`);

  // persistent run summary next to the manifest
  const summary = [
    '# Art run summary',
    '',
    `- Date: ${new Date().toISOString()}`,
    `- Written: ${produced.length} • Skipped: ${warnings.length} • Errors: ${errors.length}`,
    '',
    '## Produced (public/assets/)',
    ...(produced.length ? produced.map(p => `- ${p}`) : ['- (none)']),
    '',
    '## Skipped (missing raw files → game uses programmatic fallback)',
    ...(warnings.length ? warnings.map(w => `- ${w}`) : ['- (none)']),
    '',
    '## Errors (must be fixed/regenerated)',
    ...(errors.length ? errors.map(e => `- ${e}`) : ['- (none)']),
    '',
    '## Game texture keys using fallback art',
    ...(fallbackKeys.length ? fallbackKeys.map(k => `- ${k}`) : ['- (none — every key has generated art)']),
    ''
  ].join('\n');
  await writeFile(path.join(root, 'assets', 'ART_RUN_SUMMARY.md'), summary);
  console.log('summary written to assets/ART_RUN_SUMMARY.md');
  if (errors.length) process.exit(1);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
