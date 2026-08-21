// Dev panel (top-left key ` / § to toggle, dev builds only): live tuning
// sliders with hover explanations, HUD layout edit mode, route waypoint
// editor, pause, save-to-disk. Folder open/closed state persists per browser.
import Phaser from 'phaser';
import { TUNING, persistTuningLocal, resetTuningLocal, saveToDisk } from '../config/tuning';
import { layoutData, setLayoutEdit } from './layout';
import { devState } from './state';
import { bus, EV } from '../core/state';
import { settings, saveSettings } from '../core/settings';

let gui: any = null;
let visible = false;

const FOLDER_STATE_KEY = 'dev-panel-folders';

// Hover explanation for every control, keyed by "<folder>.<property>".
const TIPS: Record<string, string> = {
  'Session.startPrice': 'Oil price at session start. The emotional baseline the player fights to lower.',
  'Session.startCredits': 'Defense Credits the player begins with — sets how fast the first upgrade arrives.',
  'Session.failPrice': 'Meltdown threshold: when oil is at/above this, the meltdown clock runs.',
  'Session.failSeconds': 'Seconds oil may stay at/above failPrice before the run ends.',
  'Spawning.tankerInterval': 'Seconds between tanker departures.',
  'Spawning.maxTankers': 'Maximum tankers sailing simultaneously.',
  'Speeds.missile': 'Missile travel speed, pixels/second (before the late-game ramp).',
  'Speeds.drone': 'Drone travel speed, pixels/second.',
  'Speeds.mine': 'Unused — mines are stationary (they pop into place and wait).',
  'Speeds.patrol': 'Patrol boat speed, pixels/second.',
  'Speeds.tankerMin': 'Slowest random tanker speed along the route.',
  'Speeds.tankerMax': 'Fastest random tanker speed along the route.',
  'Speeds.vipTanker': 'Unused — the VIP tanker sails at normal tanker speed (tankerMin–tankerMax).',
  'Economy.interceptDrop': 'Oil price drop ($) per normal interception.',
  'Economy.patrolDrop': 'Oil price drop ($) for turning a patrol boat around.',
  'Economy.nearMissDrop': 'EXTRA price drop ($) for a last-second save, on top of the normal drop.',
  'Economy.tankerDropMin': 'Minimum price drop ($) when a tanker exits safely.',
  'Economy.tankerDropMax': 'Maximum price drop ($) when a tanker exits safely.',
  'Economy.vipDrop': 'Price drop ($) when the VIP tanker exits safely.',
  'Economy.hitSpike': 'Price SPIKE ($) when a tanker is hit — the punishment.',
  'Economy.vipHitSpike': 'Price spike ($) when the VIP tanker is lost.',
  'Economy.interceptCredits': 'Defense Credits per interception (before the OIL MONEY multiplier).',
  'Economy.tankerCredits': 'Credits for each safe tanker.',
  'Economy.vipCredits': 'Credits for a safe VIP tanker.',
  'Economy.eventWinCredits': 'Credit bonus for winning a special event.',
  'Upgrades.airCooldownBase': 'Seconds between jet intercepts before level scaling.',
  'Upgrades.airCooldownStep': 'Jet intercept cooldown reduction per air level.',
  'Upgrades.airSpeedBase': 'Jet flight speed at level 0, pixels/second.',
  'Upgrades.airSpeedPerLevel': 'Extra jet speed per air level.',
  'Upgrades.airFireDist': 'How close the jet must get to intercept, pixels.',
  'Upgrades.hullHpPerLevel': 'Extra hits a tanker survives per hull level.',
  'Upgrades.hullDamagedSpikeFactor': 'Price-spike fraction when armor absorbs a hit (1 = full spike).',
  'Upgrades.goldBonusPerLevel': 'Credit income bonus per gold level (0.25 = +25%/level).',
  'Juice / FX.tapRadius': 'Tap hit radius in px — how close a tap must be to a threat to count.',
  'Juice / FX.nearMissDist': 'Interceptions closer than this (px) to a tanker count as last-second saves.',
  'Juice / FX.hitDist': 'Distance (px) at which a threat detonates on a tanker.',
  'Juice / FX.mineActivateDist': 'Mines arm only when a ship gets this close (px); dormant mines are harmless.',
  'Juice / FX.shakeSmall': 'Camera shake intensity for normal interceptions.',
  'Juice / FX.shakeBig': 'Camera shake intensity for tanker hits / major moments.',
  'Juice / FX.slowmoScale': 'World speed during near-miss slow motion (0.25 = quarter speed).',
  'Juice / FX.slowmoMs': 'Slow-motion duration in milliseconds.',
  'Juice / FX.particleScale': 'Multiplier on all particle burst counts (0 = off, 2 = double).',
  'Gameplay Events.endDay': 'Ends the current day immediately, skipping the rest of the timer and any pressing threats.',
  'Gameplay Events.nextMeme': 'Shows a randomly-picked meme reaction right now, ignoring the normal cooldown.',
  'Editors.pauseGame': 'Freeze the gameplay scene (timer, threats, tankers). HUD stays live. Toggle off to resume.',
  'Editors.layoutEdit': 'Drag HUD groups to move them; mouse-wheel over one to scale. Gameplay taps are disabled while on.',
  'Editors.routeEdit': 'Drag the purple waypoints to reshape the tanker shipping route live.',
  'Editors.speedX2': 'Doubles the gameplay simulation speed (spawns, movement, day timer). Visual FX stay normal speed.',
  'Editors.sound': 'Mutes/unmutes game SFX. Persisted to this browser only (localStorage) — does not affect other players or machines.',
  'Editors.autoPlay':
    'off = manual play. gameplay = bot auto-fires at threats but leaves each day-summary screen (shop, next day) to you. full = bot also buys upgrades and clicks through days on its own.',
  '_.saveToDisk': 'Write current tuning + layout into src/config/*.json — makes tweaks permanent project defaults.',
  '_.restartGame': 'Restart the current run to feel tuning changes from t=0.',
  '_.forceLoss': 'Instantly end the run (market meltdown) to test the Results screen and leaderboard submit flow.',
  '_.resetOverrides': 'Discard unsaved local tweaks and reload with the values from tuning.json/layout.json.'
};

