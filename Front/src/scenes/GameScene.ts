import Phaser from 'phaser';
import { DPR, FONT_DISPLAY, GAME_H, GAME_W, HEX, PAL, VIEW } from '../core/palette';
import { settings, vibrate } from '../core/settings';
import { sfx } from '../core/sfx';
import { hasArt } from '../core/art';
import { MemeContext, MEMES, resetMemeLog } from '../core/memes';
import { getDayFired, getDayUnlocks, recordDayReached, resetDayUnlocks, resetRunUnlocks } from '../core/memeUnlocks';
import { TUNING, persistTuningLocal } from '../config/tuning';
import { devState } from '../dev/state';
import { leaderboard } from '../backend/leaderboard';
import { analytics } from '../backend/analytics';
import {
  camImpulse,
  confetti,
  floatText,
  impactFlash,
  shockwave
} from '../core/juice';
import {
  COMBO_MILESTONES,
  DayMission,
  EV,
  MissionType,
  SessionStats,
  bus,
  computeScore,
  freshStats
} from '../core/state';

type ThreatType = 'missile' | 'drone' | 'mine' | 'patrol';

interface Threat {
  sprite: Phaser.GameObjects.Image;
  type: ThreatType;
  speed: number;
  hp: number; // late-run missiles/drones spawn with 2 — first hit slows, second kills
  target: Tanker | null;
  dead: boolean;
  swarmId?: number;
  warnRing?: Phaser.GameObjects.Graphics;
  blinkTimer: number;
  // missiles lock onto a point once their target is gone — no retargeting
  aimX?: number;
  aimY?: number;
  armed?: boolean; // mines: only live once a ship has come close
  // patrols are lane-bound: they sail a shipping-lane spline, never open water
  routeIdx?: number;
  dist?: number; // distance along the route spline
  spawnGrace?: number; // patrols can't hit while this counts down
}

// gunner tracer: homes on its designated threat; kills only when it arrives
interface Bullet {
  sprite: Phaser.GameObjects.Image;
  target: Threat | null; // null = fired at empty water, fizzles at aim point
  aimX: number;
  aimY: number;
  done?: boolean;
  fromAir?: boolean; // air-support rounds don't count as player intercepts
}

interface Tanker {
  sprite: Phaser.GameObjects.Image;
  wake: Phaser.GameObjects.Particles.ParticleEmitter;
  speed: number;
  dist: number; // distance travelled along its route spline
  routeIdx: number; // which shipping lane it sails
  vip: boolean;
  hp: number; // hits it can still take (HULL ARMOR adds +1 per level)
  maxHp: number;
  list: number; // damaged ships heel over a little — added to route heading
  smoke?: Phaser.GameObjects.Particles.ParticleEmitter; // distress smoke once hit
  dead: boolean;
}

// Fallback (code-drawn map) geometry: straight horizontal lane. Y values are
// scaled from the original 1280×720 landscape frame to the current
// 720×1280 portrait frame (×1280/720) so the lane still reads as a
// proportionate band down the middle of the taller world.
const OLD_GAME_H = 720;
const FRAME_SCALE_Y = GAME_H / OLD_GAME_H;
const LANE_TOP = Math.round(220 * FRAME_SCALE_Y);
const LANE_BOT = Math.round(500 * FRAME_SCALE_Y);
const TANKER_Y = Math.round(360 * FRAME_SCALE_Y);

export class GameScene extends Phaser.Scene {
  private stats!: SessionStats;
  private tankers: Tanker[] = [];
  private threats: Threat[] = [];
  private routes: Phaser.Curves.Spline[] = [];
  private routeLengths: number[] = [];
  private targetWindows: Array<{ min: number; max: number }> = [];
  private elapsed = 0;
  private worldScale = 1;
  private spawnTimer = 0;
  private tankerTimer = 5;
  private historyTimer = 0;
  private jitterTimer = 0;
  private noiseOffset = 0;
  private over = false;
  private lastPriceSide: Record<string, boolean> = {};
  private mapArt = false;

  private upgrades = { air: 0, hull: 0, gold: 0 };
  private revealed = { air: false, hull: false, gold: false };
  private jet?: Phaser.GameObjects.Image;
  private airTimer = 0;

  // day / mission system: each day is a mini-level with one mission; between
  // days the world freezes for the recap card and waits for the player to
  // click NEXT DAY (see onNextDayRequest)
  private day = 0;
  private awaitingNextDay = false;
  // mid-run freeze for a full-screen interstitial (e.g. a new-meme reveal) —
  // separate from awaitingNextDay so it doesn't touch day-boundary logic
  private frozen = false;
  private mission: DayMission | null = null;
  private lastMissionType: MissionType | '' = '';
  private dayCounters = { priceAtStart: 0, safe: 0, lost: 0, intercepts: 0, bestCombo: 0 };

  // GUNNER TURRET: taps designate targets, the machine gun at bottom-center
  // does the killing — tracers take real travel time to arrive
  private turret?: Phaser.GameObjects.Container;
  private turretBody!: Phaser.GameObjects.Image;
  private turretBarrel?: Phaser.GameObjects.Image; // placeholder art only — atlas frames bake the gun in
  private turretArt = false;
  private turretAnimT = 0;
  private turretAimX = 640;
  private turretAimY = 300;
  private bullets: Bullet[] = [];
  private heat = 0; // 0..1; at 1 the gun locks until it cools down
  private overheated = false;
  private heatBar!: Phaser.GameObjects.Graphics;
  private firingHeld = false;
  private fireTimer = 0;
  private lastShotAt = -10; // elapsed time of last shot, drives the firing pose

  private nightOverlay!: Phaser.GameObjects.Rectangle;
  private eventProb = 0;
  private eventLabel = 'DRONE SWARM SURGE';
  private eventActive = false;
  private eventCooldown = 14;
  private swarmRemaining = 0;
  private swarmCounter = 0;

  private waveGfx!: Phaser.GameObjects.Graphics;
  private trailGfx!: Phaser.GameObjects.Graphics; // tracer streaks, redrawn per frame
  private lastHitstopAt = -10;
  private tensionTimer = 0;
  private waveT = 0;
  private lastTickSecond = -1;
  private baseZoom = 1;
  private dangerT = 0;
  private dangerActive = false;
  private routeGfx?: Phaser.GameObjects.Graphics;
  private routeLabel?: Phaser.GameObjects.Text;
  private routeHandles: Phaser.GameObjects.Arc[] = [];

  // meme context/watchers: GameScene's own copy of the last emit time (so a
  // watcher edge is never blindly fired into UIScene's cooldown with nothing
  // shown), the last "something happened" timestamp (quiet-watcher input),
  // and edge-trigger/rearm state for the two state watchers.
  private lastMemeEmitAt = -Infinity;
  private lastIncidentAt = 0;
  private watcherAccum = 0;
  private watcherState: Record<'dissonance' | 'quiet', { was: boolean; armed: boolean; falseFor: number; lastFiredAt: number }> = {
    dissonance: { was: false, armed: true, falseFor: 0, lastFiredAt: -Infinity },
    quiet: { was: false, armed: true, falseFor: 0, lastFiredAt: -Infinity }
  };

  constructor() {
    super('Game');
  }

