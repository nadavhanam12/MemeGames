import Phaser from 'phaser';
import { GAME_H, GAME_W, HEX, PAL, VIEW } from '../core/palette';
import { settings, vibrate } from '../core/settings';
import { sfx } from '../core/sfx';
import { hasArt } from '../core/art';
import { TUNING, persistTuningLocal } from '../config/tuning';
import { devState } from '../dev/state';
import { leaderboard } from '../backend/leaderboard';
import {
  camImpulse,
  confetti,
  floatText,
  impactFlash,
  shockwave
} from '../core/juice';
import {
  BAD_HEADLINES,
  COMBO_MILESTONES,
  EV,
  SAFE_HEADLINES,
  SessionStats,
  bus,
  freshStats
} from '../core/state';

type ThreatType = 'missile' | 'drone' | 'mine' | 'patrol';

interface Threat {
  sprite: Phaser.GameObjects.Image;
  type: ThreatType;
  speed: number;
  target: Tanker | null;
  dead: boolean;
  swarmId?: number;
  warnRing?: Phaser.GameObjects.Graphics;
  blinkTimer: number;
  // missiles lock onto a point once their target is gone — no retargeting
  aimX?: number;
  aimY?: number;
  armed?: boolean; // mines: only live once a ship has come close
}

interface Tanker {
  sprite: Phaser.GameObjects.Image;
  wake: Phaser.GameObjects.Particles.ParticleEmitter;
  speed: number;
  dist: number; // distance travelled along its route spline
  routeIdx: number; // which shipping lane it sails
  vip: boolean;
  dead: boolean;
}

// Fallback (code-drawn map) geometry: straight horizontal lane.
const LANE_TOP = 220;
const LANE_BOT = 500;
const TANKER_Y = 360;

export class GameScene extends Phaser.Scene {
  private stats!: SessionStats;
  private tankers: Tanker[] = [];
  private threats: Threat[] = [];
  private routes: Phaser.Curves.Spline[] = [];
  private routeLengths: number[] = [];
  private elapsed = 0;
  private worldScale = 1;
  private spawnTimer = 0;
  private tankerTimer = 5;
  private historyTimer = 0;
  private over = false;
  private lastPriceSide: Record<string, boolean> = {};
  private mapArt = false;

  private upgrades = { jammer: 0, ciws: 0, escort: 0 };
  private ciwsTimer = 0;

  private eventProb = 0;
  private eventLabel = 'DRONE SWARM SURGE';
  private eventActive = false;
  private eventCooldown = 14;
  private swarmRemaining = 0;
  private swarmCounter = 0;

  private waveGfx!: Phaser.GameObjects.Graphics;
  private waveT = 0;
  private lastTickSecond = -1;
  private baseZoom = 1;
  private dangerT = 0;
  private dangerActive = false;
  private routeGfx?: Phaser.GameObjects.Graphics;
  private routeLabel?: Phaser.GameObjects.Text;
  private routeHandles: Phaser.GameObjects.Arc[] = [];

  constructor() {
    super('Game');
  }

