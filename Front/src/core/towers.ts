// Shared definitions for the SEA DEFENSES tower layer. Numbers live in
// src/config/tuning.json ("towers"); this module is the typed view both
// GameScene (combat + purchases) and UIScene (day-end shop mini-map) share.
import { TUNING } from '../config/tuning';

export type TowerType = 'ciws' | 'depth' | 'jammer';

// per-type tuning entry (jammer swaps fireInterval for slowMult)
export interface TowerCfg {
  costs: number[];
  range: number[];
  fireInterval?: number[];
  slowMult?: number[];
  revealDay: number;
}

export function towerCfg(type: TowerType): TowerCfg {
  return (TUNING.towers.types as Record<TowerType, TowerCfg>)[type];
}

/** Total credits sunk into a tower at `level` (for sell refunds). */
export function towerInvested(type: TowerType, level: number): number {
  return towerCfg(type).costs.slice(0, level).reduce((a, b) => a + b, 0);
}

/** Refund paid when selling a tower at `level`. */
export function towerRefund(type: TowerType, level: number): number {
  return Math.round(towerInvested(type, level) * TUNING.towers.sellRefundFrac);
}

export interface TowerDef {
  key: TowerType;
  name: string;
  glyph: string;
  desc: string;
}

export const TOWER_DEFS: TowerDef[] = [
  { key: 'ciws', name: 'CIWS PLATFORM', glyph: '🎯', desc: 'Auto-flak vs missiles & drones' },
  { key: 'depth', name: 'DEPTH CHARGES', glyph: '💣', desc: 'Clears mines & patrol boats' },
  { key: 'jammer', name: 'SIGNAL JAMMER', glyph: '📡', desc: 'Slows threats in its radius' }
];

/** Snapshot of one occupied slot, published to the registry by GameScene. */
export interface TowerStateEntry {
  type: TowerType;
  level: number;
}
