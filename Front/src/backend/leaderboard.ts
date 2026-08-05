// LeaderboardService — orchestrates the token lifecycle and score submission
// on top of the raw api.ts client. Game-agnostic; pass a storage key per game
// so saved identity/best-token don't collide between MemeGames titles.
//
// Token rules the service enforces for you:
//  - Tokens must be >= minAgeSeconds (60) old when the score is submitted, so
//    call beginRun() when gameplay starts — by the time the run ends and the
//    player fills the submit form, the token is old enough. If it isn't yet,
//    submit() transparently waits out the remainder.
//  - Tokens are single-use and expire; submit() fetches a fresh one when the
//    prefetched token was consumed, expired, or never arrived (and then waits
//    the min age before sending).

import {
  ApiError,
  LeaderboardPeriod,
  LeaderboardResponse,
  ScoreResponse,
  createToken,
  fetchLeaderboard,
  submitScore
} from './api';

export interface PlayerIdentity {
  name: string;
  email: string;
}

interface HeldToken {
  token: string;
  minAgeSeconds: number;
  expiresAt: number; // epoch ms
  issuedAt: number; // epoch ms, client clock
}

interface StoredState {
  identity?: PlayerIdentity;
  bestToken?: string; // token of the saved best score — unlocks myRanking on GET
  bestScore?: number;
}

const MIN_AGE_BUFFER_MS = 1500; // client/server clock slack on the 60s check

export class LeaderboardService {
  private held: HeldToken | null = null;
  private pending: Promise<void> | null = null;
  private state: StoredState = {};

  constructor(private readonly storageKey: string) {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) this.state = JSON.parse(raw);
    } catch {
      /* corrupted or unavailable storage — start fresh */
    }
  }

  // ------------------------------------------------------------ token lifecycle

  /** Fire-and-forget: call when a run starts so the token ages during play. */
  beginRun(): void {
    this.held = null;
    this.pending = this.acquire().catch(() => {
      // Offline or server down — submit() will retry; gameplay is unaffected.
      this.pending = null;
    });
  }

  private async acquire(): Promise<void> {
    const res = await createToken();
    this.held = {
      token: res.token,
      minAgeSeconds: res.minAgeSeconds,
      expiresAt: Date.parse(res.expiresAt),
      issuedAt: Date.now()
    };
  }

  private tokenUsable(t: HeldToken | null): t is HeldToken {
    return !!t && Date.now() < t.expiresAt - 5000;
  }

  // ------------------------------------------------------------ identity

  getIdentity(): PlayerIdentity | null {
    return this.state.identity ?? null;
  }

  saveIdentity(identity: PlayerIdentity): void {
    this.state.identity = identity;
    this.persist();
  }

  getBestScore(): number | null {
    return this.state.bestScore ?? null;
  }

  private persist(): void {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.state));
    } catch {
      /* storage unavailable — non-fatal */
    }
  }

  // ------------------------------------------------------------ submit

  /**
   * Submit a score. Handles token acquisition and the 60s min-age wait.
   * `onStatus` receives short progress strings for the UI.
   */
  async submit(
    score: number,
    identity: PlayerIdentity,
    onStatus?: (msg: string) => void
  ): Promise<ScoreResponse> {
    this.saveIdentity(identity);

    // Wait for the prefetch kicked off by beginRun(), if still in flight.
    if (this.pending) {
      onStatus?.('CONNECTING…');
      await this.pending.catch(() => undefined);
      this.pending = null;
    }
    if (!this.tokenUsable(this.held)) {
      onStatus?.('CONNECTING…');
      await this.acquire(); // throws ApiError if the server is unreachable
    }
    const held = this.held!;

    const readyAt = held.issuedAt + held.minAgeSeconds * 1000 + MIN_AGE_BUFFER_MS;
    const wait = readyAt - Date.now();
    if (wait > 0) {
      onStatus?.(`VERIFYING… ${Math.ceil(wait / 1000)}s`);
      await new Promise<void>(resolve => {
        const tick = setInterval(() => {
          const left = readyAt - Date.now();
          if (left <= 0) {
            clearInterval(tick);
            resolve();
          } else {
            onStatus?.(`VERIFYING… ${Math.ceil(left / 1000)}s`);
          }
        }, 500);
      });
    }

    onStatus?.('SENDING…');
    const res = await submitScore({ token: held.token, name: identity.name, email: identity.email, score });
    this.held = null; // single-use

    if (res.accepted && res.saved) {
      // This token now backs the saved best — keep it for myRanking lookups.
      this.state.bestToken = held.token;
      this.state.bestScore = res.newBest;
      this.persist();
    }
    return res;
  }

  // ------------------------------------------------------------ leaderboard

  /** Fetch a leaderboard page; includes myRanking when a saved best exists. */
  getLeaderboard(period: LeaderboardPeriod, page = 1, pageSize = 25): Promise<LeaderboardResponse> {
    return fetchLeaderboard({ period, page, pageSize, token: this.state.bestToken });
  }
}

export { ApiError };

// Shared instance for this game. Next games: new LeaderboardService('<game>-leaderboard-v1').
export const leaderboard = new LeaderboardService('hormuz-leaderboard-v1');
