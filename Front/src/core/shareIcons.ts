// Official platform icons for the share buttons (public/icons/) — plain
// standalone PNGs, loaded straight from public/ rather than through the
// generated-art pipeline (that pipeline is for sharp-processed game art).
import Phaser from 'phaser';

export const SHARE_ICON_KEYS = {
  whatsapp: 'shareIconWhatsapp',
  x: 'shareIconX',
  facebook: 'shareIconFacebook'
} as const;

export function loadShareIcons(scene: Phaser.Scene): Promise<void> {
  return new Promise(resolve => {
    scene.load.image(SHARE_ICON_KEYS.whatsapp, 'icons/share-whatsapp.png');
    scene.load.image(SHARE_ICON_KEYS.x, 'icons/share-x.png');
    scene.load.image(SHARE_ICON_KEYS.facebook, 'icons/share-facebook.png');
    scene.load.once(Phaser.Loader.Events.COMPLETE, () => resolve());
    scene.load.start();
  });
}
