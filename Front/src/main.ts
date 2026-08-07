import Phaser from 'phaser';
import { GAME_H, GAME_W, PAL } from './core/palette';
import { BootScene } from './scenes/BootScene';
import { MenuScene } from './scenes/MenuScene';
import { GameScene } from './scenes/GameScene';
import { UIScene } from './scenes/UIScene';
import { ResultsScene } from './scenes/ResultsScene';
import { LeaderboardScene } from './scenes/LeaderboardScene';
import { initDevtools } from './dev/devtools';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: GAME_W,
  height: GAME_H,
  backgroundColor: PAL.ink,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH
  },
  input: {
    activePointers: 3
  },
  scene: [BootScene, MenuScene, GameScene, UIScene, ResultsScene, LeaderboardScene]
});

initDevtools(game);

// Dev console handle, e.g. phaserGame.scene.start('Game')
if (import.meta.env.DEV) (window as any).phaserGame = game;
