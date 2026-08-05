# Meme Games Leaderboard Server

Minimal Bun API and UI for game tokens and leaderboard storage. It uses Bun's built-in SQLite driver with WAL mode, so there are no runtime package dependencies.

## Run

```bash
bun run start
```

The server starts on the first available port at or after `PORT_START` (`3151` by default).

With PM2:

```bash
bun run pm2:start
```

This repo uses `PM2_HOME=.pm2` in package scripts so PM2 state stays inside the project directory.

## API Contract

### `POST /api/token`

Creates a single-use score token and binds it to the requester IP.

Response:

```json
{
  "token": "64-char-hex-token",
  "minAgeSeconds": 60,
  "expiresAt": "2026-08-04T13:00:00.000Z"
}
```

Abuse handling:

- More than `20` tokens from one IP in `5` minutes, or more than `100` in `24` hours, shadow-bans the IP for `24` hours.
- Shadow-banned clients still receive tokens, but later score writes are accepted without affecting the public leaderboard.

### `POST /api/score`

Saves a score after the token is at least 60 seconds old.

Request:

```json
{
  "token": "64-char-hex-token",
  "name": "Player name",
  "email": "player@example.com",
  "score": 12345
}
```

Response for a new or improved best:

```json
{
  "accepted": true,
  "saved": true,
  "previousBest": 10000,
  "newBest": 12345
}
```

Rules:

- The token must be created by the same IP submitting the score.
- The token must be at least 60 seconds old and not expired.
- Tokens are single-use.
- The server trusts the submitted score value.
- Email is normalized and SHA-256 hashed before storage.
- Only one public high score is kept per email.
- If a user submits a higher score, the previous public score is moved to `archived_high_scores`, which is not exposed through any API.
- Lower or equal scores are accepted but do not replace the user's public best.

### `GET /api/leaderboard`

Fetches public leaderboard rows. Emails are never returned by GET APIs.

Query parameters:

- `period`: `daily`, `weekly`, `monthly`, or `all`. Default: `daily`.
- `page`: 1-based page number. Default: `1`.
- `pageSize`: max `100`. Default: `25`.
- `token`: optional token from the user's saved best score. When present, `myRanking` is included even if that rank is outside the requested page.

Example:

```text
GET /api/leaderboard?period=weekly&page=1&pageSize=25&token=...
```

Response:

```json
{
  "period": "weekly",
  "page": 1,
  "pageSize": 25,
  "total": 1000,
  "totalPages": 40,
  "entries": [
    {
      "rank": 1,
      "name": "AAA",
      "score": 99999,
      "achievedAt": "2026-08-04T12:00:00.000Z"
    }
  ],
  "myRanking": {
    "rank": 83,
    "name": "Me",
    "score": 12345,
    "achievedAt": "2026-08-04T12:10:00.000Z"
  }
}
```

## Storage

SQLite tables:

- `tokens`: token, requester IP, issue/use timestamps, shadow flag.
- `token_events`: token creation audit data for rate checks.
- `shadow_bans`: active shadow bans by IP.
- `current_high_scores`: public best score per email hash.
- `archived_high_scores`: previous public best scores replaced by later higher scores.

## Operational Notes

- Intended load of roughly 10k score writes/day and 100k leaderboard reads/day is small for SQLite WAL on a single Bun process.
- For heavy read bursts, put a CDN or reverse proxy cache in front of `GET /api/leaderboard` by period/page for a short TTL. The server currently sends `no-store` to keep ranking freshness simple.
- If running behind a proxy, forward `X-Forwarded-For` or `X-Real-IP`; token IP binding uses those headers before falling back to localhost.