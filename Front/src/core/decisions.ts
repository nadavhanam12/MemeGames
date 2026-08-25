// Day-break decision system: between days the player is shown a themed
// "viral post" with two choices; each choice applies multi-day gameplay
// modifiers, an instant oil-price move, and nudges a hidden reputation
// meter that gates which future events can roll. All event content and
// numbers live in tuning.json → decisions; this module is the typed view
// plus the run-scoped state (reset every run, never persisted).
import { TUNING } from '../config/tuning';

/** Multiplier stats a decision effect can touch. enemyRate >1 = more spawns;
 *  enemySpeed >1 = faster threats; weaponCooldown >1 = slower reloads (player
 *  gun AND sea turrets); credits >1 = more income. */
export type DecisionStat = 'enemyRate' | 'enemySpeed' | 'weaponCooldown' | 'credits';

export interface DecisionEffect {
  stat: DecisionStat;
  mult: number;
  /** How many in-game days the effect lasts (1 = just the coming day). */
  days: number;
}

export interface DecisionOption {
  label: string;
  /** Hand-authored display lines shown on the choice card. */
  effectLines: string[];
  effects: DecisionEffect[];
  /** Instant oil-price move applied the moment the choice is made. */
  oilDelta: number;
  /** Hidden reputation nudge: + = aggressive, - = diplomatic. */
  repDelta: number;
}

export interface DecisionEvent {
  id: string;
  /** Fake account that "posts" the story on the decision screen. */
  handle: string;
  subtext: string;
  story: string;
  minDay: number;
  /** Optional reputation gates — event only rolls inside [repMin, repMax]. */
  repMin?: number;
  repMax?: number;
  options: DecisionOption[];
}

interface ActiveEffect extends DecisionEffect {
  remaining: number;
}

let reputation = 0;
let active: ActiveEffect[] = [];
let usedIds: string[] = [];
let pending: DecisionEvent | null = null;

function events(): DecisionEvent[] {
  // JSON infers effect stats as plain strings — narrow to the typed view
  return TUNING.decisions.events as unknown as DecisionEvent[];
}

/** Wipe all decision state — call once at run start. */
export function resetDecisions(): void {
  reputation = 0;
  active = [];
  usedIds = [];
  pending = null;
}

export function getReputation(): number {
  return reputation;
}

/** Pick the decision the player will face before `nextDay` starts, or null
 *  when nothing is eligible. No repeats until the eligible pool cycles. */
export function rollDecision(nextDay: number): DecisionEvent | null {
  const eligible = (pool: DecisionEvent[]) =>
    pool.filter(
      e =>
        nextDay >= e.minDay &&
        (e.repMin === undefined || reputation >= e.repMin) &&
        (e.repMax === undefined || reputation <= e.repMax)
    );
  let pool = eligible(events().filter(e => !usedIds.includes(e.id)));
  if (!pool.length) {
    // pool exhausted — recycle (keep rep gates, drop the no-repeat filter)
    usedIds = [];
    pool = eligible(events());
  }
  pending = pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
  return pending;
}

export function getPendingDecision(): DecisionEvent | null {
  return pending;
}

/** Commit a choice on the pending decision: applies reputation + queues the
 *  multi-day effects, marks the event used, clears pending. The instant
 *  oilDelta is NOT applied here — GameScene owns the price (see EV.DECISION). */
export function chooseDecision(optionIdx: number): DecisionOption | null {
  if (!pending) return null;
  const opt = pending.options[optionIdx];
  if (!opt) return null;
  usedIds.push(pending.id);
  pending = null;
  reputation = Math.max(-100, Math.min(100, reputation + opt.repDelta));
  for (const ef of opt.effects) active.push({ ...ef, remaining: ef.days });
  return opt;
}

/** Age all active effects by one day — call at each endDay, BEFORE rolling
 *  the next decision (so a 1-day effect covers exactly the day it bought). */
export function tickDecisionDay(): void {
  for (const ef of active) ef.remaining--;
  active = active.filter(ef => ef.remaining > 0);
}

/** Combined multiplier for a stat: product of all active effects, plus the
 *  permanent reputation floor (sustained aggression keeps spawn pressure
 *  high; sustained groveling taxes income). */
export function decisionMult(stat: DecisionStat): number {
  const d = TUNING.decisions;
  let m = 1;
  for (const ef of active) if (ef.stat === stat) m *= ef.mult;
  if (stat === 'enemyRate' && reputation >= d.repAggroThreshold) m *= d.repAggroRateMult;
  if (stat === 'credits' && reputation <= d.repTaxThreshold) m *= d.repTaxCreditsMult;
  return m;
}
