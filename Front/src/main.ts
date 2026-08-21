import Phaser from 'phaser';
import { DPR, GAME_H, GAME_W, PAL } from './core/palette';
import { BootScene } from './scenes/BootScene';
import { MenuScene } from './scenes/MenuScene';
import { IntroScene } from './scenes/IntroScene';
import { GameScene } from './scenes/GameScene';
import { UIScene } from './scenes/UIScene';
import { ResultsScene } from './scenes/ResultsScene';
import { LeaderboardScene } from './scenes/LeaderboardScene';
import { GalleryScene } from './scenes/GalleryScene';
import { initDevtools } from './dev/devtools';
import { setupPortraitLock } from './core/orientation';
import { initSidePanels } from './core/sidePanels';

setupPortraitLock();
void initSidePanels();

// Hi-DPI: every add.text() renders its glyph texture at DPR× so text stays
// crisp under the DPR camera zoom. Explicit style.resolution still wins.
const factoryProto = Phaser.GameObjects.GameObjectFactory.prototype as any;
const origText = factoryProto.text;
factoryProto.text = function (
  x: number,
  y: number,
  text?: string | string[],
  style?: Phaser.Types.GameObjects.Text.TextStyle
) {
  return origText.call(this, x, y, text, { resolution: DPR, ...style });
};

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: GAME_W * DPR,
  height: GAME_H * DPR,
  backgroundColor: PAL.ink,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH
  },
  render: {
    roundPixels: true
  },
  input: {
    activePointers: 3
  },
  scene: [BootScene, MenuScene, IntroScene, GameScene, UIScene, ResultsScene, LeaderboardScene, GalleryScene]
});

// Hi-DPI: the canvas backing store is DPR× larger than the 1280×720 logical
// space, so every full-canvas scene camera zooms by DPR. GameScene is exempt —
// it runs its world camera in a sub-viewport and applies DPR itself.
game.events.once(Phaser.Core.Events.READY, () => {
  for (const scene of game.scene.scenes) {
    if (scene.scene.key === 'Game' || scene.scene.key === 'Intro') continue;
    const applyZoom = () =>
      scene.cameras.main.setZoom(DPR).centerOn(GAME_W / 2, GAME_H / 2);
    scene.events.on(Phaser.Scenes.Events.START, applyZoom);
    scene.events.on(Phaser.Scenes.Events.CREATE, applyZoom);
    if (scene.scene.isActive() || scene.scene.isPaused()) applyZoom();
  }
});

// iOS Safari toggles its address/toolbar chrome without firing a reliable
// window `resize` (Phaser's default listener), leaving the canvas sized
// against a stale viewport. `visualViewport` reports the true visible size.
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', () => game.scale.refresh());
}

initDevtools(game);

// Dev console handle, e.g. phaserGame.scene.start('Game')
if (import.meta.env.DEV) (window as any).phaserGame = game;
