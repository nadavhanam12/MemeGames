// Art-direction palette — single source of truth for every color in the game.
export const PAL = {
  navy: 0x073b5c,
  ocean: 0x087ca7,
  sand: 0xe8c07d,
  green: 0x35d07f,
  red: 0xff4d5a,
  gold: 0xf4b942,
  orange: 0xff8a3d,
  cream: 0xfff3d6,
  ink: 0x17202a,
  purple: 0x9b5de5,
  black: 0x000000,
  muted: 0x71767b
} as const;

export const HEX = {
  navy: '#073B5C',
  ocean: '#087CA7',
  sand: '#E8C07D',
  green: '#35D07F',
  red: '#FF4D5A',
  gold: '#F4B942',
  orange: '#FF8A3D',
  cream: '#FFF3D6',
  ink: '#17202A',
  purple: '#9B5DE5',
  black: '#000000',
  muted: '#71767B'
} as const;

export const FONT_DISPLAY = '"Anton", "Arial Black", "Impact", sans-serif';
export const FONT_SANS = '"Chakra Petch", "Helvetica Neue", Arial, sans-serif';

export const GAME_W = 720;
export const GAME_H = 1280;

// Canvas backing-store multiplier for hi-DPI screens (capped to keep fill
// rate sane on weak GPUs). World/layout coordinates stay in GAME_W×GAME_H;
// the canvas is DPR× larger and every camera zooms by DPR to compensate.
export const DPR = Math.min(window.devicePixelRatio || 1, 2);

// Portrait "feed post" frame: the gameplay camera renders inside VIEW (the
// embedded media area); the HUD stacks around it top-to-bottom as HEADER
// (avatar/handle bar), ENGAGEMENT (reply/retweet/like/view icon row) and
// COMMENTS (scrollable unlocks/reactions strip).
export const HEADER = { x: 0, y: 0, w: GAME_W, h: 64 } as const;
export const VIEW = { x: 20, y: 74, w: GAME_W - 40, h: 780 } as const;
export const ENGAGEMENT = { x: 20, y: 864, w: GAME_W - 40, h: 50 } as const;
export const COMMENTS = { x: 0, y: 924, w: GAME_W, h: 346 } as const;
