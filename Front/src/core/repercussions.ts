// Tabloid-style "global repercussions" headlines shown at day-end and game
// over: a big bizarre/humorous title picked from the day's (or run's) oil
// price swing and how well the player did, with the real numbers underneath
// as a small subhead. Pure flavor text — no gameplay effect.

export type PriceBucket = 'crash' | 'down' | 'flat' | 'up' | 'spike';
export type PerfBucket = 'rough' | 'mixed' | 'strong';

const PRICE_BUCKET_THRESHOLDS: { max: number; bucket: PriceBucket }[] = [
  { max: -15, bucket: 'crash' },
  { max: -4, bucket: 'down' },
  { max: 3, bucket: 'flat' },
  { max: 14, bucket: 'up' },
  { max: Infinity, bucket: 'spike' }
];

export function priceBucket(delta: number): PriceBucket {
  for (const t of PRICE_BUCKET_THRESHOLDS) if (delta <= t.max) return t.bucket;
  return 'spike';
}

export function perfBucket(score: number): PerfBucket {
  if (score >= 0.75) return 'strong';
  if (score >= 0.4) return 'mixed';
  return 'rough';
}

const HEADLINES: Record<PriceBucket, Record<PerfBucket, string>> = {
  crash: {
    strong: 'Local Milkman Refuses To Be Undercut By Oil Again',
    mixed: 'Oil Now Cheaper Than Milk, Also Cheaper Than Your Tankers',
    rough: 'Oil So Cheap Even The Pirates Feel Bad Taking It'
  },
  down: {
    strong: 'Gas Stations Report Mild, Confusing Sense Of Relief',
    mixed: 'Oil Prices Dip Slightly, Nobody Really Notices',
    rough: 'Oil Prices Dip While Everything Else Catches Fire'
  },
  flat: {
    strong: 'Oil Markets Yawn, So Does Everyone Else',
    mixed: 'Nothing Happened Today, Historians Unimpressed',
    rough: "Markets Flat, Captain's Confidence Flatter"
  },
  up: {
    strong: 'Hero Tanker Captain Single-Handedly Ruins Your Commute',
    mixed: 'Oil Prices Creep Up, So Does National Anxiety',
    rough: 'Oil Prices Rise, Just Like The Insurance Premiums On You'
  },
  spike: {
    strong: 'You Saved The Strait, Gas Stations Still Somehow Win',
    mixed: 'Oil Prices Through The Roof, Landlord Raises Rent In Solidarity',
    rough: 'Oil Prices Skyrocket, Blame Assigned Almost Entirely To You'
  }
};

export function repercussionHeadline(priceDelta: number, perfScore: number): string {
  return HEADLINES[priceBucket(priceDelta)][perfBucket(perfScore)];
}

/** 0..1 "how well did the day go" score — mission success + tanker safe ratio.
 *  Mirrors the roll UIScene already used for the next day's share-count growth. */
export function dayPerfScore(missionDone: boolean, safe: number, lost: number): number {
  const safeRatio = safe + lost > 0 ? safe / (safe + lost) : 1;
  return (missionDone ? 0.5 : 0) + safeRatio * 0.5;
}

/** Same idea over the whole run: completed-mission ratio + tanker safe ratio. */
export function runPerfScore(stats: {
  missionsCompleted: number;
  daysSurvived: number;
  tankersSafe: number;
  tankersLost: number;
}): number {
  const safeRatio =
    stats.tankersSafe + stats.tankersLost > 0 ? stats.tankersSafe / (stats.tankersSafe + stats.tankersLost) : 1;
  const missionRatio = stats.daysSurvived > 0 ? Math.min(1, stats.missionsCompleted / stats.daysSurvived) : 0;
  return missionRatio * 0.5 + safeRatio * 0.5;
}

/** "DAY 4 · OIL $61 (+18%) · 5 SAFE / 1 LOST" style data line for under the headline. */
export function repercussionSubhead(opts: {
  label: string; // e.g. "DAY 4" or "FINAL"
  price: number;
  priceDelta: number;
  priceBefore: number; // price - priceDelta, to compute a % change
  safe: number;
  lost: number;
}): string {
  const { label, price, priceDelta, priceBefore, safe, lost } = opts;
  const pct = priceBefore > 0 ? Math.round((priceDelta / priceBefore) * 100) : 0;
  const sign = priceDelta >= 0 ? '+' : '−';
  const pctSign = pct >= 0 ? '+' : '−';
  return `${label} · OIL $${price} (${sign}$${Math.abs(priceDelta)} / ${pctSign}${Math.abs(pct)}%) · ${safe} SAFE / ${lost} LOST`;
}