  create(): void {
    // Prefetch a score token now so it satisfies the server's 60s minimum age
    // by the time the run ends and the player submits from the results screen.
    leaderboard.beginRun();
    analytics.startRun();
    resetMemeLog();
    resetRunUnlocks();
    this.stats = freshStats();
    this.tankers = [];
    this.threats = [];
    this.elapsed = 0;
    this.day = 0;
    this.awaitingNextDay = false;
    this.frozen = false;
    this.mission = null;
    this.lastMissionType = '';
    this.worldScale = 1;
    this.over = false;
    this.spawnTimer = 1.2;
    this.tankerTimer = 1.0;
    this.eventProb = 0;
    this.eventActive = false;
    this.eventCooldown = 14;
    this.upgrades = { air: 0, hull: 0, gold: 0 };
    this.revealed = { air: false, hull: false, gold: false };
    this.jet = undefined;
    this.airTimer = 0;
    this.lastPriceSide = {};
    this.dangerT = 0;
    this.dangerActive = false;
    this.lastMemeEmitAt = -Infinity;
    this.lastIncidentAt = 0;
    this.watcherAccum = 0;
    this.watcherState = {
      dissonance: { was: false, armed: true, falseFor: 0, lastFiredAt: -Infinity },
      quiet: { was: false, armed: true, falseFor: 0, lastFiredAt: -Infinity }
    };
    this.mapArt = hasArt(this, 'map_bg');
    this.bullets = [];
    this.heat = 0;
    this.overheated = false;
    this.firingHeld = false;
    this.fireTimer = 0;
    this.lastShotAt = -10;
    this.buildRoute();
    this.drawWorld();
    this.spawnTurret();
    if (import.meta.env.DEV && devState.routeEdit) this.enableRouteEdit(true);
    this.waveGfx = this.add.graphics().setDepth(6);
    this.trailGfx = this.add.graphics().setDepth(54);
    this.lastHitstopAt = -10;
    this.tensionTimer = 0;
    // day/night light: navy wash over the world, alpha driven in update()
    this.nightOverlay = this.add
      .rectangle(GAME_W / 2, GAME_H / 2, GAME_W * 1.25, GAME_H * 1.25, 0x0a1a3c)
      .setAlpha(0)
      .setDepth(900);

    // render the world inside the broadcast window; HUD frames it.
    // VIEW is in 1280×720 logical coords; the canvas backing store is DPR×
    // larger, so both the viewport rect and the zoom carry the DPR factor.
    this.baseZoom = Math.min(VIEW.w / GAME_W, VIEW.h / GAME_H) * DPR;
    this.cameras.main.setViewport(VIEW.x * DPR, VIEW.y * DPR, VIEW.w * DPR, VIEW.h * DPR);
    this.cameras.main.setBackgroundColor(0x000000);
    this.cameras.main.setZoom(this.baseZoom);
    this.cameras.main.centerOn(GAME_W / 2, GAME_H / 2);
    this.cameras.main.fadeIn(250, 7, 59, 92);
    this.scene.launch('UI');
    // day 1 kicks off once the UI scene is up and listening
    this.time.delayedCall(400, () => this.startDay(1));

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      // ignore taps while a UI modal (upgrades panel) is open
      if (this.registry.get('ui-modal')) return;
      // ignore taps on the HUD frame outside the broadcast window
      // (pointer coords are in DPR-scaled canvas pixels; VIEW is logical)
      const px = p.x / DPR;
      const py = p.y / DPR;
      if (px < VIEW.x || px > VIEW.x + VIEW.w || py < VIEW.y || py > VIEW.y + VIEW.h) return;
      const wp = this.cameras.main.getWorldPoint(p.x, p.y);
      // tap = one shot; holding keeps the burst going (see update())
      this.firingHeld = true;
      this.fireTimer = TUNING.turret.fireInterval;
      sfx.unlock();
      sfx.startAmbient(); // ocean bed can only start once audio is unlocked
      shockwave(this, wp.x, wp.y, 0xffffff, 36); // designation marker
      this.fireShot(wp.x, wp.y);
    });
    this.input.on('pointerup', () => (this.firingHeld = false));
    this.input.on('pointerupoutside', () => (this.firingHeld = false));

    bus.removeAllListeners('buy-upgrade');
    bus.on('buy-upgrade', (key: 'air' | 'hull' | 'gold', cost: number) => this.buyUpgrade(key, cost));
    bus.removeAllListeners(EV.NEXT_DAY_REQUEST);
    bus.on(EV.NEXT_DAY_REQUEST, this.onNextDayRequest, this);
    bus.removeAllListeners(EV.WORLD_FREEZE);
    bus.on(EV.WORLD_FREEZE, (frozen: boolean) => (this.frozen = frozen));

    this.events.on('shutdown', () => {
      bus.removeAllListeners('buy-upgrade');
      bus.removeAllListeners(EV.NEXT_DAY_REQUEST);
      sfx.stopAmbient();
    });
  }

  // ------------------------------------------------------------- route
  private routeSets(): Array<Array<[number, number]>> {
    const r = TUNING.route as unknown as Record<string, Array<[number, number]>>;
    return this.mapArt ? [r.map, r.map2] : [r.flat, r.flat2];
  }

  private buildRoute(): void {
    // waypoint arrays are stored in SAIL ORDER: the first point is where ships
    // spawn. Route 2's data runs right -> left (opposing traffic).
    const sets = this.routeSets();
    this.routes = sets.map(set => new Phaser.Curves.Spline(set.map(([x, y]) => new Phaser.Math.Vector2(x, y))));
    this.routeLengths = this.routes.map(r => r.getLength());
    // targetable window per route: routes extend past the visible world on
    // both ends (ships enter/exit off-screen), and a tanker is fair game only
    // while the player can see it and react — inside the on-screen stretch of
    // its route, minus targetableEdgeFrac at each visible end
    this.targetWindows = this.routes.map((r, i) => {
      const len = this.routeLengths[i];
      const n = 200;
      let first = -1;
      let last = -1;
      for (let s = 0; s <= n; s++) {
        const p = r.getPoint(s / n);
        if (p.x >= 0 && p.x <= GAME_W && p.y >= 0 && p.y <= GAME_H) {
          if (first < 0) first = (s / n) * len;
          last = (s / n) * len;
        }
      }
      if (first < 0) return { min: 0, max: len };
      const margin = (last - first) * TUNING.spawn.targetableEdgeFrac;
      return { min: first + margin, max: last - margin };
    });
  }

  /** True while a tanker is inside its route's targetable window. */
  private targetable(tk: Tanker): boolean {
    const w = this.targetWindows[tk.routeIdx];
    return tk.dist >= w.min && tk.dist <= w.max;
  }

  /** Rebuild the spline and redraw its overlay (used live by the route editor). */
  rebuildRoute(): void {
    this.buildRoute();
    this.drawRouteOverlay();
  }

  /** Dev-only: draggable waypoint handles on the map. */
  enableRouteEdit(on: boolean): void {
    if (!import.meta.env.DEV) return;
    this.routeHandles.forEach(h => h.destroy());
    this.routeHandles = [];
    if (!on) {
      // restore normal gameplay framing
      this.cameras.main.setZoom(this.baseZoom);
      this.cameras.main.centerOn(GAME_W / 2, GAME_H / 2);
      return;
    }
    // zoom out so off-screen spawn/exit waypoints (which sit outside the
    // normal gameplay viewport on purpose) are visible and draggable too
    const allPts = this.routeSets().flat();
    const xs = allPts.map(p => p[0]);
    const ys = allPts.map(p => p[1]);
    const minX = Math.min(...xs, 0);
    const maxX = Math.max(...xs, GAME_W);
    const minY = Math.min(...ys, 0);
    const maxY = Math.max(...ys, GAME_H);
    const pad = 60;
    const boundsW = maxX - minX + pad * 2;
    const boundsH = maxY - minY + pad * 2;
    const fitZoom = Math.min(VIEW.w / boundsW, VIEW.h / boundsH, this.baseZoom);
    this.cameras.main.setZoom(fitZoom);
    this.cameras.main.centerOn((minX + maxX) / 2, (minY + maxY) / 2);
    // one-time densify: insert a midpoint between every pair of waypoints so
    // the editor offers twice the control nodes
    if (!devState.routeDensified) {
      devState.routeDensified = true;
      for (const pts of this.routeSets()) {
        for (let i = pts.length - 1; i > 0; i--) {
          pts.splice(i, 0, [
            Math.round((pts[i][0] + pts[i - 1][0]) / 2),
            Math.round((pts[i][1] + pts[i - 1][1]) / 2)
          ]);
        }
      }
      persistTuningLocal();
      this.rebuildRoute();
    }
    const colors = [0x9b5de5, 0xff8a3d]; // route 1 purple, route 2 orange
    this.routeSets().forEach((pts, ri) => {
      pts.forEach((p, i) => {
        const h = this.add
          .circle(p[0], p[1], 14, colors[ri % colors.length], 0.85)
          .setStrokeStyle(3, 0xffffff)
          .setDepth(2500)
          .setInteractive({ useHandCursor: true, draggable: true });
        h.on('drag', (_ptr: Phaser.Input.Pointer, dragX: number, dragY: number) => {
          h.setPosition(dragX, dragY);
          pts[i] = [Math.round(dragX), Math.round(dragY)];
          this.rebuildRoute();
          persistTuningLocal();
        });
        this.routeHandles.push(h as Phaser.GameObjects.Arc);
      });
    });
  }

  // ------------------------------------------------------------- world art
  private drawWorld(): void {
    // the broadcast window is wider than the 1280x720 world at the fit zoom,
    // so scale the backdrop uniformly to cover the camera's visible area
    const zoom = Math.min(VIEW.w / GAME_W, VIEW.h / GAME_H);
    const camW = VIEW.w / zoom;
    const camH = VIEW.h / zoom;
    if (this.mapArt) {
      // map_bg is authored landscape (1280x720) for the old TV layout; only the
      // middle half of its width reads well in the portrait world, so crop to
      // that before stretching to cover the camera's visible area. setCrop()
      // cuts the source in raw texture pixels, so the cover scale has to be
      // computed against the CROPPED dimensions, not the full 1280x720 frame —
      // sizing against the full frame (as before) left the crop's drawn region
      // narrower than the camera's visible width, showing bare background on
      // both sides of the art.
      const src = this.textures.get('map_bg').getSourceImage() as HTMLImageElement;
      const cropW = src.width / 2;
      const cropX = (src.width - cropW) / 2;
      const scale = Math.max(camW / cropW, camH / src.height);
      this.add
        .image(GAME_W / 2, GAME_H / 2, 'map_bg')
        .setCrop(cropX, 0, cropW, src.height)
        .setDisplaySize(src.width * scale, src.height * scale)
        .setDepth(0);
    } else {
      this.drawFallbackWorld();
    }
    this.drawRouteOverlay();
  }

  /** Runtime route overlay (labels/routes are never baked into art). */
  private drawRouteOverlay(): void {
    this.routeGfx?.destroy();
    this.routeLabel?.destroy();
    const g = this.add.graphics().setDepth(2);
    this.routeGfx = g;
    for (const route of this.routes) {
      const pts = route.getPoints(64);
      g.lineStyle(4, PAL.cream, 0.45);
      for (let i = 0; i < pts.length - 1; i += 2) {
        g.lineBetween(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y);
      }
      // painted direction arrows along each route
      g.fillStyle(PAL.cream, 0.35);
      for (const t of [0.25, 0.5, 0.75]) {
        const p = route.getPoint(t);
        const tan = route.getTangent(t).normalize();
        const n = new Phaser.Math.Vector2(-tan.y, tan.x).scale(16);
        const tip = new Phaser.Math.Vector2(p.x + tan.x * 30, p.y + tan.y * 30);
        g.fillTriangle(p.x + n.x, p.y + n.y, p.x - n.x, p.y - n.y, tip.x, tip.y);
      }
    }
    const mid = this.routes[0].getPoint(0.45);
    this.routeLabel = this.add
      .text(mid.x, mid.y - 40, 'STRAIT OF HORMUZ', {
        fontFamily: FONT_DISPLAY,
        fontSize: '20px',
        color: '#FFFFFF',
        stroke: HEX.ink,
        strokeThickness: 5
      })
      .setOrigin(0.5)
      .setAlpha(0.8)
      .setDepth(2);
  }

  private drawFallbackWorld(): void {
    this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W * 1.25, GAME_H * 1.25, PAL.navy).setDepth(0);
    const g = this.add.graphics().setDepth(1);
    g.fillStyle(PAL.sand, 1);
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(GAME_W, 0);
    g.lineTo(GAME_W, LANE_TOP - 30);
    for (let x = GAME_W; x >= 0; x -= 40) g.lineTo(x, LANE_TOP - 30 + Math.sin(x / 70) * 18);
    g.closePath();
    g.fillPath();
    g.beginPath();
    g.moveTo(0, GAME_H);
    g.lineTo(GAME_W, GAME_H);
    g.lineTo(GAME_W, LANE_BOT + 30);
    for (let x = GAME_W; x >= 0; x -= 40) g.lineTo(x, LANE_BOT + 30 + Math.sin(x / 60 + 2) * 16);
    g.closePath();
    g.fillPath();
    g.lineStyle(6, PAL.ink, 1);
    g.beginPath();
    for (let x = 0; x <= GAME_W; x += 20) {
      const y = LANE_TOP - 30 + Math.sin(x / 70) * 18;
      if (x === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.strokePath();
    g.beginPath();
    for (let x = 0; x <= GAME_W; x += 20) {
      const y = LANE_BOT + 30 + Math.sin(x / 60 + 2) * 16;
      if (x === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.strokePath();
    g.fillStyle(PAL.ocean, 0.45);
    g.fillRect(0, LANE_TOP, GAME_W, LANE_BOT - LANE_TOP);
  }

  private drawWaves(): void {
    if (this.mapArt) return; // the generated map has its own water texture
    this.waveT += 0.02;
    const g = this.waveGfx;
    g.clear();
    g.lineStyle(3, 0xffffff, 0.18);
    for (let row = 0; row < 3; row++) {
      const y = LANE_TOP + 40 + row * 90;
      g.beginPath();
      for (let x = -30; x <= GAME_W + 30; x += 14) {
        const yy = y + Math.sin(x / 46 + this.waveT * (1 + row * 0.3)) * 6;
        if (x === -30) g.moveTo(x, yy);
        else g.lineTo(x, yy);
      }
      g.strokePath();
    }
  }

  private routePoint(dist: number, ri = 0): Phaser.Math.Vector2 {
    return this.routes[ri].getPoint(Phaser.Math.Clamp(dist / this.routeLengths[ri], 0, 1));
  }

  // ------------------------------------------------------------- spawning
  private spawnTanker(vip = false): void {
    const artVariants = hasArt(this, 'tanker0') ? 2 : 3;
    const key = vip ? 'tankerVip' : `tanker${Phaser.Math.Between(0, artVariants - 1)}`;
    const routeIdx = Phaser.Math.Between(0, this.routes.length - 1);
    const start = this.routePoint(0, routeIdx);
    const sprite = this.add.image(start.x, start.y, key).setDepth(20);
    // slow omnidirectional foam emitted at the stern — the ship's own motion
    // draws the trail; followOffset is re-aimed astern every frame in the
    // tanker update loop (a fixed offset drifts to the ship's side once the
    // route curves)
    const tan0 = this.routes[routeIdx].getTangent(0).normalize();
    const wake = this.add.particles(0, 0, 'dot', {
      speed: { min: 4, max: 14 },
      angle: { min: 0, max: 360 },
      scale: { start: 0.7, end: 0 },
      alpha: { start: 0.5, end: 0 },
      lifespan: 700,
      frequency: 70,
      tint: 0xffffff,
      follow: sprite,
      followOffset: { x: -tan0.x * sprite.width * 0.5, y: -tan0.y * sprite.width * 0.5 }
    }).setDepth(15);
    const sp = TUNING.speeds;
    // VIP sails at normal tanker speed — same random range as everyone else
    const base = Phaser.Math.Between(sp.tankerMin, sp.tankerMax);
    const hp = 1 + this.upgrades.hull * TUNING.upgrades.hullHpPerLevel;
    const t: Tanker = {
      sprite,
      wake,
      speed: base,
      dist: 0,
      routeIdx,
      vip,
      hp,
      maxHp: hp,
      list: 0,
      dead: false
    };
    if (vip) {
      (sprite as any).sparkle = this.add.particles(0, 0, 'spark', {
        speed: { min: 20, max: 60 },
        scale: { start: 0.5, end: 0 },
        lifespan: 500,
        frequency: 90,
        tint: 0xffe08a,
        follow: sprite
      }).setDepth(21);
    }
    this.tankers.push(t);
  }

  private spawnThreat(type?: ThreatType, swarmId?: number): void {
    if (this.over) return;
    // enemy weapons unlock day by day (announced in the news the day before)
    const unlock = TUNING.days.threatUnlockDays;
    const pool: ThreatType[] = ['missile', 'drone'];
    if (this.day >= unlock.mine) pool.push('mine');
    if (this.day >= unlock.patrol) pool.push('patrol');
    const t = type ?? Phaser.Math.RND.pick(pool);
    // only tankers inside the targetable window are fair game — off-screen
    // ships (entering or leaving) and the 5% edges of the visible stretch
    // can't be locked, so every attack is one the player can see and answer
    const viable = this.aliveTankers().filter(tk => this.targetable(tk));
    const target = viable[0] ?? null;

    let sprite: Phaser.GameObjects.Image;
    let speed = 60;
    let x = 0;
    let y = 0;
    let patrolRoute = 0;

    switch (t) {
      case 'missile':
        // launched from the top coast
        speed = TUNING.speeds.missile;
        x = Phaser.Math.Between(120, GAME_W - 120);
        y = -50;
        sprite = this.add.image(x, y, 'missile');
        break;
      case 'drone':
        speed = TUNING.speeds.drone;
        x = Phaser.Math.Between(120, GAME_W - 120);
        y = -50;
        sprite = this.add.image(x, y, 'drone');
        break;
      case 'mine': {
        // stationary: pops into the water near one of the shipping lanes,
        // but never close enough to a sailing tanker to arm on arrival
        speed = 0;
        let placed = false;
        for (let attempt = 0; attempt < 8 && !placed; attempt++) {
          const ri = Phaser.Math.Between(0, this.routes.length - 1);
          const tt = 0.15 + Math.random() * 0.7;
          const p = this.routes[ri].getPoint(tt);
          const tan = this.routes[ri].getTangent(tt).normalize();
          const off = Phaser.Math.Between(-75, 75);
          x = Phaser.Math.Clamp(p.x - tan.y * off, 60, GAME_W - 60);
          y = Phaser.Math.Clamp(p.y + tan.x * off, 60, GAME_H - 60);
          const mineDist = tt * this.routeLengths[ri];
          placed = !this.aliveTankers().some(tk => {
            // radius check: never surface within arming range of anyone
            if (Phaser.Math.Distance.Between(x, y, tk.sprite.x, tk.sprite.y) < TUNING.juice.mineActivateDist) {
              return true;
            }
            // path check: a same-lane tanker sailing toward the mine must have
            // at least mineMinReactSec of sailing time before it arms
            if (tk.routeIdx !== ri) return false;
            const ahead = mineDist - tk.dist;
            return ahead > 0 && ahead < tk.speed * TUNING.spawn.mineMinReactSec + TUNING.juice.mineActivateDist;
          });
        }
        if (!placed) return; // no safe water this tick — skip the spawn
        sprite = this.add.image(x, y, 'mine');
        break;
      }
      case 'patrol': {
        // lane-bound: enters at the downstream end of a shipping lane and
        // sails the spline upstream toward oncoming tankers. Never enters a
        // lane whose exit has a tanker about to sail out of it.
        speed = TUNING.speeds.patrol;
        const preferred = target ? target.routeIdx : Phaser.Math.Between(0, this.routes.length - 1);
        const order = [preferred, ...this.routes.map((_, i) => i).filter(i => i !== preferred)];
        const clear = order.find(ri => {
          const entry = this.routePoint(this.routeLengths[ri] - 1, ri);
          return !this.aliveTankers().some(
            tk =>
              Phaser.Math.Distance.Between(entry.x, entry.y, tk.sprite.x, tk.sprite.y) <
              TUNING.spawn.patrolEntryClearance
          );
        });
        if (clear === undefined) return; // both exits busy — skip the spawn
        patrolRoute = clear;
        const p = this.routePoint(this.routeLengths[clear] - 1, clear);
        x = p.x;
        y = p.y;
        sprite = this.add.image(x, y, 'patrol');
        break;
      }
    }
    sprite.setDepth(30);
    const late = this.dayCurve(TUNING.days.difficulty.speedMult);
    // difficulty step: from the armored day on, flying weapons take two hits
    const armored = (t === 'missile' || t === 'drone') && this.day >= TUNING.days.threatUnlockDays.armored;
    const threat: Threat = {
      sprite,
      type: t,
      speed: speed * late,
      hp: armored ? 2 : 1,
      target: t === 'missile' ? null : target,
      dead: false,
      swarmId,
      blinkTimer: 0
    };
    if (t === 'patrol') {
      threat.routeIdx = patrolRoute;
      threat.dist = this.routeLengths[patrolRoute] - 1;
      threat.spawnGrace = TUNING.spawn.patrolGraceSec;
      // only tankers on its own lane are reachable
      threat.target = this.aliveTankers().find(tk => tk.routeIdx === patrolRoute && this.targetable(tk)) ?? null;
    }
    if (t === 'missile') {
      // ballistic launch: lock an impact point NOW — the predicted tanker
      // position, or a random spot along the route if nothing is sailing
      if (target && !target.dead) {
        const d = Phaser.Math.Distance.Between(x, y, target.sprite.x, target.sprite.y);
        const travelTime = d / threat.speed;
        const len = this.routeLengths[target.routeIdx];
        const futureDist = Math.min(target.dist + target.speed * travelTime, len - 1);
        const p = this.routePoint(futureDist, target.routeIdx);
        threat.aimX = p.x;
        threat.aimY = p.y;
      } else {
        const ri = Phaser.Math.Between(0, this.routes.length - 1);
        const p = this.routePoint(this.routeLengths[ri] * (0.2 + Math.random() * 0.6), ri);
        threat.aimX = p.x + Phaser.Math.Between(-30, 30);
        threat.aimY = p.y + Phaser.Math.Between(-30, 30);
      }
    }
    sprite.setScale(0.2);
    this.tweens.add({ targets: sprite, scale: 1, duration: 200, ease: 'Back.easeOut' });
    if (t === 'mine') {
      // surfacing splash so the pop-in reads clearly
      sfx.splash();
      shockwave(this, x, y, 0x8fd6ef, 46);
    }
    // flying weapons launch from off-screen — blink an edge chevron so the
    // player knows where to look before the threat is even visible
    if (t === 'missile' || t === 'drone') {
      this.spawnTelegraph(x, t === 'missile' ? PAL.red : PAL.orange);
    }
    if (t === 'missile' && !settings.reducedMotion) {
      (sprite as any).trail = this.add.particles(0, 0, 'puff', {
        speed: 10,
        scale: { start: 0.5, end: 0 },
        alpha: { start: 0.6, end: 0 },
        lifespan: 500,
        frequency: 60,
        tint: 0xffb199,
        follow: sprite
      }).setDepth(25);
    }
    this.threats.push(threat);
  }

  private aliveTankers(): Tanker[] {
    return this.tankers.filter(t => !t.dead);
  }

  // ------------------------------------------------------------- gunner turret
  /** Bottom-center machine-gun nest. Placeholder art until the atlas lands
   *  (12 frames: left/mid/right x idle/fire x 2 — see assets/TRUMP_GUNNER_BRIEF.md). */
  private spawnTurret(): void {
    const tu = TUNING.turret;
    this.turretArt = hasArt(this, 'trump_mid_idle_1');
    this.turret?.destroy();
    this.turretBarrel = undefined;
    if (this.turretArt) {
      this.turretBody = this.add.image(0, 0, 'trump_mid_idle_1');
      this.turret = this.add.container(tu.x, tu.y, [this.turretBody]);
    } else {
      // placeholder gunner seen from behind: suit shoulders, blond hair, gun
      if (!this.textures.exists('turretBodyGen')) {
        const g = this.make.graphics({ x: 0, y: 0 }, false);
        g.fillStyle(0x2b3a52, 1); // suit shoulders
        g.fillRoundedRect(6, 30, 60, 26, 10);
        g.fillStyle(0xf0c49b, 1); // head
        g.fillCircle(36, 22, 13);
        g.fillStyle(0xf7d154, 1); // the hair
        g.fillEllipse(36, 13, 26, 12);
        g.generateTexture('turretBodyGen', 72, 58);
        g.destroy();
      }
      if (!this.textures.exists('turretBarrelGen')) {
        const g = this.make.graphics({ x: 0, y: 0 }, false);
        g.fillStyle(0x3a4048, 1);
        g.fillRect(0, 3, 46, 6); // barrel
        g.fillStyle(0x14181d, 1);
        g.fillRect(40, 1, 10, 10); // muzzle brake
        g.generateTexture('turretBarrelGen', 50, 12);
        g.destroy();
      }
      this.turretBody = this.add.image(0, 6, 'turretBodyGen');
      this.turretBarrel = this.add.image(0, -8, 'turretBarrelGen').setOrigin(0.1, 0.5);
      this.turretBarrel.setRotation(-Math.PI / 2);
      this.turret = this.add.container(tu.x, tu.y, [this.turretBody, this.turretBarrel]);
    }
    this.turret.setDepth(60);
    if (!this.textures.exists('tracerGen')) {
      const g = this.make.graphics({ x: 0, y: 0 }, false);
      g.fillStyle(0xffe08a, 1);
      g.fillRoundedRect(0, 0, 16, 4, 2);
      g.generateTexture('tracerGen', 16, 4);
      g.destroy();
    }
    this.heatBar = this.add.graphics().setDepth(61);
    this.drawHeatBar();
  }

  /** World-space point tracer rounds leave from. */
  private muzzlePoint(): { x: number; y: number } {
    const tu = TUNING.turret;
    if (this.turretBarrel) {
      const a = this.turretBarrel.rotation;
      return { x: tu.x + Math.cos(a) * 42, y: tu.y - 8 + Math.sin(a) * 42 };
    }
    // atlas art: the gun end shifts with the left/mid/right pose frames
    const dx = this.turretAimX - tu.x;
    const side = dx < -tu.poseSwitchDx ? -1 : dx > tu.poseSwitchDx ? 1 : 0;
    return { x: tu.x + side * tu.muzzleOffsetX, y: tu.y - 34 + (side === -1 ? tu.muzzleLeftDy : 0) };
  }

  // ------------------------------------------------------------- input
  /** One tracer at the nearest threat to (x,y) — or at the water if nothing's there. */
  private fireShot(x: number, y: number): void {
    if (this.over || this.awaitingNextDay) return;
    if (import.meta.env.DEV && (devState.layoutEdit || devState.routeEdit)) return;
    const tu = TUNING.turret;
    if (this.overheated) return; // heat bar flashes red — the gun is the message

    let best: Threat | null = null;
    let bestD = tu.lockRadius;
    for (const th of this.threats) {
      if (th.dead) continue;
      const d = Phaser.Math.Distance.Between(x, y, th.sprite.x, th.sprite.y);
      if (d < bestD) {
        bestD = d;
        best = th;
      }
    }

    this.turretAimX = best ? best.sprite.x : x;
    this.turretAimY = best ? best.sprite.y : y;
    this.lastShotAt = this.elapsed;

    const m = this.muzzlePoint();
    const spr = this.add.image(m.x, m.y, 'tracerGen').setDepth(55);
    spr.setRotation(Math.atan2(this.turretAimY - m.y, this.turretAimX - m.x));
    this.bullets.push({ sprite: spr, target: best, aimX: this.turretAimX, aimY: this.turretAimY });

    sfx.tap();
    vibrate(5);
    // muzzle flash: additive hot disc at the barrel (kills get the big ring)
    if (!settings.reducedMotion) {
      const flash = this.add
        .circle(m.x, m.y, 13, 0xfff2b0, 1)
        .setDepth(56)
        .setBlendMode(Phaser.BlendModes.ADD);
      this.tweens.add({
        targets: flash,
        scale: { from: 0.5, to: 1.7 },
        alpha: { from: 0.95, to: 0 },
        duration: 70,
        ease: 'Quad.easeOut',
        onComplete: () => flash.destroy()
      });
      // recoil: the whole nest kicks a couple px away from the shot
      if (this.turret) {
        const tu = TUNING.turret;
        const kick = Math.atan2(this.turretAimY - tu.y, this.turretAimX - tu.x);
        this.tweens.killTweensOf(this.turret);
        this.turret.setPosition(tu.x - Math.cos(kick) * 3, tu.y - Math.sin(kick) * 3);
        this.tweens.add({ targets: this.turret, x: tu.x, y: tu.y, duration: 80, ease: 'Quad.easeOut' });
      }
    }
    camImpulse(this, TUNING.juice.shakeSmall * 0.6, 40);

    this.heat = Math.min(1, this.heat + tu.heatPerShot);
    if (this.heat >= 1) {
      this.overheated = true;
      this.firingHeld = false;
      sfx.alarm();
      floatText(this, TUNING.turret.x, TUNING.turret.y - 70, 'OVERHEATED!', HEX.red, 26);
    }
  }

  // ------------------------------------------------------------- interception
  private intercept(th: Threat, byPlayer: boolean): void {
    if (th.dead) return;
    if (th.hp > 1) {
      // armored: first hit cripples — slows it down, no kill, no payout yet
      th.hp--;
      th.speed *= TUNING.spawn.firstHitSlowMult;
      const { x, y } = th.sprite;
      impactFlash(this, x, y);
      shockwave(this, x, y, 0xdddddd, 50);
      th.sprite.setTint(0x8a939b); // scorched — reads as "hit me again"
      this.tweens.add({ targets: th.sprite, scale: { from: 1.3, to: 1 }, duration: 150, ease: 'Back.easeOut' });
      sfx.hit();
      camImpulse(this, TUNING.juice.shakeSmall, 60);
      vibrate(10);
      return;
    }
    th.dead = true;
    const { x, y } = th.sprite;

    this.tweens.add({
      targets: th.sprite,
      scaleX: 0.6,
      scaleY: 0.6,
      duration: 50,
      yoyo: true,
      onComplete: () => this.destroyAnim(th)
    });
    this.hitstop(TUNING.juice.hitstopKillMs);
    impactFlash(this, x, y);
    const col = { missile: PAL.red, drone: PAL.orange, mine: 0xaab4bd, patrol: PAL.red }[th.type];
    shockwave(this, x, y, col, 90);
    // a hot streak makes the world hit harder: denser bursts, stronger shake
    const tier = Math.min(4, Math.floor(this.stats.combo / 10));
    this.burst(x, y, col, th.type === 'mine' ? 'gear' : 'spark', 10 + tier * 2);

    const eco = TUNING.economy;
    const drop = th.type === 'patrol' ? eco.patrolDrop : eco.interceptDrop;
    this.changePrice(-drop);
    sfx.hit();
    camImpulse(this, TUNING.juice.shakeSmall * (1 + tier * TUNING.juice.comboShakePerTier), 80);
    vibrate(15);

    // near-miss = intercepted close to ANY tanker (missiles have no live target)
    let nearMiss = false;
    for (const tk of this.tankers) {
      if (tk.dead) continue;
      if (Phaser.Math.Distance.Between(x, y, tk.sprite.x, tk.sprite.y) < TUNING.juice.nearMissDist) {
        nearMiss = true;
        break;
      }
    }
    if (nearMiss && byPlayer) {
      this.stats.nearMisses++;
      this.slowMo(TUNING.juice.slowmoScale, TUNING.juice.slowmoMs);
      if (!settings.reducedMotion) {
        this.cameras.main.zoomTo(this.baseZoom * 1.12, 150, 'Cubic.easeOut', true);
        this.time.delayedCall(450, () => this.cameras.main.zoomTo(this.baseZoom, 250, 'Cubic.easeOut', true));
      }
      this.changePrice(-TUNING.economy.nearMissDrop);
      sfx.bigHit();
      vibrate([20, 30, 40]);
      this.stats.memeMoment = 'LAST-SECOND SAVE';
      this.emitMeme('LAST-SECOND SAVE');
    }

    const gain = TUNING.economy.interceptCredits;
    this.addCredits(gain, x, y);
    this.stats.intercepts++;
    this.dayCounters.intercepts++;
    if (this.mission?.type === 'intercept') this.bumpMission(this.dayCounters.intercepts);
    this.bumpCombo();

    if (th.swarmId !== undefined) {
      this.swarmRemaining--;
      this.swarmCounter++;
      if (this.swarmRemaining <= 0) this.resolveEvent(true);
    }
  }

  private destroyAnim(th: Threat): void {
    const s = th.sprite;
    const { x, y } = s;
    th.warnRing?.destroy();
    ((s as any).trail as Phaser.GameObjects.Particles.ParticleEmitter | undefined)?.destroy();
    switch (th.type) {
      case 'missile': {
        for (let i = 0; i < 3; i++) {
          this.time.delayedCall(i * 90, () => shockwave(this, x, y, 0xdddddd, 60 + i * 40));
        }
        this.burst(x, y, 0xdddddd, 'puff', 8);
        s.destroy();
        break;
      }
      case 'drone': {
        this.burst(x, y, PAL.orange, 'spark', 8);
        this.tweens.add({
          targets: s,
          angle: 720,
          y: y + 140,
          scale: 0.3,
          alpha: 0.2,
          duration: 600,
          ease: 'Quad.easeIn',
          onComplete: () => {
            sfx.splash();
            this.burst(s.x, s.y, 0x8fd6ef, 'dot', 6);
            s.destroy();
          }
        });
        break;
      }
      case 'mine': {
        sfx.disarm();
        this.burst(x, y, 0xaab4bd, 'gear', 9);
        s.destroy();
        break;
      }
      case 'patrol': {
        sfx.retreat();
        this.tweens.add({
          targets: s,
          alpha: 0,
          y: y + 18,
          scale: s.scale * 0.85,
          duration: 550,
          ease: 'Sine.easeIn',
          onComplete: () => {
            this.burst(x, y + 14, 0x8fd6ef, 'dot', 5);
            s.destroy();
          }
        });
        break;
      }
    }
  }

  private burst(x: number, y: number, tint: number, tex: string, count: number): void {
    count = Math.round(count * TUNING.juice.particleScale);
    if (settings.reducedMotion) count = Math.min(count, 4);
    if (count <= 0) return;
    const em = this.add.particles(x, y, tex, {
      speed: { min: 80, max: 260 },
      angle: { min: 0, max: 360 },
      scale: { start: 1, end: 0 },
      lifespan: { min: 250, max: 550 },
      gravityY: tex === 'gear' ? 500 : 0,
      tint,
      emitting: false
    }).setDepth(800);
    em.explode(count);
    this.time.delayedCall(700, () => em.destroy());
  }

  // ------------------------------------------------------------- combo
  private bumpCombo(): void {
    this.stats.combo++;
    this.stats.bestCombo = Math.max(this.stats.bestCombo, this.stats.combo);
    const milestone = COMBO_MILESTONES[this.stats.combo];
    bus.emit(EV.COMBO, this.stats.combo, milestone);
    this.dayCounters.bestCombo = Math.max(this.dayCounters.bestCombo, this.stats.combo);
    if (this.mission?.type === 'combo') this.bumpMission(this.dayCounters.bestCombo);
    if (this.stats.combo === MEMES.settings.streakCombo) this.emitMeme('ON A RAMPAGE');
    if (milestone) {
      this.addCredits(this.stats.combo, GAME_W / 2, Math.round(200 * FRAME_SCALE_Y));
      sfx.comboSting(Math.floor(this.stats.combo / 10));
    }
  }

  private breakCombo(): void {
    if (this.stats.combo > 0) {
      // losing a real streak deserves its own sting — a silent reset reads as a bug
      if (this.stats.combo >= 5) {
        sfx.comboBreak();
        camImpulse(this, TUNING.juice.shakeSmall, 100);
        floatText(this, GAME_W / 2, Math.round(250 * FRAME_SCALE_Y), `COMBO ×${this.stats.combo} LOST`, HEX.red, 24);
      }
      this.stats.combo = 0;
      bus.emit(EV.COMBO, 0, undefined);
    }
  }

  // ------------------------------------------------------------- economy
  private changePrice(delta: number): void {
    this.stats.oilPrice = Phaser.Math.Clamp(this.stats.oilPrice + delta, 40, 220);
    bus.emit(EV.PRICE, this.stats.oilPrice, delta);
    this.checkThresholds();
    if (delta < 0) sfx.priceDown();
  }

  private checkThresholds(): void {
    const p = this.stats.oilPrice;
    const checks: Array<[string, boolean, string, 'good' | 'bad']> = [
      ['below100', p < 100, 'MARKET CALM-ISH', 'good'],
      ['below80', p < 80, 'AFFORDABLE ROAD TRIP UNLOCKED', 'good'],
      ['above125', p > 125, 'GROUP CHAT STARTING TO WORRY', 'bad'],
      ['above150', p > 150, 'EVERYONE BECOMES AN ENERGY EXPERT', 'bad'],
      ['above175', p > 175, 'BICYCLES NOW A LUXURY ASSET', 'bad']
    ];
    for (const [key, active, , tone] of checks) {
      const was = this.lastPriceSide[key] ?? false;
      if (active && !was) {
        this.lastIncidentAt = this.elapsed;
        // no headline — the news band is day-system only; the market still flinches
        if (tone === 'bad') {
          sfx.alarm();
          bus.emit(EV.MARKET_NUDGE, TUNING.market.nudgeBadNews);
        } else sfx.fanfare();
      }
      this.lastPriceSide[key] = active;
    }
  }

  // ------------------------------------------------------------- meme context
  /** Snapshot of the run's trajectory, built fresh at every meme emit — lets
   *  pickMeme() score variants against price trend, streaks, loss history,
   *  and contradictions, not just the discrete trigger label. */
  private memeContext(): MemeContext {
    const s = this.stats;
    const set = MEMES.settings;
    const hist = s.priceHistory;
    // priceHistory is sampled every 0.5s (see historyTimer in update())
    const samplesAgo = Math.round(set.trendWindowSec / 0.5);
    const idx = Math.max(0, hist.length - 1 - samplesAgo);
    const past = hist[idx] ?? hist[0] ?? s.oilPrice;
    const diff = s.oilPrice - past;
    const trend: MemeContext['trend'] = diff >= set.trendBand ? 'rising' : diff <= -set.trendBand ? 'falling' : 'stable';
    return {
      price: Math.round(s.oilPrice),
      trend,
      tankersLost: s.tankersLost,
      tankersSafe: s.tankersSafe,
      combo: s.combo,
      eventActive: this.eventActive,
      eventsWon: s.eventsWon,
      eventsLost: s.eventsLost,
      elapsed: this.elapsed,
      dangerActive: this.dangerActive,
      threats: this.threats.filter(t => !t.dead).length
    };
  }

  /** Every 'meme-moment' emit goes through here so lastMemeEmitAt (the
   *  watchers' own copy of the global cooldown gap) always tracks reality. */
  private emitMeme(label: string): void {
    this.lastMemeEmitAt = this.elapsed;
    bus.emit('meme-moment', label, this.memeContext());
  }

  /** 1s-cadence check for the two state watchers (dissonance + quiet stretch).
   *  Both are edge-triggered: fire once on entering the state, re-arm only
   *  after the condition has been continuously false for `rearmSec`. */
  private checkWatchers(): void {
    const w = MEMES.settings.watchers;
    const ctx = this.memeContext();

    const dissA = ctx.combo >= (w.dissonance.comboMin ?? Infinity) &&
      ctx.price >= (w.dissonance.priceHigh ?? Infinity) &&
      ctx.trend !== 'falling';
    const dissB = ctx.price <= (w.dissonance.priceLow ?? -Infinity) &&
      ctx.tankersLost >= (w.dissonance.lostMin ?? Infinity);
    this.stepWatcher('dissonance', dissA || dissB, w.dissonance, 'WINNING BUT AT WHAT COST');

    const quietSeconds = this.elapsed - this.lastIncidentAt;
    const quietCond =
      this.elapsed >= (w.quiet.graceSec ?? 0) &&
      quietSeconds >= (w.quiet.quietSec ?? Infinity) &&
      ctx.threats <= (w.quiet.maxThreats ?? 0) &&
      ctx.trend === 'stable';
    this.stepWatcher('quiet', quietCond, w.quiet, 'SUSPICIOUSLY QUIET');
  }

  private stepWatcher(
    key: 'dissonance' | 'quiet',
    cond: boolean,
    tuning: { cooldownSec: number; rearmSec: number },
    label: string
  ): void {
    const s = this.watcherState[key];
    if (cond) {
      s.falseFor = 0;
      if (!s.was && s.armed) {
        const cooledDown = this.elapsed - s.lastFiredAt >= tuning.cooldownSec;
        const gapOk = this.elapsed - this.lastMemeEmitAt >= MEMES.settings.minGapMs / 1000;
        if (cooledDown && gapOk) {
          s.lastFiredAt = this.elapsed;
          s.armed = false;
          this.emitMeme(label);
        }
      }
    } else {
      s.falseFor += 1;
      if (s.falseFor >= tuning.rearmSec) s.armed = true;
    }
    s.was = cond;
  }

  private addCredits(gain: number, x: number, y: number): void {
    // OIL MONEY: all credit income scales with the gold upgrade
    const boosted = Math.round(gain * (1 + this.upgrades.gold * TUNING.upgrades.goldBonusPerLevel));
    this.stats.credits += boosted;
    // x,y are world coords; UIScene draws over the full canvas in 1280×720
    // logical coords, so translate through this scene's viewport+zoom+origin
    // (Phaser's actual camera matrix: viewport pos + origin*(1-zoom) +
    // zoom*(world - scroll)) — that yields physical canvas pixels, so divide
    // by DPR to land the coin fly-out in UIScene's logical space.
    const cam = this.cameras.main;
    const hudX = (cam.x + cam.width * cam.originX * (1 - cam.zoom) + cam.zoom * (x - cam.scrollX)) / DPR;
    const hudY = (cam.y + cam.height * cam.originY * (1 - cam.zoom) + cam.zoom * (y - cam.scrollY)) / DPR;
    bus.emit(EV.CREDITS, this.stats.credits, boosted, hudX, hudY);
  }

  // ------------------------------------------------------------- upgrades
  private buyUpgrade(key: 'air' | 'hull' | 'gold', cost: number): void {
    if (this.over || !this.revealed[key] || this.stats.credits < cost) return;
    this.stats.credits -= cost;
    this.upgrades[key]++;
    this.stats.upgradesBought++;
    bus.emit(EV.CREDITS, this.stats.credits, 0, 0, 0);
    bus.emit(EV.UPGRADE_DEMO, key, this.upgrades[key]);
    analytics.track('upgrade_bought', { key, level: this.upgrades[key] });
    sfx.upgrade();
    vibrate(30);

    const mid = this.routes[0].getPoint(0.5);
    if (key === 'air') {
      if (!this.jet) this.spawnJet();
      floatText(
        this,
        this.jet!.x,
        this.jet!.y - 50,
        this.upgrades.air === 1 ? 'AIR SUPPORT ONLINE' : `AIR SUPPORT LV${this.upgrades.air}`,
        HEX.orange,
        26
      );
      shockwave(this, this.jet!.x, this.jet!.y, PAL.orange, 260);
    } else if (key === 'hull') {
      // existing ships get the extra plating too
      for (const t of this.aliveTankers()) {
        t.hp += TUNING.upgrades.hullHpPerLevel;
        t.maxHp += TUNING.upgrades.hullHpPerLevel;
        floatText(this, t.sprite.x, t.sprite.y - 60, 'REINFORCED!', HEX.green, 22);
      }
      shockwave(this, mid.x, mid.y, PAL.green, 260);
    } else {
      floatText(this, mid.x, mid.y - 60, 'PAYDAY BOOSTED', HEX.gold, 26);
      shockwave(this, mid.x, mid.y, PAL.gold, 260);
    }
  }

  /** AIR ASSISTANCE: draw a simple jet texture once and put it in the sky. */
  private spawnJet(): void {
    if (!this.textures.exists('jetGen')) {
      const g = this.make.graphics({ x: 0, y: 0 }, false);
      g.fillStyle(0xdde6f0, 1);
      g.fillRect(4, 11, 38, 6); // fuselage
      g.fillTriangle(42, 11, 48, 14, 42, 17); // nose
      g.fillTriangle(16, 14, 30, 14, 22, 2); // wing top
      g.fillTriangle(16, 14, 30, 14, 22, 26); // wing bottom
      g.fillTriangle(4, 14, 0, 5, 9, 14); // tail top
      g.fillTriangle(4, 14, 0, 23, 9, 14); // tail bottom
      g.generateTexture('jetGen', 48, 28);
      g.destroy();
    }
    this.jet = this.add.image(GAME_W / 2, Math.round(110 * FRAME_SCALE_Y), 'jetGen').setDepth(40);
  }

  // ------------------------------------------------------------- events
  private updateEvents(dt: number): void {
    if (this.over || this.eventActive) return;
    if (this.eventCooldown > 0) {
      this.eventCooldown -= dt;
      this.eventProb = Phaser.Math.Clamp(this.eventProb + (Math.random() - 0.52) * dt * 0.1, 0.03, 0.35);
      bus.emit(EV.EVENT_PROB, this.eventLabel, this.eventProb, false);
      return;
    }
    this.eventProb += dt * (0.1 + Math.random() * 0.12);
    bus.emit(EV.EVENT_PROB, this.eventLabel, Math.min(this.eventProb, 0.97), false);
    if (this.eventProb >= 1) this.triggerEvent();
  }

  private triggerEvent(): void {
    this.eventActive = true;
    this.lastIncidentAt = this.elapsed;
    bus.emit(EV.EVENT_PROB, this.eventLabel, 0.97, true);
    sfx.eventCard();
    camImpulse(this, 0.006, 200);

    if (this.eventLabel === 'DRONE SWARM SURGE') {
      bus.emit(EV.EVENT_CARD, 'DRONE SWARM SURGE', HEX.purple);
      this.swarmRemaining = 5;
      this.swarmCounter = 0;
      for (let i = 0; i < 5; i++) {
        this.time.delayedCall(300 + i * 350, () => this.spawnThreat('drone', 1));
      }
      this.time.delayedCall(9000, () => {
        if (this.eventActive && this.swarmRemaining > 0) this.resolveEvent(false);
      });
    } else {
      bus.emit(EV.EVENT_CARD, 'VIP TANKER TRANSIT', HEX.gold);
      this.spawnTanker(true);
    }
  }

  private resolveEvent(won: boolean): void {
    if (!this.eventActive) return;
    this.eventActive = false;
    this.eventProb = 0.05;
    this.eventCooldown = 12;
    this.lastIncidentAt = this.elapsed;
    if (won) {
      this.stats.eventsWon++;
      this.changePrice(-4);
      this.addCredits(TUNING.economy.eventWinCredits, GAME_W / 2, TANKER_Y);
      confetti(this, GAME_W / 2, Math.round(200 * FRAME_SCALE_Y), 20);
      sfx.fanfare();
      this.stats.memeMoment = this.stats.memeMoment || `SURVIVED: ${this.eventLabel}`;
      this.emitMeme('EVENT SURVIVED');
    } else {
      this.stats.eventsLost++;
      bus.emit(EV.MARKET_NUDGE, TUNING.market.nudgeBadNews);
      this.changePrice(6);
      this.stats.memeMoment = this.stats.memeMoment || `LOST: ${this.eventLabel}`;
      this.emitMeme('EVENT LOST');
    }
    this.eventLabel = this.eventLabel === 'DRONE SWARM SURGE' ? 'VIP TANKER TRANSIT' : 'DRONE SWARM SURGE';
  }

  // ------------------------------------------------------------- day system
  /** New day: reveal scheduled upgrades, roll the daily mission, announce both. */
  private startDay(n: number): void {
    if (this.over) return;
    this.day = n;
    recordDayReached(n);
    resetDayUnlocks();
    this.dayCounters = { priceAtStart: this.stats.oilPrice, safe: 0, lost: 0, intercepts: 0, bestCombo: 0 };
    const reveals: Array<'air' | 'hull' | 'gold'> = [];
    for (const key of ['air', 'hull', 'gold'] as const) {
      if (!this.revealed[key] && n >= TUNING.days.upgradeRevealDays[key]) {
        this.revealed[key] = true;
        bus.emit(EV.UPGRADE_REVEAL, key);
        reveals.push(key);
      }
    }
    this.mission = this.rollMission(n);
    bus.emit(EV.MISSION, { ...this.mission });
    bus.emit(EV.DAY_START, n, this.mission.text, reveals);
  }

  /** Day-indexed difficulty lookup: entry [day-1], clamped to the last entry
   *  for endless play (day 0 during the brief pre-day-1 window reads entry 0). */
  private dayCurve(curve: number[]): number {
    return curve[Math.min(Math.max(this.day - 1, 0), curve.length - 1)];
  }

  /** Daily mission, scaled by day. Day 1 is always the teaching intercept quota. */
  private rollMission(n: number): DayMission {
    const d = TUNING.days;
    let pool: MissionType[] = n === 1 ? ['intercept'] : ['price', 'intercept', 'combo'];
    if (n >= 3) pool.push('perfect');
    const filtered = pool.filter(t => t !== this.lastMissionType);
    const type = Phaser.Math.RND.pick(filtered.length ? filtered : pool);
    this.lastMissionType = type;
    let target = 0;
    let text = '';
    switch (type) {
      case 'price':
        target = Math.ceil((this.stats.oilPrice + d.priceMargin) / 5) * 5;
        text = `END THE DAY UNDER $${target}`;
        break;
      case 'intercept':
        target = d.interceptQuotaBase + n * d.interceptQuotaPerDay;
        text = `SHOOT DOWN ${target} THREATS`;
        break;
      case 'combo':
        target = d.comboTargetBase + n * d.comboTargetPerDay;
        text = `REACH A x${target} COMBO`;
        break;
      case 'perfect':
        target = 0;
        text = 'LOSE NO TANKERS TODAY';
        break;
    }
    return { day: n, type, text, target, progress: 0, done: false };
  }

  /** Quota-mission progress tick; completes mid-day (prize still pays at day end). */
  private bumpMission(progress: number): void {
    const m = this.mission;
    if (!m || m.done) return;
    m.progress = progress;
    if (m.type !== 'price' && m.type !== 'perfect' && progress >= m.target) {
      m.done = true;
      sfx.fanfare();
      floatText(this, GAME_W / 2, Math.round(250 * FRAME_SCALE_Y), 'MISSION COMPLETE!', HEX.green, 30);
    }
    bus.emit(EV.MISSION, { ...m });
  }

  /** Day boundary: resolve the mission, pay the prize, freeze the world for the
   *  news-band recap, and pre-announce tomorrow's escalations. */
  private endDay(): void {
    const d = TUNING.days;
    const m = this.mission!;
    if (m.type === 'price') m.done = this.stats.oilPrice < m.target;
    else if (m.type === 'perfect') m.done = this.dayCounters.lost === 0;
    const rewardCredits = d.rewardCreditsBase + this.day * d.rewardCreditsPerDay;
    if (m.done) {
      this.addCredits(rewardCredits, GAME_W / 2, Math.round(220 * FRAME_SCALE_Y));
      this.stats.milestoneBonus += this.day * d.rewardScorePerDay;
      this.stats.missionsCompleted++;
      confetti(this, GAME_W / 2, Math.round(220 * FRAME_SCALE_Y), 18);
      sfx.fanfare();
    } else {
      sfx.alarm();
    }
    this.stats.daysSurvived = this.day;
    bus.emit(EV.MISSION, { ...m });
    bus.emit(EV.DAY_END, {
      day: this.day,
      missionText: m.text,
      missionDone: m.done,
      rewardCredits: m.done ? rewardCredits : 0,
      safe: this.dayCounters.safe,
      lost: this.dayCounters.lost,
      price: Math.round(this.stats.oilPrice),
      priceDelta: Math.round(this.stats.oilPrice - this.dayCounters.priceAtStart),
      warnings: this.warningsFor(this.day + 1),
      newMemesUnlocked: getDayUnlocks(),
      memesToday: getDayFired()
    });
    analytics.track('day_end', {
      day: this.day,
      missionDone: m.done,
      safe: this.dayCounters.safe,
      lost: this.dayCounters.lost,
      price: Math.round(this.stats.oilPrice)
    });
    analytics.track('mission_result', { day: this.day, type: m.type, done: m.done });
    this.firingHeld = false;
    this.awaitingNextDay = true;
    // hide the whole world (tankers, threats, gun) behind the recap panel —
    // GameScene renders on its own camera, so this doesn't touch UIScene
    this.cameras.main.fadeOut(settings.reducedMotion ? 0 : 300, 7, 59, 92);
  }

  /** Player clicked NEXT DAY on the frozen recap card — advance and unfreeze. */
  private onNextDayRequest(): void {
    if (!this.awaitingNextDay) return;
    this.awaitingNextDay = false;
    bus.emit(EV.DAY_BREAK, null);
    this.startDay(this.day + 1);
    this.cameras.main.fadeIn(settings.reducedMotion ? 0 : 300, 7, 59, 92);
  }

  /** True while any hostile is still a live danger to the tankers we defend —
   *  the day boundary waits for this to clear (dormant mines don't count). */
  private threatsPressing(): boolean {
    if (!this.aliveTankers().length) return false;
    return this.threats.some(
      th =>
        !th.dead &&
        (th.type === 'missile' ||
          th.type === 'drone' ||
          (th.type === 'patrol' && !!th.target) ||
          (th.type === 'mine' && !!th.armed))
    );
  }

  /** Intel headlines about what tomorrow brings (new weapons / new tech). */
  private warningsFor(nextDay: number): string[] {
    const d = TUNING.days;
    const out: string[] = [];
    if (nextDay === d.threatUnlockDays.mine) out.push('INTEL: MINES EXPECTED IN THE STRAIT TOMORROW');
    if (nextDay === d.threatUnlockDays.patrol) out.push('INTEL: ENEMY PATROL BOATS INBOUND TOMORROW');
    if (nextDay === d.threatUnlockDays.armored) out.push('INTEL: ARMORED WEAPONS TOMORROW — TWO HITS TO DOWN');
    for (const key of ['air', 'hull', 'gold'] as const) {
      if (nextDay === d.upgradeRevealDays[key] && !this.revealed[key]) {
        const names = { air: 'AIR ASSISTANCE', hull: 'HULL ARMOR', gold: 'OIL MONEY' };
        out.push(`NEW TECH TOMORROW: ${names[key]}`);
      }
    }
    return out;
  }

  // ------------------------------------------------------------- tanker outcomes
  private tankerSafe(t: Tanker): void {
    t.dead = true;
    this.stats.tankersSafe++;
    const eco = TUNING.economy;
    const drop = t.vip ? eco.vipDrop : Phaser.Math.Between(eco.tankerDropMin, eco.tankerDropMax);
    sfx.horn();
    this.changePrice(-drop);
    const credits = t.vip ? eco.vipCredits : eco.tankerCredits;
    // celebrate at whichever end of its route the tanker exited
    const ex = Phaser.Math.Clamp(t.sprite.x, 140, GAME_W - 140);
    this.addCredits(credits, ex, t.sprite.y);
    bus.emit('tanker-safe', this.stats.tankersSafe, drop);
    this.dayCounters.safe++;
    this.bumpCombo();
    confetti(this, ex, t.sprite.y, this.stats.tankersSafe % 3 === 0 ? 26 : 10);
    floatText(this, ex, t.sprite.y - 60, `SAFE! −$${drop} OIL`, HEX.green, 34);
    if (t.vip && this.eventActive && this.eventLabel === 'VIP TANKER TRANSIT') this.resolveEvent(true);
    t.wake.destroy();
    t.smoke?.destroy();
    ((t.sprite as any).sparkle as Phaser.GameObjects.Particles.ParticleEmitter | undefined)?.destroy();
    t.sprite.destroy();
  }

  private tankerHit(t: Tanker, th: Threat): void {
    // HULL ARMOR: the ship soaks the hit if it has spare hp — the threat still
    // dies, the market flinches at half strength, and the run rolls on
    t.hp -= 1;
    if (t.hp > 0) {
      th.dead = true;
      sfx.hit();
      camImpulse(this, TUNING.juice.shakeSmall, 150);
      vibrate(25);
      impactFlash(this, t.sprite.x, t.sprite.y, PAL.orange, 60);
      this.burst(t.sprite.x, t.sprite.y, PAL.orange, 'puff', 8);
      const dmgSpike = Math.round(
        (t.vip ? TUNING.economy.vipHitSpike : TUNING.economy.hitSpike) * TUNING.upgrades.hullDamagedSpikeFactor
      );
      this.changePrice(dmgSpike);
      floatText(this, t.sprite.x, t.sprite.y - 70, `HULL HOLDS (${t.hp} HP)`, HEX.gold, 26);
      // persistent distress: scorched hull, a slight heel, and a smoke plume —
      // a wounded ship should look worth protecting, not pristine
      t.sprite.setTint(0xb8b0a4);
      t.list = (Math.random() < 0.5 ? -1 : 1) * 0.07;
      if (!t.smoke && !settings.reducedMotion) {
        t.smoke = this.add
          .particles(0, 0, 'puff', {
            speed: { min: 6, max: 20 },
            angle: { min: 250, max: 290 },
            scale: { start: 0.9, end: 0 },
            alpha: { start: 0.5, end: 0 },
            lifespan: 900,
            frequency: 140,
            tint: 0x3a4148,
            follow: t.sprite
          })
          .setDepth(22);
      }
      ((th.sprite as any).trail as Phaser.GameObjects.Particles.ParticleEmitter | undefined)?.destroy();
      th.sprite.destroy();
      th.warnRing?.destroy();
      return;
    }
    t.dead = true;
    th.dead = true;
    this.stats.tankersLost++;
    this.lastIncidentAt = this.elapsed;
    this.breakCombo();
    sfx.bigHit();
    this.hitstop(TUNING.juice.hitstopLossMs);
    camImpulse(this, TUNING.juice.shakeBig, 300);
    // the run's worst moment gets the camera punch, not just a shake
    if (!settings.reducedMotion) {
      this.cameras.main.zoomTo(this.baseZoom * TUNING.juice.lossZoom, 120, 'Cubic.easeOut', true);
      this.time.delayedCall(280, () => this.cameras.main.zoomTo(this.baseZoom, 300, 'Cubic.easeOut', true));
    }
    vibrate([40, 40, 80]);
    impactFlash(this, t.sprite.x, t.sprite.y, PAL.orange, 80);
    shockwave(this, t.sprite.x, t.sprite.y, PAL.red, 200);
    this.burst(t.sprite.x, t.sprite.y, PAL.orange, 'puff', 14);
    const spike = t.vip ? TUNING.economy.vipHitSpike : TUNING.economy.hitSpike;
    this.changePrice(spike);
    sfx.priceUp();
    bus.emit(EV.MARKET_NUDGE, TUNING.market.nudgeBadNews);
    this.dayCounters.lost++;
    if (this.mission?.type === 'perfect') this.bumpMission(this.dayCounters.lost);
    floatText(this, t.sprite.x, t.sprite.y - 70, `+$${spike} OIL`, HEX.red, 36);
    const lossLabel = this.stats.tankersLost >= 2 ? 'ANOTHER TANKER DOWN' : 'LOST A TANKER ON CAMERA';
    this.stats.memeMoment = this.stats.memeMoment || lossLabel;
    this.emitMeme(lossLabel);
    this.tweens.add({
      targets: t.sprite,
      angle: 14,
      y: t.sprite.y + 60,
      alpha: 0,
      duration: 900,
      ease: 'Quad.easeIn',
      onComplete: () => t.sprite.destroy()
    });
    t.wake.destroy();
    t.smoke?.destroy();
    ((t.sprite as any).sparkle as Phaser.GameObjects.Particles.ParticleEmitter | undefined)?.destroy();
    ((th.sprite as any).trail as Phaser.GameObjects.Particles.ParticleEmitter | undefined)?.destroy();
    th.sprite.destroy();
    th.warnRing?.destroy();
    if (t.vip && this.eventActive && this.eventLabel === 'VIP TANKER TRANSIT') this.resolveEvent(false);
    if (th.swarmId !== undefined && this.eventActive) this.resolveEvent(false);
  }

  // ------------------------------------------------------------- turret loop
  private updateTurret(rawDt: number, dt: number): void {
    const tu = TUNING.turret;

    // heat: always cooling; overheat locks the gun until it recovers
    this.heat = Math.max(0, this.heat - tu.heatCoolPerSec * rawDt);
    if (this.overheated && this.heat <= tu.overheatRecoverAt) {
      this.overheated = false;
      floatText(this, tu.x, tu.y - 70, 'GUN READY', HEX.green, 20);
    }

    // held burst: keep shooting at whatever is under the finger
    this.fireTimer = Math.max(0, this.fireTimer - rawDt);
    if (this.firingHeld && !this.overheated && this.fireTimer === 0 && !this.registry.get('ui-modal')) {
      const p = this.input.activePointer;
      const px = p.x / DPR;
      const py = p.y / DPR;
      if (p.isDown && px >= VIEW.x && px <= VIEW.x + VIEW.w && py >= VIEW.y && py <= VIEW.y + VIEW.h) {
        this.fireTimer = tu.fireInterval;
        const wp = this.cameras.main.getWorldPoint(p.x, p.y);
        this.fireShot(wp.x, wp.y);
      }
    }

    // tracers: home on their threat, fizzle at the aim point if it died
    const step = tu.bulletSpeed * dt;
    for (const b of this.bullets) {
      if (b.target && !b.target.dead) {
        b.aimX = b.target.sprite.x;
        b.aimY = b.target.sprite.y;
      }
      const d = Phaser.Math.Distance.Between(b.sprite.x, b.sprite.y, b.aimX, b.aimY);
      if (d <= Math.max(step, tu.bulletHitRadius)) {
        if (b.target && !b.target.dead) {
          // round-on-armor sparks at the point of arrival — separate from the
          // death burst, so armored first hits still feel like metal on metal
          this.burst(b.sprite.x, b.sprite.y, 0xffe08a, 'spark', 4);
          this.intercept(b.target, !b.fromAir);
        } else {
          // wasted round — small splash so the miss still reads
          this.burst(b.aimX, b.aimY, 0x8fd6ef, 'puff', 3);
        }
        b.sprite.destroy();
        b.done = true;
        continue;
      }
      const ang = Math.atan2(b.aimY - b.sprite.y, b.aimX - b.sprite.x);
      b.sprite.x += Math.cos(ang) * step;
      b.sprite.y += Math.sin(ang) * step;
      b.sprite.setRotation(ang);
    }
    this.bullets = this.bullets.filter(b => !b.done);

    // tracer streaks: one shared graphics, redrawn per frame — a hot fading
    // tail behind every round sells the projectile speed for near-zero cost
    this.trailGfx.clear();
    if (!settings.reducedMotion) {
      for (const b of this.bullets) {
        const ang = b.sprite.rotation;
        this.trailGfx.lineStyle(3, 0xffe08a, 0.3);
        this.trailGfx.lineBetween(b.sprite.x - Math.cos(ang) * 30, b.sprite.y - Math.sin(ang) * 30, b.sprite.x, b.sprite.y);
        this.trailGfx.lineStyle(2, 0xfff6cf, 0.55);
        this.trailGfx.lineBetween(b.sprite.x - Math.cos(ang) * 14, b.sprite.y - Math.sin(ang) * 14, b.sprite.x, b.sprite.y);
      }
    }

    // pose: direction from aim point, firing state from recent shots
    this.turretAnimT += rawDt;
    const firing = this.firingHeld || this.elapsed - this.lastShotAt < 0.18;
    if (this.turretArt) {
      const dx = this.turretAimX - tu.x;
      const dir = dx < -tu.poseSwitchDx ? 'left' : dx > tu.poseSwitchDx ? 'right' : 'mid';
      const frame = Math.floor(this.turretAnimT * (firing ? 10 : 2)) % 2 + 1;
      const key = `trump_${dir}_${firing ? 'fire' : 'idle'}_${frame}`;
      if (this.textures.exists(key) && this.turretBody.texture.key !== key) this.turretBody.setTexture(key);
    } else if (this.turretBarrel) {
      const target = Math.atan2(this.turretAimY - (tu.y - 8), this.turretAimX - tu.x);
      this.turretBarrel.rotation = Phaser.Math.Angle.RotateTo(this.turretBarrel.rotation, target, 8 * rawDt);
      // recoil twitch while firing
      this.turretBody.y = 6 + (firing ? Math.sin(this.turretAnimT * 60) * 1.5 : 0);
    }

    this.drawHeatBar();
  }

  /** Heat gauge beside the gun: green -> amber -> red, flashes when locked. */
  private drawHeatBar(): void {
    const tu = TUNING.turret;
    const g = this.heatBar;
    const x = tu.x + 58;
    const y = tu.y + 30;
    const w = 12;
    const h = 62;
    g.clear();
    g.fillStyle(0x0e141b, 0.75);
    g.fillRoundedRect(x - 2, y - h - 2, w + 4, h + 4, 4);
    const f = this.heat;
    const col = this.overheated
      ? (Math.floor(this.turretAnimT * 8) % 2 ? 0xe6483d : 0x7a1f18) // flash while locked
      : f > 0.75 ? 0xe6483d : f > 0.45 ? 0xf2a33c : 0x39b54a;
    if (f > 0) {
      g.fillStyle(col, 1);
      g.fillRoundedRect(x, y - h * f, w, h * f, 3);
    }
    g.lineStyle(2, 0xdde6f0, 0.5);
    g.strokeRoundedRect(x - 2, y - h - 2, w + 4, h + 4, 4);
  }

  // ------------------------------------------------------------- dev autoplay
  /** Dev-only bot: fires at whichever live threat is closest to hitting its
   *  target (or the turret, if it has none), on the normal fire cooldown. */
  private devAutoPlayFire(): void {
    if (this.over || this.awaitingNextDay || this.overheated || this.fireTimer > 0) return;
    const tu = TUNING.turret;
    let best: Threat | null = null;
    let bestScore = Infinity;
    for (const th of this.threats) {
      if (th.dead) continue;
      // a real tap can only aim inside the visible map (fireShot's lock search
      // is centered on the tap point, which the pointer-in-viewport check
      // keeps within [0, GAME_W]x[0, GAME_H]) — skip threats still off-screen
      // near their spawn edge so the bot can't snipe kills no player could get
      if (th.sprite.x < 0 || th.sprite.x > GAME_W || th.sprite.y < 0 || th.sprite.y > GAME_H) continue;
      const score = th.target
        ? Phaser.Math.Distance.Between(th.sprite.x, th.sprite.y, th.target.sprite.x, th.target.sprite.y)
        : Phaser.Math.Distance.Between(th.sprite.x, th.sprite.y, tu.x, tu.y) + 400; // deprioritize idle threats
      if (score < bestScore) {
        bestScore = score;
        best = th;
      }
    }
    if (!best) return;
    this.fireTimer = tu.fireInterval;
    this.fireShot(best.sprite.x, best.sprite.y);
  }

  // ------------------------------------------------------------- slow motion
  private slowMo(scale: number, ms: number): void {
    if (settings.reducedMotion) return;
    this.worldScale = scale;
    this.time.delayedCall(ms, () => (this.worldScale = 1));
  }

  /** Hitstop: a few frames of total freeze on a kill so impacts crunch.
   *  Skips if slow-mo (or another hitstop) already owns worldScale, and is
   *  rate-capped so held-fire kill chains don't turn into stutter. */
  private hitstop(ms: number): void {
    if (settings.reducedMotion || this.worldScale !== 1) return;
    if (this.elapsed - this.lastHitstopAt < 0.15) return;
    this.lastHitstopAt = this.elapsed;
    this.worldScale = 0;
    this.time.delayedCall(ms, () => {
      if (this.worldScale === 0) this.worldScale = 1;
    });
  }

  /** Blinking chevron at the top edge marking where a flyer just launched. */
  private spawnTelegraph(x: number, color: number): void {
    sfx.spawnCue();
    if (settings.reducedMotion) return;
    const g = this.add.graphics().setDepth(870);
    g.fillStyle(color, 0.9);
    g.fillTriangle(x - 14, 8, x + 14, 8, x, 32);
    this.tweens.add({
      targets: g,
      alpha: { from: 1, to: 0.15 },
      duration: 110,
      yoyo: true,
      repeat: 2,
      onComplete: () => g.destroy()
    });
  }

  // ------------------------------------------------------------- main loop
  update(_time: number, deltaMs: number): void {
    this.drawWaves();
    if (this.over) return;
    const speed = import.meta.env.DEV ? devState.speedMultiplier : 1;
    const rawDt = Math.min(deltaMs / 1000, 0.05) * speed;
    const dt = rawDt * this.worldScale;

    // end-of-day break: the whole world freezes (ships, threats, prices, gun)
    // so the player can read the recap, until they click NEXT DAY
    if (this.awaitingNextDay || this.frozen) return;

    this.elapsed += rawDt;

    const dnLen = TUNING.dayNight.dayLengthSec;
    // day overtime: past the boundary the day can't close while hostiles are
    // still pressing the lanes — the clock pins just before midnight and all
    // spawning stops until the field is clear
    const overtime = this.day > 0 && this.elapsed >= this.day * dnLen;

    // endless survival: timer counts UP; the run ends only via market meltdown
    bus.emit(EV.TIMER, overtime ? this.day * dnLen - 0.001 : this.elapsed);

    // day/night light: brightest at each day boundary, darkest mid-day
    const dn = TUNING.dayNight;
    const phase = (this.elapsed % dn.dayLengthSec) / dn.dayLengthSec;
    this.nightOverlay.setAlpha(dn.nightMaxAlpha * (0.5 - 0.5 * Math.cos(phase * Math.PI * 2)));

    // day boundary: resolve the mission and enter the frozen recap break —
    // but only once no threat is still attacking the ships we defend
    if (overtime && !this.threatsPressing()) {
      this.endDay();
      return;
    }
    if (this.stats.oilPrice >= TUNING.session.failPrice) {
      this.dangerActive = true;
      this.dangerT += rawDt;
      const remaining = Math.max(0, TUNING.session.failSeconds - this.dangerT);
      bus.emit(EV.DANGER, remaining);
      const sec = Math.ceil(remaining);
      if (sec !== this.lastTickSecond) {
        this.lastTickSecond = sec;
        sfx.tick(sec <= 3);
      }
      if (this.dangerT >= TUNING.session.failSeconds) {
        this.endSession();
        return;
      }
    } else if (this.dangerActive) {
      // price recovered — the meltdown clock winds back down
      this.dangerT = Math.max(0, this.dangerT - rawDt * 1.5);
      if (this.dangerT === 0) {
        this.dangerActive = false;
        this.lastTickSecond = -1;
        bus.emit(EV.DANGER, null);
      }
    }

    // ambient audio: the tension drone swells as the price closes on the
    // meltdown line, and keeps climbing through the countdown itself
    this.tensionTimer += rawDt;
    if (this.tensionTimer >= 0.25) {
      this.tensionTimer = 0;
      const fail = TUNING.session.failPrice;
      let tension = Phaser.Math.Clamp((this.stats.oilPrice - (fail - 30)) / 30, 0, 1) * 0.6;
      if (this.dangerActive) tension = 0.6 + 0.4 * Math.min(1, this.dangerT / TUNING.session.failSeconds);
      sfx.setTension(tension);
    }

    // live-market jitter: small mean-reverting ticks between the real
    // event-driven moves; bypasses changePrice() so it never fires
    // threshold alarms or price sfx
    this.jitterTimer += rawDt;
    if (this.jitterTimer > TUNING.economy.jitterInterval) {
      this.jitterTimer = 0;
      const e = TUNING.economy;
      const step = (Math.random() * 2 - 1) * e.jitterAmp - this.noiseOffset * e.jitterReversion;
      this.noiseOffset += step;
      this.stats.oilPrice = Phaser.Math.Clamp(this.stats.oilPrice + step, 40, 220);
      bus.emit(EV.PRICE, this.stats.oilPrice, step, true);
    }

    this.historyTimer += rawDt;
    if (this.historyTimer > 0.5) {
      this.historyTimer = 0;
      this.stats.priceHistory.push(this.stats.oilPrice);
      if (this.stats.priceHistory.length > 90) this.stats.priceHistory.shift();
    }

    // state watchers (dissonance / quiet-stretch memes): 1s cadence, skipped
    // while the world is over (checked at top of update()) — no separate
    // over-guard needed here since we already returned above when this.over.
    this.watcherAccum += rawDt;
    if (this.watcherAccum >= 1) {
      this.watcherAccum -= 1;
      this.checkWatchers();
    }

    // day-authored difficulty: spawn pressure comes from the current day's
    // entry in days.difficulty (clamped to the last entry for endless play)
    const sp = TUNING.spawn;
    const interval = this.dayCurve(TUNING.days.difficulty.spawnInterval);
    const maxThreats = this.dayCurve(TUNING.days.difficulty.maxThreats);
    this.spawnTimer -= rawDt;
    if (this.spawnTimer <= 0 && !overtime && this.threats.filter(t => !t.dead).length < maxThreats) {
      this.spawnTimer = interval * (0.8 + Math.random() * 0.4);
      this.spawnThreat();
    }

    this.tankerTimer -= rawDt;
    if (this.tankerTimer <= 0 && !overtime && this.aliveTankers().length < sp.maxTankers) {
      this.tankerTimer = sp.tankerInterval;
      this.spawnTanker();
    }

    if (!overtime) this.updateEvents(rawDt);
    this.updateTurret(rawDt, dt);
    if (import.meta.env.DEV && devState.autoPlay !== 'off') this.devAutoPlayFire();

    // AIR ASSISTANCE: the jet chases the nearest threat and intercepts on
    // contact (rate-limited); with no threats up it loiters over the strait
    if (this.upgrades.air > 0 && this.jet) {
      const up = TUNING.upgrades;
      this.airTimer = Math.max(0, this.airTimer - rawDt);
      const alive = this.threats.filter(t => !t.dead);
      let tx = GAME_W / 2;
      let ty = Math.round(110 * FRAME_SCALE_Y) + Math.sin(this.waveT * 1.4) * 18;
      let target: Threat | null = null;
      if (alive.length) {
        target = alive.reduce((a, b) =>
          Phaser.Math.Distance.Between(this.jet!.x, this.jet!.y, a.sprite.x, a.sprite.y) <
          Phaser.Math.Distance.Between(this.jet!.x, this.jet!.y, b.sprite.x, b.sprite.y)
            ? a
            : b
        );
        tx = target.sprite.x;
        ty = target.sprite.y;
      }
      const jetSpeed = up.airSpeedBase + this.upgrades.air * up.airSpeedPerLevel;
      const ang = Math.atan2(ty - this.jet.y, tx - this.jet.x);
      const dist = Phaser.Math.Distance.Between(this.jet.x, this.jet.y, tx, ty);
      // hold a standoff distance from a live target — the jet shoots, it doesn't ram
      const closeTo = target ? Math.max(0, dist - up.airStandoffDist) : dist;
      const stepLen = Math.min(jetSpeed * dt, closeTo);
      this.jet.x += Math.cos(ang) * stepLen;
      this.jet.y += Math.sin(ang) * stepLen;
      if (stepLen > 0.5) {
        this.jet.setFlipY(Math.abs(ang) > Math.PI / 2);
        this.jet.setRotation(ang);
      }
      if (target && dist < up.airFireDist && this.airTimer === 0) {
        this.airTimer = Math.max(up.airCooldownMin, up.airCooldownBase - this.upgrades.air * up.airCooldownStep);
        floatText(this, target.sprite.x, target.sprite.y - 50, 'AIR INTERCEPT', HEX.orange, 20);
        const spr = this.add.image(this.jet.x, this.jet.y, 'tracerGen').setDepth(55);
        spr.setRotation(Math.atan2(target.sprite.y - this.jet.y, target.sprite.x - this.jet.x));
        this.bullets.push({
          sprite: spr,
          target,
          aimX: target.sprite.x,
          aimY: target.sprite.y,
          fromAir: true,
        });
        shockwave(this, this.jet.x, this.jet.y, 0xffe08a, 16);
      }
    }

    // tanker movement along its own route spline
    this.waveT += rawDt;
    for (const t of this.tankers) {
      if (t.dead) continue;
      const route = this.routes[t.routeIdx];
      const len = this.routeLengths[t.routeIdx];
      t.dist += t.speed * dt;
      if (t.dist >= len) {
        this.tankerSafe(t);
        continue;
      }
      const frac = t.dist / len;
      const p = route.getPoint(frac);
      const tan = route.getTangent(frac);
      const heading = Math.atan2(tan.y, tan.x);
      t.sprite.setPosition(p.x, p.y + Math.sin(this.waveT * 2 + t.dist / 90) * 2);
      t.sprite.rotation = heading + t.list + Math.sin(this.waveT * 2 + t.dist / 90) * 0.02;
      // keep the foam at the stern as the route curves
      t.wake.followOffset.set(-tan.x * t.sprite.width * 0.5, -tan.y * t.sprite.width * 0.5);
      // keep the hull upright when sailing right -> left
      t.sprite.setFlipY(Math.abs(Phaser.Math.Angle.Wrap(heading)) > Math.PI / 2);
    }
    this.tankers = this.tankers.filter(t => !t.dead);

    // threat movement
    const patrolFacesLeft = hasArt(this, 'patrol');
    for (const th of this.threats) {
      if (th.dead) continue;
      const s = th.sprite;
      if (th.type === 'mine') {
        // stationary; arms only once a ship comes close enough
        th.blinkTimer += rawDt;
        let nearest = Infinity;
        let victim: Tanker | undefined;
        for (const tk of this.tankers) {
          if (tk.dead) continue;
          const d = Phaser.Math.Distance.Between(s.x, s.y, tk.sprite.x, tk.sprite.y);
          if (d < nearest) nearest = d;
          if (d < TUNING.juice.hitDist) victim = tk;
        }
        if (!th.armed && nearest < TUNING.juice.mineActivateDist) {
          th.armed = true;
          sfx.tick(true);
          this.tweens.add({ targets: s, scale: { from: 1.35, to: 1 }, duration: 200, ease: 'Back.easeOut' });
        }
        if (th.armed) {
          // fast angry blink while armed
          s.setTint(Math.floor(th.blinkTimer * 8) % 2 === 0 ? 0xffffff : 0xff6b6b);
          if (victim) this.tankerHit(victim, th);
        } else {
          // dormant: slow, dim blink — harmless until a ship wakes it
          s.setTint(Math.floor(th.blinkTimer * 2) % 2 === 0 ? 0xdddddd : 0xaaaaaa);
        }
        continue;
      }
      if (th.type === 'patrol') {
        // lane-bound: slides along its route spline, chasing the nearest
        // tanker on the same lane; never cuts across open water or land
        const ri = th.routeIdx!;
        if (!th.target || th.target.dead || th.target.routeIdx !== ri || !this.targetable(th.target)) {
          th.target = this.aliveTankers().find(tk => tk.routeIdx === ri && this.targetable(tk)) ?? null;
        }
        const dir = th.target ? Math.sign(th.target.dist - th.dist!) || -1 : -1;
        th.dist = Phaser.Math.Clamp(th.dist! + dir * th.speed * dt, 0, this.routeLengths[ri]);
        const p = this.routePoint(th.dist, ri);
        // rotate to face the direction of travel along the lane, like tankers
        // (art faces left, fallback faces right; dir can run the spline backwards)
        const tan = this.routes[ri].getTangent(Phaser.Math.Clamp(th.dist / this.routeLengths[ri], 0, 1));
        const heading = Math.atan2(tan.y * dir, tan.x * dir);
        const rot = patrolFacesLeft ? heading + Math.PI : heading;
        s.rotation = rot;
        // keep the hull upright whichever way it sails
        s.setFlipY(Math.abs(Phaser.Math.Angle.Wrap(rot)) > Math.PI / 2);
        s.setPosition(p.x, p.y);
        th.warnRing?.destroy();
        th.warnRing = undefined;
        if (th.target) {
          const ring = this.add.graphics().setDepth(29);
          const dTarget = Phaser.Math.Distance.Between(s.x, s.y, th.target.sprite.x, th.target.sprite.y);
          const prog = Phaser.Math.Clamp(1 - dTarget / 500, 0, 1);
          ring.lineStyle(5, PAL.red, 0.8);
          ring.beginPath();
          ring.arc(s.x, s.y - 50, 20, -Math.PI / 2, -Math.PI / 2 + prog * Math.PI * 2);
          ring.strokePath();
          th.warnRing = ring;
          // spawn grace: freshly-arrived boats can't instantly sink a tanker
          if (th.spawnGrace && th.spawnGrace > 0) th.spawnGrace -= dt;
          else {
            const d = Phaser.Math.Distance.Between(s.x, s.y, th.target.sprite.x, th.target.sprite.y);
            if (d < TUNING.juice.hitDist) this.tankerHit(th.target, th);
          }
        } else if (th.dist <= 0) {
          // sailed its whole lane with no prey — slips back out of the strait
          th.dead = true;
          s.destroy();
        }
        continue;
      }
      let tx: number;
      let ty: number;
      if (th.type === 'missile') {
        // ballistic: fly straight to the impact point locked at launch
        tx = th.aimX!;
        ty = th.aimY!;
        if (Phaser.Math.Distance.Between(s.x, s.y, tx, ty) < 18) {
          // reached the impact point — did anything sail into it?
          const victim = this.tankers.find(
            tk => !tk.dead && Phaser.Math.Distance.Between(s.x, s.y, tk.sprite.x, tk.sprite.y) < TUNING.juice.hitDist
          );
          if (victim) {
            this.tankerHit(victim, th);
          } else {
            // empty water — detonate harmlessly
            th.dead = true;
            sfx.splash();
            shockwave(this, s.x, s.y, 0xdddddd, 70);
            this.burst(s.x, s.y, 0x8fd6ef, 'dot', 6);
            ((s as any).trail as Phaser.GameObjects.Particles.ParticleEmitter | undefined)?.destroy();
            s.destroy();
          }
          continue;
        }
      } else if (th.target && !th.target.dead && this.targetable(th.target)) {
        tx = th.target.sprite.x;
        ty = th.target.sprite.y;
      } else {
        // other threats hunt for a new tanker (drop locks that sailed out of
        // the targetable window — no chasing ships off-screen)
        th.target = this.aliveTankers().find(tk => this.targetable(tk)) ?? null;
        const fb = this.routes[0].getPoint(0.5);
        tx = th.target ? th.target.sprite.x : fb.x;
        ty = th.target ? th.target.sprite.y : fb.y;
      }
      const ang = Math.atan2(ty - s.y, tx - s.x);
      // missiles fly dead straight; drones weave
      const wob = th.type === 'drone' ? Math.sin(this.elapsed * 6 + s.x) * 0.5 : 0;
      s.x += Math.cos(ang + wob) * th.speed * dt;
      s.y += Math.sin(ang + wob) * th.speed * dt;
      if (th.type === 'missile') s.rotation = ang + wob;
      if (th.type === 'drone') s.angle += 120 * dt;
      if (th.target && !th.target.dead) {
        const d = Phaser.Math.Distance.Between(s.x, s.y, th.target.sprite.x, th.target.sprite.y);
        if (d < TUNING.juice.hitDist) this.tankerHit(th.target, th);
      }
    }
    this.threats = this.threats.filter(t => !t.dead);
  }

  // ------------------------------------------------------------- end
  /** Dev-only hook: force an immediate loss to test the results/leaderboard flow. */
  devForceLoss(): void {
    if (!this.over) this.endSession();
  }

  /** Dev-only hook: end the current day immediately, skipping the remaining timer
   *  and any still-pressing threats. */
  devEndDay(): void {
    if (!this.over && !this.awaitingNextDay) this.endDay();
  }

  private endSession(): void {
    this.over = true;
    this.stats.survivalTime = this.elapsed;
    analytics.track('run_end', {
      score: computeScore(this.stats),
      survivalTime: this.stats.survivalTime,
      daysSurvived: this.stats.daysSurvived,
      tankersSafe: this.stats.tankersSafe,
      tankersLost: this.stats.tankersLost,
      bestCombo: this.stats.bestCombo
    });
    bus.emit(EV.DANGER, null);
    sfx.stopAmbient();
    sfx.whoosh();
    this.tweens.add({ targets: this.cameras.main, zoom: this.baseZoom * 1.05, duration: 350, ease: 'Sine.easeOut' });
    this.registry.set('finalStats', this.stats);
    this.time.delayedCall(700, () => {
      this.scene.stop('UI');
      this.scene.start('Results');
    });
  }
}
