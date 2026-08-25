// Shared definitions for the SEA TURRETS tower-defense layer. Numbers live in
// src/config/tuning.json ("towers"); this module is the typed view both
// GameScene (combat + purchases + placement mode) and UIScene (day-end shop
// card + upgrade/sell popup) share. One universal tower type: it shoots any
// threat in range.
import { TUNING } from '../config/tuning';

export const TOWER_NAME = 'SEA TURRET';
export const TOWER_GLYPH = '🎯';
export const TOWER_DESC = 'Auto-fires at any threat in range';

export function towerMaxLevel(): number {
  return TUNING.towers.upgradeCosts.length + 1;
}

/** Price of the NEXT turret, escalating with how many are already built. */
export function towerBuildCost(builtCount: number): number {
  const costs = TUNING.towers.buildCosts;
  return costs[Math.min(builtCount, costs.length - 1)];
}

/** Price of upgrading FROM `level` (1-based) to the next one. */
export function towerUpgradeCost(level: number): number {
  return TUNING.towers.upgradeCosts[level - 1];
}

/** Refund paid when selling a tower that has `invested` credits sunk in. */
export function towerRefund(invested: number): number {
  return Math.round(invested * TUNING.towers.sellRefundFrac);
}

/** Snapshot of one occupied slot, published to the registry by GameScene. */
export interface TowerStateEntry {
  level: number;
  invested: number;
}
