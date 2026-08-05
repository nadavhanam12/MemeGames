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
  memeMoment: string;
  priceHistory: number[];
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
    memeMoment: '',
    priceHistory: [startPrice]
  };
}

// Canonical session score — used for the results rank AND the value submitted
// to the leaderboard server, so the two never drift apart.
export function computeScore(s: SessionStats): number {
  const delta = s.startPrice - s.oilPrice;
  // survival time is the backbone of the score in endless mode
  return Math.max(0, Math.round(s.survivalTime * 2 + delta * 2 + s.tankersSafe * 6 - s.tankersLost * 8 + s.bestCombo));
}

// One global emitter for cross-scene events (HUD <-> gameplay).
export const bus = new Phaser.Events.EventEmitter();

export const EV = {
  PRICE: 'price-changed', // (newPrice, delta)
  CREDITS: 'credits-changed', // (credits, gain, x, y) world coords of source when gained
  COMBO: 'combo-changed', // (combo, milestone?)
  HEADLINE: 'headline', // (text, tone: 'good'|'bad'|'event')
  EVENT_PROB: 'event-prob', // (label, probability 0..1, active)
  EVENT_CARD: 'event-card', // (title, color)
  THRESHOLD: 'price-threshold', // (label, tone)
  TIMER: 'timer', // (elapsedSeconds — survival time counts UP)
  DANGER: 'danger', // (secondsUntilMeltdown | null when cleared)
  GAME_OVER: 'game-over', // (stats)
  UPGRADE_DEMO: 'upgrade-demo' // (upgradeKey)
} as const;

export const COMBO_MILESTONES: Record<number, string> = {
  5: 'ALERT INTERN',
  10: 'DRONE BONKER',
  20: 'MARKET STABILIZER',
  30: 'ACCIDENTAL SUPERPOWER',
  50: 'HORMUZ HAS ENTERED EASY MODE'
};

export const SAFE_HEADLINES = [
  'GLOBAL COMMUTE SAVED, FOR NOW',
  'TANKER ARRIVES; INTERNET CLAIMS CREDIT',
  'OIL DROPS; ECONOMISTS BEGIN EXPLAINING WHY',
  'THREE SHIPS SAFE: DIPLOMACY SOMEHOW WORKING',
  'CAPTAIN SHRUGS, MARKETS SOAR',
  'ANALYSTS STUNNED BY BOAT DOING ITS JOB',
  'SHIPPING LANE DECLARED "FINE, PROBABLY"'
];

export const BAD_HEADLINES = [
  'GROUP CHAT DEMANDS ANSWERS',
  'SPOKESPERSON DENIES EVERYTHING, TWICE',
  'MARKETS PANIC POLITELY',
  'OIL SPIKES; BICYCLE SALES SURGE',
  'EXPERTS AGREE: SOMETHING HAPPENED'
];
