/**
 * Quick Play: generates a fresh board off the main thread so the page stays
 * responsive while the generator searches.
 *
 * Message in:  { id, size, tier, seed }
 * Message out: { id, level } or { id, error }
 */
import { generateLevel } from './generator.js';

/** Generator settings per Quick Play difficulty. */
const TIERS = {
  easy: { maxRank: 2, minRank: 1, hardenMoves: 0 },
  medium: { maxRank: 3, minRank: 2, hardenMoves: 60 },
  hard: { maxRank: 4, minRank: 4, hardenMoves: 150 },
};

self.onmessage = ({ data }) => {
  const { id, size, tier, seed } = data;
  const options = TIERS[tier] || TIERS.medium;
  // A seed can fail; walk forward to the next one. Each seed is cheap at
  // Quick Play sizes, so a handful of tries is plenty.
  for (let attempt = 0; attempt < 12; attempt++) {
    const level = generateLevel(size, (seed + attempt * 7919) >>> 0, options);
    if (level) {
      self.postMessage({
        id,
        level: { ...level, rank: level.hardestRank, chainLength: 2, difficulty: level.score },
      });
      return;
    }
  }
  self.postMessage({ id, error: 'Could not make a board this time.' });
};