  create(): void {
    // Prefetch a score token now so it satisfies the server's 60s minimum age
    // by the time the run ends and the player submits from the results screen.
    leaderboard.beginRun();
    this.stats = freshStats();
    this.tankers = [];
    this.threats = [];
    this.elapsed = 0;
    this.worldScale = 1;
    this.over = false;
    this.spawnTimer = 1.2;
    this.tankerTimer = 1.0;
    this.eventProb = 0;
    this.eventActive = false;
    this.eventCooldown = 14;
    this.upgrades = { jammer: 0, ciws: 0, escort: 0 };
    this.lastPriceSide = {};
    this.dangerT = 0;
    this.dangerActive = false;
    this.mapArt = hasArt(this, 'map_bg');
    this.buildRoute();
    this.drawWorld();
    if (import.meta.env.DEV && devState.routeEdit) this.enableRouteEdit(true);
    this.waveGfx = this.add.graphics().setDepth(6);

    // render the world inside the broadcast window; HUD frames it
    this.baseZoom = Math.min(VIEW.w / GAME_W, VIEW.h / GAME_H);
    this.cameras.main.setViewport(VIEW.x, VIEW.y, VIEW.w, VIEW.h);
    this.cameras.main.setZoom(this.baseZoom);
    this.cameras.main.centerOn(GAME_W / 2, GAME_H / 2);
    this.cameras.main.fadeIn(250, 7, 59, 92);
    this.scene.launch('UI');

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      // ignore taps while a UI modal (upgrades panel) is open
      if (this.registry.get('ui-modal')) return;
      // ignore taps on the HUD frame outside the broadcast window
      if (p.x < VIEW.x || p.x > VIEW.x + VIEW.w || p.y < VIEW.y || p.y > VIEW.y + VIEW.h) return;
      const wp = this.cameras.main.getWorldPoint(p.x, p.y);
      this.onTap(wp.x, wp.y);
    });

    bus.removeAllListeners('buy-upgrade');
    bus.on('buy-upgrade', (key: 'jammer' | 'ciws' | 'escort', cost: number) => this.buyUpgrade(key, cost));

    this.events.on('shutdown', () => {
      bus.removeAllListeners('buy-upgrade');
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
    if (!on) return;
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
    const cover = Math.max(VIEW.w / zoom / GAME_W, VIEW.h / zoom / GAME_H);
    if (this.mapArt) {
      this.add.image(GAME_W / 2, GAME_H / 2, 'map_bg').setDisplaySize(GAME_W * cover, GAME_H * cover).setDepth(0);
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
        fontFamily: '"Arial Black", Impact, sans-serif',
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
    const wake = this.add.particles(0, 0, 'dot', {
      speed: { min: 10, max: 30 },
      angle: { min: 160, max: 200 },
      scale: { start: 0.7, end: 0 },
      alpha: { start: 0.5, end: 0 },
      lifespan: 700,
      frequency: 70,
      tint: 0xffffff,
      follow: sprite,
      followOffset: { x: this.routes[routeIdx].getTangent(0).x < 0 ? sprite.width / 2 : -sprite.width / 2, y: 8 }
    }).setDepth(15);
    const sp = TUNING.speeds;
    // VIP sails at normal tanker speed — same random range as everyone else
    const base = Phaser.Math.Between(sp.tankerMin, sp.tankerMax);
    const t: Tanker = {
      sprite,
      wake,
      speed: base * (1 + this.upgrades.escort * TUNING.upgrades.escortSpeedPerLevel),
      dist: 0,
      routeIdx,
      vip,
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
      bus.emit(EV.HEADLINE, 'VIP TANKER IN TRANSIT. NO PRESSURE.', 'event');
    }
    this.tankers.push(t);
  }

  private spawnThreat(type?: ThreatType, swarmId?: number): void {
    if (this.over) return;
    const pool: ThreatType[] =
      this.elapsed < 15
        ? ['missile', 'drone']
        : this.elapsed < 30
          ? ['missile', 'drone', 'mine']
          : ['missile', 'drone', 'mine', 'patrol'];
    const t = type ?? Phaser.Math.RND.pick(pool);
    const target = this.aliveTankers()[0] ?? null;

    let sprite: Phaser.GameObjects.Image;
    let speed = 60;
    let x = 0;
    let y = 0;

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
        // stationary: pops into the water near one of the shipping lanes
        speed = 0;
        const ri = Phaser.Math.Between(0, this.routes.length - 1);
        const tt = 0.15 + Math.random() * 0.7;
        const p = this.routes[ri].getPoint(tt);
        const tan = this.routes[ri].getTangent(tt).normalize();
        const off = Phaser.Math.Between(-75, 75);
        x = p.x - tan.y * off;
        y = p.y + tan.x * off;
        sprite = this.add.image(x, y, 'mine');
        break;
      }
      case 'patrol': {
        // races out from the right end of the strait
        speed = TUNING.speeds.patrol;
        const pri = Phaser.Math.Between(0, this.routes.length - 1);
        const p = this.routePoint(this.routeLengths[pri] - 40, pri);
        // emerge from whichever side that route's downstream end is on
        x = p.x > GAME_W / 2 ? GAME_W + 80 : -80;
        y = Phaser.Math.Clamp(p.y + Phaser.Math.Between(-30, 60), 80, GAME_H - 180);
        sprite = this.add.image(x, y, 'patrol');
        break;
      }
    }
    sprite.setDepth(30);
    const jam = 1 - this.upgrades.jammer * TUNING.upgrades.jammerSlowPerLevel;
    const late = 1 + Math.min((this.elapsed / 60) * TUNING.spawn.speedRampPerMinute, TUNING.spawn.speedRampMax);
    const threat: Threat = {
      sprite,
      type: t,
      speed: speed * jam * late,
      target: t === 'missile' ? null : target,
      dead: false,
      swarmId,
      blinkTimer: 0
    };
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

  // ------------------------------------------------------------- input
  private onTap(x: number, y: number): void {
    if (this.over) return;
    if (import.meta.env.DEV && (devState.layoutEdit || devState.routeEdit)) return;
    sfx.unlock();
    sfx.tap();
    shockwave(this, x, y, 0xffffff, 36);

    let best: Threat | null = null;
    let bestD = TUNING.juice.tapRadius;
    for (const th of this.threats) {
      if (th.dead) continue;
      const d = Phaser.Math.Distance.Between(x, y, th.sprite.x, th.sprite.y);
      if (d < bestD) {
        bestD = d;
        best = th;
      }
    }
    if (best) this.intercept(best, true);
  }

  // ------------------------------------------------------------- interception
  private intercept(th: Threat, byPlayer: boolean): void {
    if (th.dead) return;
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
    impactFlash(this, x, y);
    const col = { missile: PAL.red, drone: PAL.orange, mine: 0xaab4bd, patrol: PAL.red }[th.type];
    shockwave(this, x, y, col, 90);
    this.burst(x, y, col, th.type === 'mine' ? 'gear' : 'spark', 10);

    const eco = TUNING.economy;
    const drop = th.type === 'patrol' ? eco.patrolDrop : eco.interceptDrop;
    this.changePrice(-drop);
    floatText(this, x, y - 40, `−$${drop.toFixed(2)} OIL`, HEX.green);
    sfx.hit();
    camImpulse(this, TUNING.juice.shakeSmall, 80);
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
      floatText(this, x, y - 90, 'LAST-SECOND SAVE', HEX.gold, 40);
      this.changePrice(-TUNING.economy.nearMissDrop);
      sfx.bigHit();
      vibrate([20, 30, 40]);
      this.stats.memeMoment = 'LAST-SECOND SAVE';
      bus.emit('meme-moment', 'LAST-SECOND SAVE');
    }

    const gain = TUNING.economy.interceptCredits + this.upgrades.escort;
    this.addCredits(gain, x, y);
    this.stats.intercepts++;
    this.bumpCombo();

    if (th.swarmId !== undefined) {
      this.swarmRemaining--;
      this.swarmCounter++;
      floatText(this, x, y - 130, `CHAIN ×${this.swarmCounter}`, HEX.purple, 26 + this.swarmCounter * 3);
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
        floatText(this, x, y + 30, 'DISARMED', HEX.cream, 22);
        s.destroy();
        break;
      }
      case 'patrol': {
        sfx.retreat();
        floatText(this, x, y - 60, 'NOPE.', HEX.cream, 26);
        this.tweens.add({ targets: s, scaleX: -s.scaleX, duration: 150, ease: 'Cubic.easeOut' });
        this.tweens.add({
          targets: s,
          x: GAME_W + 160,
          duration: 900,
          ease: 'Cubic.easeIn',
          onComplete: () => s.destroy()
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
    if (milestone) {
      this.addCredits(this.stats.combo, GAME_W / 2, 200);
      sfx.comboSting(Math.floor(this.stats.combo / 10));
    }
  }

  private breakCombo(): void {
    if (this.stats.combo > 0) {
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
    for (const [key, active, label, tone] of checks) {
      const was = this.lastPriceSide[key] ?? false;
      if (active && !was) {
        bus.emit(EV.THRESHOLD, label, tone);
        if (tone === 'bad') sfx.alarm();
        else sfx.fanfare();
      }
      this.lastPriceSide[key] = active;
    }
  }

  private addCredits(gain: number, x: number, y: number): void {
    this.stats.credits += gain;
    bus.emit(EV.CREDITS, this.stats.credits, gain, x, y);
  }

  // ------------------------------------------------------------- upgrades
  private buyUpgrade(key: 'jammer' | 'ciws' | 'escort', cost: number): void {
    if (this.over || this.stats.credits < cost) return;
    this.stats.credits -= cost;
    this.upgrades[key]++;
    this.stats.upgradesBought++;
    bus.emit(EV.CREDITS, this.stats.credits, 0, 0, 0);
    bus.emit(EV.UPGRADE_DEMO, key, this.upgrades[key]);
    sfx.upgrade();
    vibrate(30);

    const mid = this.routes[0].getPoint(0.5);
    if (key === 'jammer') {
      const demo = this.add.image(GAME_W / 2, 120, 'drone').setDepth(30).setAlpha(0.9);
      floatText(this, demo.x, demo.y - 50, 'JAMMED (DEMO)', HEX.purple, 24);
      this.tweens.add({
        targets: demo,
        x: demo.x + 200,
        duration: 1600,
        ease: 'Sine.easeOut',
        onComplete: () => demo.destroy()
      });
      this.tweens.add({ targets: demo, alpha: 0, delay: 1100, duration: 500 });
      shockwave(this, mid.x, mid.y, PAL.purple, 320);
    } else if (key === 'ciws') {
      shockwave(this, mid.x, mid.y, PAL.orange, 260);
      floatText(this, mid.x, mid.y - 60, 'AUTO-DEFENSE ONLINE', HEX.orange, 26);
    } else {
      for (const t of this.aliveTankers()) {
        t.speed *= 1.15;
        floatText(this, t.sprite.x, t.sprite.y - 60, 'ESCORTED!', HEX.green, 22);
      }
    }
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
    if (won) {
      this.stats.eventsWon++;
      bus.emit(
        EV.HEADLINE,
        this.eventLabel === 'DRONE SWARM SURGE' ? 'SWARM BONKED; SKY QUIET AGAIN' : 'VIP ARRIVES; SUNGLASSES INTACT',
        'good'
      );
      this.changePrice(-4);
      this.addCredits(TUNING.economy.eventWinCredits, GAME_W / 2, TANKER_Y);
      confetti(this, GAME_W / 2, 200, 20);
      sfx.fanfare();
      this.stats.memeMoment = this.stats.memeMoment || `SURVIVED: ${this.eventLabel}`;
    } else {
      this.stats.eventsLost++;
      bus.emit(EV.HEADLINE, 'EVENT GOES BADLY; MARKETS TYPE FURIOUSLY', 'bad');
      this.changePrice(6);
      this.stats.memeMoment = this.stats.memeMoment || `LOST: ${this.eventLabel}`;
    }
    this.eventLabel = this.eventLabel === 'DRONE SWARM SURGE' ? 'VIP TANKER TRANSIT' : 'DRONE SWARM SURGE';
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
    bus.emit(EV.HEADLINE, Phaser.Math.RND.pick(SAFE_HEADLINES), 'good');
    bus.emit('tanker-safe', this.stats.tankersSafe, drop);
    this.bumpCombo();
    confetti(this, ex, t.sprite.y, this.stats.tankersSafe % 3 === 0 ? 26 : 10);
    floatText(this, ex, t.sprite.y - 60, `SAFE! −$${drop} OIL`, HEX.green, 34);
    if (t.vip && this.eventActive && this.eventLabel === 'VIP TANKER TRANSIT') this.resolveEvent(true);
    t.wake.destroy();
    ((t.sprite as any).sparkle as Phaser.GameObjects.Particles.ParticleEmitter | undefined)?.destroy();
    t.sprite.destroy();
  }

  private tankerHit(t: Tanker, th: Threat): void {
    t.dead = true;
    th.dead = true;
    this.stats.tankersLost++;
    this.breakCombo();
    sfx.bigHit();
    camImpulse(this, TUNING.juice.shakeBig, 300);
    vibrate([40, 40, 80]);
    impactFlash(this, t.sprite.x, t.sprite.y, PAL.orange, 80);
    shockwave(this, t.sprite.x, t.sprite.y, PAL.red, 200);
    this.burst(t.sprite.x, t.sprite.y, PAL.orange, 'puff', 14);
    const spike = t.vip ? TUNING.economy.vipHitSpike : TUNING.economy.hitSpike;
    this.changePrice(spike);
    sfx.priceUp();
    bus.emit(EV.HEADLINE, Phaser.Math.RND.pick(BAD_HEADLINES), 'bad');
    floatText(this, t.sprite.x, t.sprite.y - 70, `+$${spike} OIL`, HEX.red, 36);
    this.stats.memeMoment = this.stats.memeMoment || 'LOST A TANKER ON CAMERA';
    bus.emit('meme-moment', 'LOST A TANKER ON CAMERA');
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
    ((t.sprite as any).sparkle as Phaser.GameObjects.Particles.ParticleEmitter | undefined)?.destroy();
    ((th.sprite as any).trail as Phaser.GameObjects.Particles.ParticleEmitter | undefined)?.destroy();
    th.sprite.destroy();
    th.warnRing?.destroy();
    if (t.vip && this.eventActive && this.eventLabel === 'VIP TANKER TRANSIT') this.resolveEvent(false);
    if (th.swarmId !== undefined && this.eventActive) this.resolveEvent(false);
  }

  // ------------------------------------------------------------- slow motion
  private slowMo(scale: number, ms: number): void {
    if (settings.reducedMotion) return;
    this.worldScale = scale;
    this.time.delayedCall(ms, () => (this.worldScale = 1));
  }

  // ------------------------------------------------------------- main loop
  update(_time: number, deltaMs: number): void {
    this.drawWaves();
    if (this.over) return;
    const rawDt = Math.min(deltaMs / 1000, 0.05);
    const dt = rawDt * this.worldScale;
    this.elapsed += rawDt;

    // endless survival: timer counts UP; the run ends only via market meltdown
    bus.emit(EV.TIMER, this.elapsed);
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

    this.historyTimer += rawDt;
    if (this.historyTimer > 0.5) {
      this.historyTimer = 0;
      this.stats.priceHistory.push(this.stats.oilPrice);
      if (this.stats.priceHistory.length > 90) this.stats.priceHistory.shift();
    }

    // continuous difficulty ramp toward minInterval / maxThreatsEnd
    const sp = TUNING.spawn;
    const prog = Math.min(this.elapsed / sp.rampSeconds, 1);
    const interval = Phaser.Math.Linear(sp.startInterval, sp.minInterval, prog);
    const maxThreats = Math.round(Phaser.Math.Linear(sp.maxThreatsStart, sp.maxThreatsEnd, prog));
    this.spawnTimer -= rawDt;
    if (this.spawnTimer <= 0 && this.threats.filter(t => !t.dead).length < maxThreats) {
      this.spawnTimer = interval * (0.8 + Math.random() * 0.4);
      this.spawnThreat();
    }

    this.tankerTimer -= rawDt;
    if (this.tankerTimer <= 0 && this.aliveTankers().length < sp.maxTankers) {
      this.tankerTimer = sp.tankerInterval;
      this.spawnTanker();
    }

    this.updateEvents(rawDt);

    if (this.upgrades.ciws > 0) {
      this.ciwsTimer -= rawDt;
      if (this.ciwsTimer <= 0) {
        this.ciwsTimer = TUNING.upgrades.ciwsBaseInterval - this.upgrades.ciws * TUNING.upgrades.ciwsIntervalStep;
        const alive = this.threats.filter(t => !t.dead);
        if (alive.length) {
          const target = alive[0];
          floatText(this, target.sprite.x, target.sprite.y - 50, 'CIWS', HEX.orange, 20);
          this.intercept(target, false);
        }
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
      t.sprite.rotation = heading + Math.sin(this.waveT * 2 + t.dist / 90) * 0.02;
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
      } else if (th.target && !th.target.dead) {
        tx = th.target.sprite.x;
        ty = th.target.sprite.y;
      } else {
        // other threats hunt for a new tanker
        th.target = this.aliveTankers()[0] ?? null;
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
      if (th.type === 'patrol') {
        // face the direction of travel (art faces left, fallback faces right)
        const movingLeft = Math.cos(ang) < 0;
        s.setFlipX(patrolFacesLeft ? !movingLeft : movingLeft);
        th.warnRing?.destroy();
        if (th.target) {
          const ring = this.add.graphics().setDepth(29);
          const dTarget = Phaser.Math.Distance.Between(s.x, s.y, tx, ty);
          const prog = Phaser.Math.Clamp(1 - dTarget / 500, 0, 1);
          ring.lineStyle(5, PAL.red, 0.8);
          ring.beginPath();
          ring.arc(s.x, s.y - 50, 20, -Math.PI / 2, -Math.PI / 2 + prog * Math.PI * 2);
          ring.strokePath();
          th.warnRing = ring;
        }
      }
      if (th.target && !th.target.dead) {
        const d = Phaser.Math.Distance.Between(s.x, s.y, th.target.sprite.x, th.target.sprite.y);
        if (d < TUNING.juice.hitDist) this.tankerHit(th.target, th);
      }
    }
    this.threats = this.threats.filter(t => !t.dead);
  }

  // ------------------------------------------------------------- end
  private endSession(): void {
    this.over = true;
    this.stats.survivalTime = this.elapsed;
    bus.emit(EV.DANGER, null);
    sfx.whoosh();
    this.tweens.add({ targets: this.cameras.main, zoom: this.baseZoom * 1.05, duration: 350, ease: 'Sine.easeOut' });
    this.registry.set('finalStats', this.stats);
    this.time.delayedCall(700, () => {
      this.scene.stop('UI');
      this.scene.start('Results');
    });
  }
}
