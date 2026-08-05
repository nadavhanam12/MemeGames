// Typed client for the Meme Games leaderboard server (see /docs contract).
// Game-agnostic: no Phaser, no game state — reusable across MemeGames titles.
//
// Endpoints:
//   POST /api/token        -> single-use score token, IP-bound, min-age 60s
//   POST /api/score        -> submit { token, name, email, score }
//   GET  /api/leaderboard  -> paginated public rows, optional myRanking via token

export interface TokenResponse {
  token: string;
  minAgeSeconds: number;
  expiresAt: string; // ISO timestamp
}

export interface ScoreRequest {
  token: string;
  name: string;
  email: string;
  score: number;
}

export interface ScoreResponse {
  accepted: boolean;
  saved: boolean;
  previousBest: number | null;
  newBest: number;
}

export type LeaderboardPeriod = 'daily' | 'weekly' | 'monthly' | 'all';

export interface LeaderboardEntry {
  rank: number;
  name: string;
  score: number;
  achievedAt: string;
}

export interface LeaderboardResponse {
  period: LeaderboardPeriod;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  entries: LeaderboardEntry[];
  myRanking?: LeaderboardEntry;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number | null, // null = network failure / timeout
    public readonly body?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const DEFAULT_TIMEOUT_MS = 8000;

let baseUrl: string = (import.meta.env.VITE_API_BASE as string | undefined) ?? 'http://localhost:3151';

/** Override the server base URL (e.g. per-environment) at boot. */
export function configureApi(opts: { baseUrl: string }): void {
  baseUrl = opts.baseUrl.replace(/\/$/, '');
}

export function getApiBase(): string {
  return baseUrl;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DEFAULT_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, { ...init, signal: ctrl.signal });
  } catch (e) {
    throw new ApiError(`Network error calling ${path}: ${String(e)}`, null);
  } finally {
    clearTimeout(timer);
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }
  if (!res.ok) {
    throw new ApiError(`API ${path} failed with status ${res.status}`, res.status, body);
  }
  return body as T;
}

export function createToken(): Promise<TokenResponse> {
  return request<TokenResponse>('/api/token', { method: 'POST' });
}

export function submitScore(payload: ScoreRequest): Promise<ScoreResponse> {
  return request<ScoreResponse>('/api/score', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

export function fetchLeaderboard(opts: {
  period?: LeaderboardPeriod;
  page?: number;
  pageSize?: number;
  token?: string;
} = {}): Promise<LeaderboardResponse> {
  const params = new URLSearchParams();
  if (opts.period) params.set('period', opts.period);
  if (opts.page) params.set('page', String(opts.page));
  if (opts.pageSize) params.set('pageSize', String(opts.pageSize));
  if (opts.token) params.set('token', opts.token);
  const qs = params.toString();
  return request<LeaderboardResponse>(`/api/leaderboard${qs ? `?${qs}` : ''}`);
}
