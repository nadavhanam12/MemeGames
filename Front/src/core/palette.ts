// Art-direction palette — single source of truth for every color in the game.
export const PAL = {
  navy: 0x071018,
  ocean: 0x1a9bc5,
  sand: 0xcaa76b,
  green: 0x54df93,
  red: 0xff4d5a,
  gold: 0xf4b942,
  orange: 0xe99b3c,
  cream: 0xf2f2ee,
  ink: 0x0d151d,
  purple: 0xa46de1,
  black: 0x000000,
  white: 0xffffff,
  muted: 0x89939d
} as const;

export const HEX = {
  navy: '#071018',
  ocean: '#1A9BC5',
  sand: '#CAA76B',
  green: '#54DF93',
  red: '#FF4D5A',
  gold: '#F4B942',
  orange: '#E99B3C',
  cream: '#F2F2EE',
  ink: '#0D151D',
  purple: '#A46DE1',
  black: '#000000',
  white: '#FFFFFF',
  muted: '#89939D'
} as const;

export const FONT_DISPLAY = '"Anton", "Arial Black", "Impact", sans-serif';
export const FONT_SANS = '"Chakra Petch", "Helvetica Neue", Arial, sans-serif';

export const GAME_W = 720;
export const GAME_H = 1280;

// Canvas backing-store multiplier for hi-DPI screens (capped to keep fill
// rate sane on weak GPUs). World/layout coordinates stay in GAME_W×GAME_H;
// the canvas is DPR× larger and every camera zooms by DPR to compensate.
export const DPR = Math.min(window.devicePixelRatio || 1, 2);

// Desktop side panels kick in at this width (index.html's matching
// @media (min-width: 1180px) — keep the two in sync). At that width the
// media area (VIEW) goes edge-to-edge instead of inset, so gameplay reads
// wider/bigger even though the post frame (HEADER/ENGAGEMENT/COMMENTS) and
// overall canvas stay the same 720×1280. The camera/backdrop-cover math in
// GameScene already handles VIEW being wider than the 720-wide authored
// world (see drawWorld's camW/camH cover-scale) — no gameplay code needed.
const DESKTOP_BREAKPOINT = 1180;
const IS_WIDE_VIEW = window.innerWidth >= DESKTOP_BREAKPOINT;
const VIEW_MARGIN = IS_WIDE_VIEW ? 0 : 20;

// Portrait "feed post" frame: the gameplay camera renders inside VIEW (the
// embedded media area); the HUD stacks around it top-to-bottom as HEADER
// (avatar/handle bar), ENGAGEMENT (reply/retweet/like/view icon row) and
// COMMENTS (scrollable unlocks/reactions strip).
export const HEADER = { x: 0, y: 0, w: GAME_W, h: 64 } as const;
export const VIEW = { x: VIEW_MARGIN, y: 74, w: GAME_W - VIEW_MARGIN * 2, h: 780 } as const;
export const ENGAGEMENT = { x: 20, y: 864, w: GAME_W - 40, h: 50 } as const;
export const COMMENTS = { x: 0, y: 924, w: GAME_W, h: 346 } as const;