export function initDevtools(game: Phaser.Game): void {
  if (!import.meta.env.DEV) return;
  window.addEventListener('keydown', e => {
    // physical top-left key on any layout (`, §, etc. — IntlBackslash is the
    // § key's code on ISO Mac keyboards)
    if (e.code === 'Backquote' || e.code === 'IntlBackslash' || e.key === '`' || e.key === '§') {
      console.log('[dev] toggle key pressed');
      void toggle(game);
    }
  });
  console.log('[dev] press ` / § (top-left key) to open the dev panel, or reload with ?dev=1');
  // fallback: ?dev=1 in the URL opens the panel without any keyboard
  if (new URLSearchParams(location.search).has('dev')) void toggle(game);
}

async function toggle(game: Phaser.Game): Promise<void> {
  try {
    if (!gui) {
      const { default: GUI } = await import('lil-gui');
      buildPanel(GUI, game);
    }
    visible = !visible;
    gui.domElement.style.display = visible ? '' : 'none';
    console.log(`[dev] panel ${visible ? 'shown' : 'hidden'}`);
  } catch (err) {
    console.error('[dev] failed to open dev panel:', err);
    gui = null; // allow a clean retry on the next press
  }
}

function loadFolderState(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(FOLDER_STATE_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function buildPanel(GUI: any, game: Phaser.Game): void {
  gui = new GUI({ title: "HORMUZ HOLD'EM DEV" });
  gui.domElement.style.zIndex = '10000';

  const folderState = loadFolderState();
  const folders: any[] = [];
  const onChange = () => persistTuningLocal();

  // helper: create a folder, restore its remembered open/closed state
  const folder = (title: string, defaultClosed = false) => {
    const f = gui.addFolder(title);
    folders.push(f);
    const remembered = folderState[title];
    const closed = remembered === undefined ? defaultClosed : remembered;
    if (closed) f.close();
    return f;
  };

  // helper: add a controller with a hover tip (title attribute on its row)
  const tipped = (ctrl: any, folderTitle: string, prop: string) => {
    const tip = TIPS[`${folderTitle}.${prop}`];
    if (tip) ctrl.domElement.setAttribute('title', tip);
    return ctrl;
  };

  const session = folder('Session');
  tipped(session.add(TUNING.session, 'startPrice', 60, 180, 1).onChange(onChange), 'Session', 'startPrice');
  tipped(session.add(TUNING.session, 'startCredits', 0, 100, 5).onChange(onChange), 'Session', 'startCredits');
  tipped(session.add(TUNING.session, 'failPrice', 140, 220, 5).onChange(onChange), 'Session', 'failPrice');
  tipped(session.add(TUNING.session, 'failSeconds', 2, 30, 1).onChange(onChange), 'Session', 'failSeconds');

  const spawn = folder('Spawning');
  // Per-day spawn pressure (interval / threat cap / speed) is authored in
  // tuning.json -> days.difficulty arrays, not slider-tunable here.
  tipped(spawn.add(TUNING.spawn, 'tankerInterval', 2, 20, 0.5).onChange(onChange), 'Spawning', 'tankerInterval');
  tipped(spawn.add(TUNING.spawn, 'maxTankers', 1, 5, 1).onChange(onChange), 'Spawning', 'maxTankers');

  const speeds = folder('Speeds');
  (Object.keys(TUNING.speeds) as Array<keyof typeof TUNING.speeds>).forEach(k =>
    tipped(speeds.add(TUNING.speeds, k, 10, 200, 1).onChange(onChange), 'Speeds', k)
  );

  const eco = folder('Economy', true);
  (Object.keys(TUNING.economy) as Array<keyof typeof TUNING.economy>).forEach(k =>
    tipped(eco.add(TUNING.economy, k, 0, 50, 0.5).onChange(onChange), 'Economy', k)
  );

  const costFolders: any[] = [];
  const up = folder('Upgrades', true);
  tipped(up.add(TUNING.upgrades, 'airCooldownBase', 1, 15, 0.5).onChange(onChange), 'Upgrades', 'airCooldownBase');
  tipped(up.add(TUNING.upgrades, 'airCooldownStep', 0, 4, 0.25).onChange(onChange), 'Upgrades', 'airCooldownStep');
  tipped(up.add(TUNING.upgrades, 'airSpeedBase', 40, 300, 5).onChange(onChange), 'Upgrades', 'airSpeedBase');
  tipped(up.add(TUNING.upgrades, 'airSpeedPerLevel', 0, 100, 5).onChange(onChange), 'Upgrades', 'airSpeedPerLevel');
  tipped(up.add(TUNING.upgrades, 'airFireDist', 20, 150, 5).onChange(onChange), 'Upgrades', 'airFireDist');
  tipped(up.add(TUNING.upgrades, 'hullHpPerLevel', 0, 3, 1).onChange(onChange), 'Upgrades', 'hullHpPerLevel');
  tipped(up.add(TUNING.upgrades, 'hullDamagedSpikeFactor', 0, 1, 0.05).onChange(onChange), 'Upgrades', 'hullDamagedSpikeFactor');
  tipped(up.add(TUNING.upgrades, 'goldBonusPerLevel', 0, 1, 0.05).onChange(onChange), 'Upgrades', 'goldBonusPerLevel');
  (['airCosts', 'hullCosts', 'goldCosts'] as const).forEach(name => {
    const arr = TUNING.upgrades[name];
    const f = folder(name, true);
    costFolders.push(f);
    arr.forEach((_, i) => {
      const ctrl = f.add(arr, String(i), 5, 200, 5).name(`level ${i + 1}`).onChange(onChange);
      ctrl.domElement.setAttribute('title', `Defense Credit cost of ${name.replace('Costs', '')} level ${i + 1}.`);
    });
  });

  const juice = folder('Juice / FX', true);
  tipped(juice.add(TUNING.juice, 'tapRadius', 30, 160, 5).onChange(onChange), 'Juice / FX', 'tapRadius');
  tipped(juice.add(TUNING.juice, 'nearMissDist', 50, 300, 10).onChange(onChange), 'Juice / FX', 'nearMissDist');
  tipped(juice.add(TUNING.juice, 'hitDist', 20, 120, 5).onChange(onChange), 'Juice / FX', 'hitDist');
  tipped(juice.add(TUNING.juice, 'mineActivateDist', 60, 400, 10).onChange(onChange), 'Juice / FX', 'mineActivateDist');
  tipped(juice.add(TUNING.juice, 'shakeSmall', 0, 0.02, 0.001).onChange(onChange), 'Juice / FX', 'shakeSmall');
  tipped(juice.add(TUNING.juice, 'shakeBig', 0, 0.04, 0.001).onChange(onChange), 'Juice / FX', 'shakeBig');
  tipped(juice.add(TUNING.juice, 'slowmoScale', 0.05, 1, 0.05).onChange(onChange), 'Juice / FX', 'slowmoScale');
  tipped(juice.add(TUNING.juice, 'slowmoMs', 100, 2000, 50).onChange(onChange), 'Juice / FX', 'slowmoMs');
  tipped(juice.add(TUNING.juice, 'particleScale', 0, 3, 0.1).onChange(onChange), 'Juice / FX', 'particleScale');

  // Temporary: focus the panel on Gameplay Events + Editors only.
  [session, spawn, speeds, eco, up, juice, ...costFolders].forEach(f => f.hide());

  const gameplayEvents = {
    endDay: () => {
      const gs = game.scene.getScene('Game') as any;
      gs?.devEndDay?.();
    },
    nextMeme: () => bus.emit(EV.DEV_FORCE_MEME)
  };
  const events = folder('Gameplay Events');
  tipped(
    events.add(gameplayEvents, 'endDay').name('⏭ End current day'),
    'Gameplay Events',
    'endDay'
  );
  tipped(
    events.add(gameplayEvents, 'nextMeme').name('🎭 Show next meme'),
    'Gameplay Events',
    'nextMeme'
  );

  const editors = folder('Editors');
  const editorState = {
    pauseGame: false,
    layoutEdit: devState.layoutEdit,
    routeEdit: devState.routeEdit,
    speedX2: devState.speedMultiplier === 2,
    autoPlay: devState.autoPlay,
    sound: settings.sound
  };
  tipped(
    editors
      .add(editorState, 'pauseGame')
      .name('⏸ Pause game')
      .onChange((v: boolean) => {
        const gs = game.scene.getScene('Game');
        if (!gs) return;
        if (v && gs.scene.isActive()) gs.scene.pause();
        else if (!v && gs.scene.isPaused()) gs.scene.resume();
      }),
    'Editors',
    'pauseGame'
  );
  tipped(
    editors.add(editorState, 'layoutEdit').name('Edit HUD layout (drag/wheel)').onChange((v: boolean) => setLayoutEdit(v)),
    'Editors',
    'layoutEdit'
  );
  tipped(
    editors.add(editorState, 'routeEdit').name('Edit route waypoints').onChange((v: boolean) => {
      devState.routeEdit = v;
      const gs = game.scene.getScene('Game') as any;
      gs?.enableRouteEdit?.(v);
    }),
    'Editors',
    'routeEdit'
  );
  tipped(
    editors
      .add(editorState, 'speedX2')
      .name('⏩ 2x speed')
      .onChange((v: boolean) => {
        devState.speedMultiplier = v ? 2 : 1;
      }),
    'Editors',
    'speedX2'
  );
  tipped(
    editors
      .add(editorState, 'autoPlay', ['off', 'gameplay', 'full'])
      .name('🤖 Autoplay')
      .onChange((v: 'off' | 'gameplay' | 'full') => {
        devState.autoPlay = v;
      }),
    'Editors',
    'autoPlay'
  );
  tipped(
    editors
      .add(editorState, 'sound')
      .name('🔊 Sound')
      .onChange((v: boolean) => {
        settings.sound = v;
        saveSettings();
      }),
    'Editors',
    'sound'
  );

  const actions = {
    saveToDisk: async () => {
      const result = await saveToDisk(layoutData);
      console.log('[dev] save:', result);
    },
    restartGame: () => {
      editorState.pauseGame = false;
      const gs = game.scene.getScene('Game');
      if (gs?.scene.isPaused()) gs.scene.resume();
      if (gs?.scene.isActive()) gs.scene.restart();
    },
    forceLoss: () => {
      const gs = game.scene.getScene('Game') as any;
      if (gs?.scene.isPaused()) gs.scene.resume();
      gs?.devForceLoss?.();
    },
    resetOverrides: () => {
      resetTuningLocal();
      location.reload();
    }
  };
  tipped(gui.add(actions, 'saveToDisk').name('💾 Save to disk (src/config)'), '_', 'saveToDisk');
  tipped(gui.add(actions, 'restartGame').name('↻ Restart run'), '_', 'restartGame');
  tipped(gui.add(actions, 'forceLoss').name('💀 Force loss (test results/leaderboard)'), '_', 'forceLoss');
  tipped(gui.add(actions, 'resetOverrides').name('⚠ Reset local overrides'), '_', 'resetOverrides');

  // remember which folders are open/closed for next session
  gui.onOpenClose(() => {
    const state: Record<string, boolean> = {};
    for (const f of folders) state[f._title] = f._closed;
    try {
      localStorage.setItem(FOLDER_STATE_KEY, JSON.stringify(state));
    } catch {
      /* ignore */
    }
  });
}
