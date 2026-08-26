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
const MEMES_OUT = path.join(OUT, 'Memes');

// Meme reaction images (anything the game loads via a memes.json artFile)
// live in public/assets/Memes/, separate from core game art in public/assets/.
// The naming convention is airtight — every meme output is prefixed `meme_`.
function isMemeFile(filename) {
  return filename.startsWith('meme_');
}
// Meme content images are re-encoded as lossy WebP (flat AI-generated art
// compresses far better there than as lossless PNG). The broadcast frame is
// a compositing overlay (has alpha, isn't meme "content"), kept as PNG.
const WEBP_QUALITY = 90;
function isWebpMeme(filename) {
  return isMemeFile(filename) && filename !== 'meme_frame_broadcast.png';
}
function outExt(filename) {
  return isWebpMeme(filename) ? filename.replace(/\.png$/, '.webp') : filename;
}
function outFileFor(filename) {
  return path.join(isMemeFile(filename) ? MEMES_OUT : OUT, outExt(filename));
}
function relOutFor(filename) {
  return isMemeFile(filename) ? `Memes/${outExt(filename)}` : filename;
}
function encode(img, filename) {
  return isWebpMeme(filename) ? img.webp({ quality: WEBP_QUALITY }) : img.png({ compressionLevel: 9 });
}

// Final on-screen sizes for standalone images (game world is 1280x720).
const IMAGE_TARGETS = {
  map_bg: { width: 1280, height: 720 },
  world_map: { width: 1280 },
  map_gulf: { width: 1400 },
  map_strait_close: { width: 1800 },
  ui_chyron_frame: { width: 1280 },
  meme_frame_broadcast: { width: 1280, height: 720 },
  meme_twobuttons_blank: { width: 720 },
  meme_thisisfine_blank: { width: 720 }
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
  const outFile = outFileFor(`${asset.name}.png`);
  let img = sharp(src);
  if (target.width || target.height) img = img.resize(target.width ?? null, target.height ?? null);
  await encode(img, `${asset.name}.png`).toFile(outFile);
  produced.push(relOutFor(`${asset.name}.png`));
}

/** Turn a green-screen delivery into a transparent PNG buffer (with despill). */
async function chromaKeyImage(src) {
  const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (g > 90 && g > r * 1.4 && g > b * 1.4) data[i + 3] = 0;
    else if (g > Math.max(r, b)) data[i + 1] = Math.max(r, b); // kill green fringe on edges
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
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
  if (asset.alpha && !meta.hasAlpha && !asset.chromaKey) {
    errors.push(`${asset.file}: expected an alpha channel but none found — regenerate with a true transparent background`);
    return;
  }
  // chromaKey: alpha is produced by keying out the backdrop, not delivered
  const source = asset.chromaKey ? await chromaKeyImage(src) : src;
  for (const [frameName, f] of Object.entries(asset.frames)) {
    const cell = await sharp(source)
      .extract({ left: f.x, top: f.y, width: f.w, height: f.h })
      .toBuffer();
    let img = sharp(cell);
    if (asset.trim) {
      // remove transparent padding so sprite bounds match visible pixels
      img = img.trim({ threshold: 10 });
    }
    const trimmed = await img.toBuffer();
    const targetW = asset.targetWidths?.[frameName] ?? asset.targetWidth;
    let out = sharp(trimmed);
    if (targetW) out = out.resize({ width: targetW });
    const outFile = outFileFor(`${frameName}.png`);
    const info = await encode(out, `${frameName}.png`).toFile(outFile);
    produced.push(`${relOutFor(`${frameName}.png`)} (${info.width}x${info.height})`);
  }
}

