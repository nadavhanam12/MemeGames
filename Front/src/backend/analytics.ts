// Lightweight fire-and-forget analytics client — posts a small, curated set of
// in-game events to the leaderboard server's /api/event endpoint (see
// docs/backend-contract.md). Game-agnostic; pass a gameId per title so
// events don't collide across MemeGames titles. Best-effort: a failed or slow
// send must never affect gameplay, so calls are not awaited by callers.

import { getApiBase } from './api';

// crypto.randomUUID() only exists in secure contexts (https / localhost);
// over plain http on a LAN IP it's undefined. Analytics run IDs don't need
// cryptographic strength, so fall back to Math.random.
function makeRunId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const hex = () => Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0');
  return `${hex()}${hex()}-${hex()}-${hex()}-${hex()}-${hex()}${hex()}${hex()}`;
}

export class AnalyticsService {
  private runId: string | null = null;

  constructor(private readonly gameId: string) {}

  /** Call once per run start; generates the runId later events are grouped under. */
  startRun(): void {
    this.runId = makeRunId();
    this.track('run_start');
  }

  track(event: string, payload: Record<string, unknown> = {}): void {
    const body = JSON.stringify({
      game: this.gameId,
      event,
      runId: this.runId,
      payload,
      clientTs: new Date().toISOString()
    });
    fetch(`${getApiBase()}/api/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true
    }).catch(() => {
      // analytics is best-effort — never surface failures to the player
    });
  }
}

// Shared instance for this game. Next games: new AnalyticsService('<game>').
export const analytics = new AnalyticsService('hormuz');
