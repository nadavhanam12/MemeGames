// Twitter-style engagement-bar icons (public/icons/) — hand-authored generic
// line icons (not Twitter's actual SVG assets) rasterized via
// scripts/gen-engage-icons.mjs, loaded as plain PNGs like shareIcons.ts.
// White source art so each icon can be recolored per-use with setTint().
import Phaser from 'phaser';

export const ENGAGEMENT_ICON_KEYS = {
  reply: 'engageIconReply',
  retweet: 'engageIconRetweet',
  heart: 'engageIconHeart',
  analytics: 'engageIconAnalytics',
  share: 'engageIconShare'
} as const;

export function loadEngagementIcons(scene: Phaser.Scene): Promise<void> {
  return new Promise(resolve => {
    scene.load.image(ENGAGEMENT_ICON_KEYS.reply, 'icons/engage-reply.png');
    scene.load.image(ENGAGEMENT_ICON_KEYS.retweet, 'icons/engage-retweet.png');
    scene.load.image(ENGAGEMENT_ICON_KEYS.heart, 'icons/engage-heart.png');
    scene.load.image(ENGAGEMENT_ICON_KEYS.analytics, 'icons/engage-analytics.png');
    scene.load.image(ENGAGEMENT_ICON_KEYS.share, 'icons/engage-share.png');
    scene.load.once(Phaser.Loader.Events.COMPLETE, () => resolve());
    scene.load.start();
  });
}
