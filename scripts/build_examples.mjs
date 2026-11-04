#!/usr/bin/env node
/**
 * Find one clear example of each technique (R1-R5) for the Techniques
 * notebook, by solving generated boards and catching the moment each rank is
 * the simplest step available. Small boards and hints that cross out few
 * cells are preferred, because they are easiest to read.
 *
 * Output: levels/examples.json
 *   { "<rank>": { n, m, marks, hint } }
 *   marks is one string per row: "." empty, "x" cross, "c" cat.
 *
 * Usage: node scripts/build_examples.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { emptyMarks, findHint, isSolved, CAT, CROSS } from '../js/engine.js';
import { generateLevel } from '../js/generator.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const B36 = '0123456789abcdefghijklmnopqrstuvwxyz';

/** Boards to search, per rank: small sizes first. */
const SEARCH = {
  1: { sizes: [5], options: { maxRank: 2 } },
  2: { sizes: [5, 6], options: { maxRank: 2, minRank: 2 } },
  3: { sizes: [6, 7], options: { maxRank: 3, minRank: 3 } },
  4: { sizes: [6, 7], options: { maxRank: 4, minRank: 4 } },
  5: { sizes: [7, 8], options: { maxRank: 5, minRank: 5, chainLength: 2 } },
};
const SEEDS_PER_SIZE = 40;

/** Lower is easier to read: small board, few crossed cells, short chain. */
function clarity(n, hint) {
  const excluded = hint.exclude?.length ?? 0;
  const chain = hint.highlight?.chain?.length ?? 0;
  return n * 10 + excluded * 2 + chain * 3;
}

function encodeMarks(marks) {
  return marks.map((row) => row.map((m) => (m === CAT ? 'c' : m === CROSS ? 'x' : '.')).join(''));
}

function findExample(rank) {
  const { sizes, options } = SEARCH[rank];
  let best = null;
  for (const n of sizes) {
    for (let seed = 1; seed <= SEEDS_PER_SIZE; seed++) {
      const level = generateLevel(n, seed * 31 + rank, options);
      if (!level) continue;
      const marks = emptyMarks(n);
      for (let step = 0; step < n * n && !isSolved(level, marks); step++) {
        const hint = findHint(level, marks, { maxRank: 5, chainLength: 2 });
        if (!hint) break;
        // Skip the opening move of a board: it shows the rule on an empty
        // grid, which says less than a board with some progress on it.
        if (hint.rank === rank && step > 0) {
          const score = clarity(n, hint);
          if (!best || score < best.score) {
            best = {
              score,
              example: {
                n,
                m: level.regions.map((row) => row.map((v) => B36[v]).join('')),
                marks: encodeMarks(marks),
                hint,
              },
            };
          }
          break;
        }
        if (hint.kind === 'place') marks[hint.r][hint.c] = CAT;
        else for (const [r, c] of hint.exclude) marks[r][c] = CROSS;
      }
    }
  }
  return best?.example ?? null;
}

const examples = {};
for (const rank of [1, 2, 3, 4, 5]) {
  examples[rank] = findExample(rank);
  console.log(`R${rank}: ${examples[rank] ? `${examples[rank].n}x${examples[rank].n}` : 'none found'}`);
}
fs.writeFileSync(path.join(ROOT, 'levels/examples.json'), JSON.stringify(examples));
console.log('wrote levels/examples.json');
