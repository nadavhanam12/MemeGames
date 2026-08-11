// Session state shared between the gameplay scene, HUD scene and results scene.
import Phaser from 'phaser';
import { TUNING } from '../config/tuning';

export interface SessionStats {
  oilPrice: number;
  startPrice: number;
  credits: number;
  combo: number;
  bestCombo: number;
  intercepts: number;
  tankersSafe: number;
  tankersLost: number;
  nearMisses: number;
  upgradesBought: number;
  eventsWon: number;
  eventsLost: number;
  survivalTime: number;
  milestoneBonus: number;
  daysSurvived: number;
  missionsCompleted: number;
  memeMoment: string;
  priceHistory: number[];
}

// Daily mission carried by EV.MISSION / resolved in the day-end summary.
export type MissionType = 'price' | 'escort' | 'intercept' | 'perfect' | 'combo';

export interface DayMission {
  day: number;
  type: MissionType;
  text: string;
  target: number;
  progress: number;
  done: boolean;
}

export interface DaySummary {
  day: number;
  missionText: string;
  missionDone: boolean;
  rewardCredits: number; // 0 when the mission failed
  safe: number;
  lost: number;
  price: number;
  priceDelta: number;
  warnings: string[]; // pre-announcements for tomorrow's escalations
  newMemesUnlocked: string[]; // template ids seen for the first time ever, today
}

export function freshStats(): SessionStats {
  const { startPrice, startCredits } = TUNING.session;
  return {
    oilPrice: startPrice,
    startPrice,
    credits: startCredits,
    combo: 0,
    bestCombo: 0,
    intercepts: 0,
    tankersSafe: 0,
    tankersLost: 0,
    nearMisses: 0,
    upgradesBought: 0,
    eventsWon: 0,
    eventsLost: 0,
    survivalTime: 0,
    milestoneBonus: 0,
    daysSurvived: 0,
    missionsCompleted: 0,
    memeMoment: '',
    priceHistory: [startPrice]
  };
}

// Canonical session score — used for the results rank AND the value submitted
// to the leaderboard server, so the two never drift apart.
export function computeScore(s: SessionStats): number {
  const delta = s.startPrice - s.oilPrice;
  // survival time is the backbone of the score in endless mode
  return Math.max(0, Math.round(s.survivalTime * 2 + delta * 2 + s.tankersSafe * 6 - s.tankersLost * 8 + s.bestCombo + s.milestoneBonus));
}

// One global emitter for cross-scene events (HUD <-> gameplay).
export const bus = new Phaser.Events.EventEmitter();
// Dev console handle, e.g. bus.emit('meme-moment', 'EVENT LOST')
if (import.meta.env.DEV) (window as any).bus = bus;

export const EV = {
  PRICE: 'price-changed', // (newPrice, delta)
  CREDITS: 'credits-changed', // (credits, gain, x, y) world coords of source when gained
  COMBO: 'combo-changed', // (combo, milestone?)
  HEADLINE: 'headline', // (text, tone: 'good'|'bad'|'event', holdMs?)
  EVENT_PROB: 'event-prob', // (label, probability 0..1, active)
  EVENT_CARD: 'event-card', // (title, color)
  MISSION: 'day-mission', // (DayMission) — assigned at day start, updated on progress
  DAY_START: 'day-start', // (day, missionText, revealedUpgradeKeys)
  DAY_END: 'day-end', // (DaySummary) — shown in the news band during the break
  DAY_BREAK: 'day-break', // (null) — fires when the player dismisses the frozen recap
  NEXT_DAY_REQUEST: 'next-day-request', // () — player clicked NEXT DAY on the recap card
  UPGRADE_REVEAL: 'upgrade-reveal', // (upgradeKey) — button unlocks in the shop
  MARKET_NUDGE: 'market-nudge', // (delta) — silent prediction-market push, no headline
  TIMER: 'timer', // (elapsedSeconds — survival time counts UP)
  DANGER: 'danger', // (secondsUntilMeltdown | null when cleared)
  GAME_OVER: 'game-over', // (stats)
  UPGRADE_DEMO: 'upgrade-demo', // (upgradeKey)
  DEV_FORCE_MEME: 'dev-force-meme' // () — dev panel: show a meme now, ignoring the cooldown
} as const;

export const COMBO_MILESTONES: Record<number, string> = {
  5: 'ALERT INTERN',
  10: 'DRONE BONKER',
  20: 'MARKET STABILIZER',
  30: 'ACCIDENTAL SUPERPOWER',
  50: 'HORMUZ HAS ENTERED EASY MODE'
};

// The breaking-news band is reserved for the day system (summaries, intel
// warnings, unlock reveals) — the old per-event headline pools are gone.