async function main() {
  // `npm run art -- --only <name>` re-processes a single manifest asset
  const onlyIdx = process.argv.indexOf('--only');
  const only = onlyIdx !== -1 ? process.argv[onlyIdx + 1] : null;
  const manifest = JSON.parse(await readFile(path.join(root, 'assets', 'manifest.json'), 'utf8'));
  if (only && !manifest.assets.some(a => a.name === only)) {
    console.error(`--only ${only}: no such asset in manifest.json`);
    process.exit(1);
  }
  await mkdir(OUT, { recursive: true });
  await mkdir(MEMES_OUT, { recursive: true });

  for (const asset of manifest.assets) {
    if (only && asset.name !== only) continue;
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

  // index of available generated assets, read by the game's loader.
  // Merge with the existing index so outputs whose raw source is gone
  // (skipped above) stay loadable — keep an old entry only if its processed
  // file still exists in public/assets/.
  let index = produced.map(p => p.split(' ')[0]);
  try {
    const prev = JSON.parse(await readFile(path.join(OUT, 'index.json'), 'utf8'));
    const kept = [];
    for (const f of prev) {
      if (!index.includes(f) && (await exists(path.join(OUT, f)))) kept.push(f);
    }
    index = [...kept, ...index];
  } catch { /* no existing index — fresh write */ }

  await writeFile(path.join(OUT, 'index.json'), JSON.stringify(index, null, 2));

  // canonical game texture keys -> generated file (keep in sync with src/core/art.ts).
  // Meme template keys are appended from src/config/memes.json below.
  const ART_MAP = {
    map_bg: 'map_bg.png',
    world_map: 'world_map.png',
    map_gulf: 'map_gulf.png',
    map_strait_close: 'map_strait_close.png',
    tanker0: 'tanker_red.png',
    tanker1: 'tanker_blue.png',
    tankerVip: 'tanker_vip.png',
    missile: 'threat_missile.png',
    drone: 'threat_drone.png',
    mine: 'threat_mine.png',
    patrol: 'threat_patrol.png',
    chyron: 'ui_chyron_frame.png',
    memeFrame: 'Memes/meme_frame_broadcast.png',
    charCommander: 'char_commander.png',
    charDealmaker: 'char_dealmaker.png',
    trump_right_idle_1: 'trump_right_idle_1.png',
    trump_right_idle_2: 'trump_right_idle_2.png',
    trump_right_fire_1: 'trump_right_fire_1.png',
    trump_right_fire_2: 'trump_right_fire_2.png',
    trump_mid_idle_1: 'trump_mid_idle_1.png',
    trump_mid_idle_2: 'trump_mid_idle_2.png',
    trump_mid_fire_1: 'trump_mid_fire_1.png',
    trump_mid_fire_2: 'trump_mid_fire_2.png',
    trump_left_idle_1: 'trump_left_idle_1.png',
    trump_left_idle_2: 'trump_left_idle_2.png',
    trump_left_fire_1: 'trump_left_fire_1.png',
    trump_left_fire_2: 'trump_left_fire_2.png',
    tower_idle_1: 'tower_idle_1.png',
    tower_idle_2: 'tower_idle_2.png',
    tower_idle_3: 'tower_idle_3.png',
    tower_idle_4: 'tower_idle_4.png',
    tower_fire_1: 'tower_fire_1.png',
    tower_fire_2: 'tower_fire_2.png',
    tower_fire_3: 'tower_fire_3.png',
    tower_fire_4: 'tower_fire_4.png',
    tower_s_idle_1: 'tower_s_idle_1.png',
    tower_s_idle_2: 'tower_s_idle_2.png',
    tower_s_idle_3: 'tower_s_idle_3.png',
    tower_s_idle_4: 'tower_s_idle_4.png',
    tower_s_fire_1: 'tower_s_fire_1.png',
    tower_s_fire_2: 'tower_s_fire_2.png',
    tower_s_fire_3: 'tower_s_fire_3.png',
    tower_s_fire_4: 'tower_s_fire_4.png'
  };
  const memesCfg = JSON.parse(await readFile(path.join(root, 'src', 'config', 'memes.json'), 'utf8'));
  for (const t of Object.values(memesCfg.templates)) ART_MAP[t.artKey] = t.artFile;
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
