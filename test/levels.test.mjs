/**
 * Checks every level in the shipped bank (levels/).
 *
 *   node test/levels.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  decodeLevel, countSolutions, isSolved, emptyMarks, solveByDeduction, CAT,
} from '../js/engine.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const readJSON = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

const index = readJSON('levels/index.json');
const records = index.chunks.flatMap((ch) => readJSON(ch.file).levels);

let failures = 0;
const check = (ok, message) => {
  if (!ok) { failures++; if (failures <= 20) console.log(`  FAIL ${message}`); }
};

check(records.length === index.total, 'index total does not match the chunks');
check(
  index.chapters.reduce((a, ch) => a + ch.count, 0) === index.total,
  'chapter counts do not add up to the total',
);

const isContiguous = (regions, n) => {
  for (let id = 0; id < n; id++) {
    const cells = [];
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (regions[r][c] === id) cells.push([r, c]);
    if (!cells.length) return false;
    const seen = new Set([cells[0].join()]);
    const stack = [cells[0]];
    while (stack.length) {
      const [r, c] = stack.pop();
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const rr = r + dr, cc = c + dc;
        if (rr < 0 || rr >= n || cc < 0 || cc >= n || regions[rr][cc] !== id) continue;
        if (!seen.has(`${rr},${cc}`)) { seen.add(`${rr},${cc}`); stack.push([rr, cc]); }
      }
    }
    if (seen.size !== cells.length) return false;
  }
  return true;
};

const signatures = new Set();
const rankTally = {};
for (const chapter of index.chapters) {
  for (let i = chapter.start; i < chapter.start + chapter.count; i++) {
    const rec = records[i];
    const board = decodeLevel(rec);
    const where = `level ${i + 1} (${chapter.name})`;

    check(board.n === chapter.size, `${where} has the wrong size`);
    check(isContiguous(board.regions, board.n), `${where} has a split region`);

    const marks = emptyMarks(board.n);
    board.solution.forEach((c, r) => { marks[r][c] = CAT; });
    check(isSolved(board, marks), `${where} stored solution is invalid`);
    check(countSolutions(board, 2) === 1, `${where} does not have exactly one solution`);

    const result = solveByDeduction(board, { maxRank: rec.r, chainLength: rec.c });
    check(result.solved, `${where} cannot be solved by logic within rank ${rec.r}`);
    check(result.hardestRank === rec.r, `${where} rank metadata is wrong`);
    check(rec.r <= chapter.maxRank, `${where} is harder than its chapter allows`);

    const signature = rec.m.join('/');
    check(!signatures.has(signature), `${where} is a duplicate`);
    signatures.add(signature);
    rankTally[rec.r] = (rankTally[rec.r] || 0) + 1;
  }
}

console.log(`${records.length} levels checked; hardest rank needed: ${JSON.stringify(rankTally)}`);
console.log(failures ? `\n${failures} check(s) failed` : 'all level checks passed');
process.exit(failures ? 1 : 0);
