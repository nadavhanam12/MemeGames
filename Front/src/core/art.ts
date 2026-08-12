// Generated-art loader: maps canonical game texture keys to files produced by
// `npm run art` (public/assets/). Anything missing falls back to programmatic art.
import Phaser from 'phaser';
import MEMES_DATA from '../config/memes.json';

// Core game art. Keep in sync with the ART_MAP in scripts/art.mjs.
// Meme template keys are NOT listed here — they come from src/config/memes.json
// (each template's artKey/artFile pair), so adding a meme needs no code change.
const CORE_ART: Record<string, string> = {
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
  trump_left_fire_2: 'trump_left_fire_2.png'
};

const MEME_ART: Record<string, string> = Object.fromEntries(
  Object.values((MEMES_DATA as { templates: Record<string, { artKey: string; artFile: string }> }).templates).map(
    t => [t.artKey, t.artFile]
  )
);

export const ART_MAP: Record<string, string> = { ...CORE_ART, ...MEME_ART };

export const artStatus = {
  generated: new Set<string>(),
  fallback: new Set<string>()
};

/** True if the canonical key has generated art loaded into the texture manager. */
export function hasArt(scene: Phaser.Scene, key: string): boolean {
  return artStatus.generated.has(key) && scene.textures.exists(key);
}

/**
 * Fetches public/assets/index.json and queues every available generated image
 * on the scene's loader under its canonical key. Returns once textures are
 * loaded and artStatus is populated. Every fallback is reported to the console.
 */
export async function loadGeneratedArt(scene: Phaser.Scene): Promise<void> {
  let available: string[] = [];
  try {
    const res = await fetch('assets/index.json');
    if (res.ok) available = (await res.json()) as string[];
    else console.warn('[art] assets/index.json not found (HTTP', res.status, ') — run `npm run art`. Using fallback art for everything.');
  } catch (e) {
    console.warn('[art] could not fetch assets/index.json — using fallback art for everything.', e);
  }

  const toLoad: Array<[string, string]> = [];
  for (const [key, file] of Object.entries(ART_MAP)) {
    if (available.includes(file)) toLoad.push([key, file]);
    else artStatus.fallback.add(key);
  }

  if (toLoad.length) {
    await new Promise<void>(resolve => {
      for (const [key, file] of toLoad) scene.load.image(key, `assets/${file}`);
      scene.load.once(Phaser.Loader.Events.COMPLETE, () => resolve());
      scene.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (f: Phaser.Loader.File) => {
        console.error(`[art] failed to load assets/${f.url} — falling back for key "${f.key}"`);
        artStatus.fallback.add(f.key);
      });
      scene.load.start();
    });
    for (const [key] of toLoad) {
      if (scene.textures.exists(key)) artStatus.generated.add(key);
      else artStatus.fallback.add(key);
    }
  }

  const gen = [...artStatus.generated];
  const fb = [...artStatus.fallback];
  console.log(`[art] generated (${gen.length}/${Object.keys(ART_MAP).length}): ${gen.join(', ') || '(none)'}`);
  if (fb.length) console.warn(`[art] FALLBACK (${fb.length}): ${fb.join(', ')} — regenerate + \`npm run art\` (see assets/ART_RUN_SUMMARY.md)`);
  else console.log('[art] no fallbacks — every key uses generated art');
}
