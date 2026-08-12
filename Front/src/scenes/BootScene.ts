// Loads generated art (public/assets/) and creates programmatic fallback
// textures for anything missing. Fallbacks are reported in the console.
import Phaser from 'phaser';
import { PAL } from '../core/palette';
import { hasArt, loadGeneratedArt } from '../core/art';

const OUTLINE = 5; // shared outline thickness (art consistency rule)

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    this.makeParticles();
    void Promise.all([this.loadFonts(), loadGeneratedArt(this)]).then(() => {
      // programmatic fallbacks only for keys with no generated texture
      this.makeTankers();
      this.makeThreats();
      this.makeUpgradeIcons();
      this.scene.start('Menu');
    });
  }

  // Text objects render to canvas immediately; if the webfont lands after
  // that, Phaser won't repaint, so make sure both faces are ready first.
  private loadFonts(): Promise<unknown> {
    const fonts = document.fonts;
    if (!fonts) return Promise.resolve();
    return Promise.all([fonts.load('400 20px Anton'), fonts.load('600 20px "Chakra Petch"')]).catch(() => undefined);
  }

  private g(): Phaser.GameObjects.Graphics {
    return this.make.graphics({ x: 0, y: 0 }, false);
  }

  private makeParticles(): void {
    // soft dot
    let g = this.g();
    g.fillStyle(0xffffff, 1);
    g.fillCircle(8, 8, 8);
    g.generateTexture('dot', 16, 16);
    g.destroy();

    // spark (diamond)
    g = this.g();
    g.fillStyle(0xffffff, 1);
    g.beginPath();
    g.moveTo(10, 0);
    g.lineTo(20, 10);
    g.lineTo(10, 20);
    g.lineTo(0, 10);
    g.closePath();
    g.fillPath();
    g.generateTexture('spark', 20, 20);
    g.destroy();

    // smoke puff
    g = this.g();
    g.fillStyle(0xffffff, 0.9);
    g.fillCircle(12, 12, 10);
    g.fillCircle(20, 14, 8);
    g.fillCircle(6, 16, 7);
    g.generateTexture('puff', 30, 26);
    g.destroy();

    // gear piece (for mine disarm)
    g = this.g();
    g.fillStyle(0xaab4bd, 1);
    g.lineStyle(3, PAL.ink, 1);
    g.fillCircle(10, 10, 8);
    g.strokeCircle(10, 10, 8);
    g.fillStyle(PAL.ink, 1);
    g.fillCircle(10, 10, 3);
    g.generateTexture('gear', 20, 20);
    g.destroy();
  }

  /** Cartoon tanker viewed slightly top-down: rounded hull, oil containers, bridge. */
  private tankerTexture(key: string, hull: number, tanks: number, w: number, h: number): void {
    const g = this.g();
    const oy = 6;
    // wake handled at runtime; draw hull
    g.fillStyle(PAL.ink, 1);
    g.fillRoundedRect(0, oy, w, h, h / 2.4); // outline via bigger dark shape
    g.fillStyle(hull, 1);
    g.fillRoundedRect(OUTLINE, oy + OUTLINE, w - OUTLINE * 2, h - OUTLINE * 2, (h - OUTLINE * 2) / 2.4);
    // deck stripe
    g.fillStyle(0xffffff, 0.18);
    g.fillRoundedRect(OUTLINE + 6, oy + OUTLINE + 4, w - OUTLINE * 2 - 12, 8, 4);
    // oil containers
    const n = 3;
    const cw = (w - 90) / n;
    for (let i = 0; i < n; i++) {
      const cx = 30 + i * (cw + 8);
      g.fillStyle(PAL.ink, 1);
      g.fillRoundedRect(cx, oy + h / 2 - 16, cw, 32, 10);
      g.fillStyle(tanks, 1);
      g.fillRoundedRect(cx + 3, oy + h / 2 - 13, cw - 6, 26, 8);
      g.fillStyle(0xffffff, 0.35);
      g.fillRoundedRect(cx + 6, oy + h / 2 - 10, cw - 12, 7, 3);
    }
    // bridge at stern with a friendly window
    g.fillStyle(PAL.ink, 1);
    g.fillRoundedRect(w - 46, oy + h / 2 - 20, 34, 40, 8);
    g.fillStyle(PAL.cream, 1);
    g.fillRoundedRect(w - 43, oy + h / 2 - 17, 28, 34, 6);
    g.fillStyle(PAL.ink, 1);
    g.fillCircle(w - 29, oy + h / 2 - 4, 6); // window "eye"
    g.fillStyle(0xffffff, 1);
    g.fillCircle(w - 31, oy + h / 2 - 6, 2);
    g.generateTexture(key, w, h + 12);
    g.destroy();
  }

  private makeTankers(): void {
    if (!hasArt(this, 'tanker0')) this.tankerTexture('tanker0', 0xd96c3f, PAL.gold, 190, 64);
    if (!hasArt(this, 'tanker1')) this.tankerTexture('tanker1', 0x4a7fa5, PAL.orange, 170, 58);
    this.tankerTexture('tanker2', 0x6b8f71, PAL.gold, 210, 68); // cartoon-only variant
    if (!hasArt(this, 'tankerVip')) this.tankerTexture('tankerVip', PAL.gold, 0xffe08a, 230, 74);
  }

  private makeThreats(): void {
    if (hasArt(this, 'missile') && hasArt(this, 'drone') && hasArt(this, 'mine') && hasArt(this, 'patrol')) return;
    if (!hasArt(this, 'missile')) this.makeMissile();
    if (!hasArt(this, 'drone')) this.makeDrone();
    if (!hasArt(this, 'mine')) this.makeMine();
    if (!hasArt(this, 'patrol')) this.makePatrol();
  }

  private makeMissile(): void {
    // Missile: sharp red silhouette
    let g = this.g();
    g.fillStyle(PAL.ink, 1);
    g.beginPath();
    g.moveTo(0, 14);
    g.lineTo(40, 0);
    g.lineTo(64, 14);
    g.lineTo(40, 28);
    g.closePath();
    g.fillPath();
    g.fillStyle(PAL.red, 1);
    g.beginPath();
    g.moveTo(6, 14);
    g.lineTo(40, 4);
    g.lineTo(57, 14);
    g.lineTo(40, 24);
    g.closePath();
    g.fillPath();
    g.fillStyle(0xffffff, 0.6);
    g.fillTriangle(14, 13, 36, 7, 36, 13);
    g.generateTexture('missile', 64, 28);
    g.destroy();
  }

  private makeDrone(): void {
    // Drone: angular black X-shape with glowing orange core
    const g = this.g();
    g.fillStyle(PAL.ink, 1);
    g.fillRoundedRect(0, 22, 56, 12, 5); // arms
    g.fillRoundedRect(22, 0, 12, 56, 5);
    g.fillCircle(8, 28, 9);
    g.fillCircle(48, 28, 9);
    g.fillCircle(28, 8, 9);
    g.fillCircle(28, 48, 9);
    g.fillStyle(0x39424e, 1);
    g.fillCircle(28, 28, 13);
    g.fillStyle(PAL.orange, 1);
    g.fillCircle(28, 28, 8);
    g.fillStyle(0xffd9a8, 1);
    g.fillCircle(28, 28, 4);
    g.generateTexture('drone', 56, 56);
    g.destroy();
  }

  private makeMine(): void {
    // Mine: round spiked ball with blinking light (light drawn at runtime)
    const g = this.g();
    g.fillStyle(PAL.ink, 1);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const cx = 30 + Math.cos(a) * 26;
      const cy = 30 + Math.sin(a) * 26;
      g.fillCircle(cx, cy, 6);
    }
    g.fillCircle(30, 30, 24);
    g.fillStyle(0x39424e, 1);
    g.fillCircle(30, 30, 19);
    g.fillStyle(0x51606f, 1);
    g.fillCircle(25, 25, 8);
    g.generateTexture('mine', 60, 60);
    g.destroy();
  }

  // Hull Armor reuses the tanker sprite art directly — no dedicated icon needed.
  private makeUpgradeIcons(): void {
    if (!hasArt(this, 'upgradeIconAir')) this.makeUpgradeIconAir();
    if (!hasArt(this, 'upgradeIconGold')) this.makeUpgradeIconGold();
  }

  /** Jet silhouette banking in, three-quarter angle. */
  private makeUpgradeIconAir(): void {
    const g = this.g();
    g.fillStyle(PAL.ink, 1);
    g.beginPath();
    g.moveTo(2, 30);
    g.lineTo(24, 22);
    g.lineTo(50, 4);
    g.lineTo(56, 8);
    g.lineTo(36, 26);
    g.lineTo(58, 26);
    g.lineTo(66, 30);
    g.lineTo(58, 34);
    g.lineTo(36, 34);
    g.lineTo(50, 50);
    g.lineTo(44, 52);
    g.lineTo(24, 38);
    g.lineTo(2, 34);
    g.closePath();
    g.fillPath();
    g.fillStyle(PAL.ocean, 1);
    g.beginPath();
    g.moveTo(6, 30);
    g.lineTo(24, 24);
    g.lineTo(48, 8);
    g.lineTo(50, 10);
    g.lineTo(32, 27);
    g.lineTo(56, 27);
    g.lineTo(60, 30);
    g.lineTo(56, 33);
    g.lineTo(32, 33);
    g.lineTo(50, 48);
    g.lineTo(48, 49);
    g.lineTo(24, 36);
    g.lineTo(6, 30);
    g.closePath();
    g.fillPath();
    g.fillStyle(0xffffff, 0.5);
    g.fillTriangle(10, 29, 26, 25, 26, 29);
    g.generateTexture('upgradeIconAir', 68, 56);
    g.destroy();
  }

  /** Stack of gold coins. */
  private makeUpgradeIconGold(): void {
    const g = this.g();
    const coin = (cx: number, cy: number) => {
      g.fillStyle(PAL.ink, 1);
      g.fillEllipse(cx, cy, 34, 22);
      g.fillStyle(PAL.gold, 1);
      g.fillEllipse(cx, cy, 28, 16);
      g.fillStyle(0xffe08a, 0.7);
      g.fillEllipse(cx, cy - 2, 18, 8);
    };
    coin(30, 44);
    coin(30, 32);
    coin(30, 20);
    g.generateTexture('upgradeIconGold', 60, 56);
    g.destroy();
  }

  private makePatrol(): void {
    // Patrol ship: compact dark vessel, oversized siren
    const g = this.g();
    g.fillStyle(PAL.ink, 1);
    g.fillRoundedRect(0, 18, 96, 34, 16);
    g.fillStyle(0x2d3a47, 1);
    g.fillRoundedRect(4, 22, 88, 26, 12);
    g.fillStyle(PAL.ink, 1);
    g.fillRoundedRect(30, 6, 36, 26, 6);
    g.fillStyle(0x39424e, 1);
    g.fillRoundedRect(33, 9, 30, 20, 5);
    // oversized siren
    g.fillStyle(PAL.ink, 1);
    g.fillCircle(48, 6, 10);
    g.fillStyle(PAL.red, 1);
    g.fillCircle(48, 6, 7);
    g.fillStyle(0xffffff, 0.7);
    g.fillCircle(46, 4, 2.5);
    g.generateTexture('patrol', 96, 58);
    g.destroy();
  }
}
