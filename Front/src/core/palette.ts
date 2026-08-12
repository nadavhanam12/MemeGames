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
  purple: 0x9b5de5
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
  purple: '#9B5DE5'
} as const;

export const FONT_DISPLAY = '"Anton", "Arial Black", "Impact", sans-serif';
export const FONT_SANS = '"Chakra Petch", "Helvetica Neue", Arial, sans-serif';

export const GAME_W = 1280;
export const GAME_H = 720;

// Canvas backing-store multiplier for hi-DPI screens (capped to keep fill
// rate sane on weak GPUs). World/layout coordinates stay in GAME_W×GAME_H;
// the canvas is DPR× larger and every camera zooms by DPR to compensate.
export const DPR = Math.min(window.devicePixelRatio || 1, 2);

// The gameplay camera renders inside this screen rect ("broadcast window");
// the HUD frames it: left column, top band, bottom chyron.
export const VIEW = { x: 402, y: 28, w: 850, h: 484 } as const;
