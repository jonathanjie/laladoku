/**
 * Engine and generator checks on freshly generated boards.
 *
 *   node test/engine.test.mjs
 */
import {
  countSolutions, isSolved, emptyMarks, candidateGrid, findHint, solveByDeduction,
  CAT, CROSS, EMPTY,
} from '../js/engine.js';
import { generateLevel, placeCats, createRandom } from '../js/generator.js';

let failures = 0;
const check = (ok, message) => {
  if (!ok) { failures++; console.log(`  FAIL ${message}`); }
};

/* A small fixed set of generated boards, one tier per entry. */
const SPECS = [
  { n: 5, maxRank: 2 }, { n: 6, maxRank: 2 }, { n: 7, maxRank: 3 },
  { n: 7, maxRank: 4, minRank: 4 }, { n: 8, maxRank: 4, minRank: 4 },
  { n: 9, maxRank: 5, minRank: 5, chainLength: 2 },
];
const boards = [];
for (const spec of SPECS) {
  for (let seed = 1; seed <= 4; seed++) {
    const level = generateLevel(spec.n, seed * 9973 + spec.n, spec);
    if (level) boards.push({ level, spec });
  }
}
console.log(`generated ${boards.length} boards`);
check(boards.length >= SPECS.length * 3, 'generator failed on too many fixed seeds');

/* 1. Same seed, same board. */
{
  const a = generateLevel(7, 4242, { maxRank: 4 });
  const b = generateLevel(7, 4242, { maxRank: 4 });
  check(JSON.stringify(a.regions) === JSON.stringify(b.regions), 'generator is not deterministic');
}

/* 2. Cat layouts follow the rules for every size that has one. */
{
  const random = createRandom(7);
  for (let n = 4; n <= 10; n++) {
    for (let i = 0; i < 20; i++) {
      const cats = placeCats(n, random);
      const board = { n, regions: Array.from({ length: n }, (_, r) => new Array(n).fill(r)) };
      const marks = emptyMarks(n);
      cats.forEach((c, r) => { marks[r][c] = CAT; });
      // One region per row makes the region rule match the row rule.
      check(isSolved(board, marks), `placeCats broke a rule at n=${n}`);
    }
  }
  check(placeCats(3, createRandom(1)) === null, 'placeCats found an impossible 3x3 layout');
}

/* 3. Every generated board has exactly one solution, found by brute force. */
for (const { level } of boards) {
  check(countSolutions(level, 2) === 1, `seed ${level.seed} is not unique`);
}

/* 4. The ladder solves each board within its tier and needs the tier's floor. */
for (const { level, spec } of boards) {
  const result = solveByDeduction(level, spec);
  check(result.solved, `seed ${level.seed} not solvable within rank ${spec.maxRank}`);
  check(result.hardestRank <= spec.maxRank, `seed ${level.seed} used rank ${result.hardestRank}`);
  check(result.hardestRank >= (spec.minRank ?? 1), `seed ${level.seed} is easier than its tier`);
  const marks = emptyMarks(level.n);
  level.solution.forEach((c, r) => { marks[r][c] = CAT; });
  check(isSolved(level, marks), `seed ${level.seed} stored solution is invalid`);
}

/* 5. Hints never exclude a solution cell or place a cat off the solution. */
for (const { level, spec } of boards) {
  const marks = emptyMarks(level.n);
  for (let step = 0; step < level.n * level.n && !isSolved(level, marks); step++) {
    const hint = findHint(level, marks, spec);
    if (!hint) break;
    if (hint.kind === 'place') {
      check(level.solution[hint.r] === hint.c, `hint placed a wrong cat (seed ${level.seed})`);
      marks[hint.r][hint.c] = CAT;
    } else {
      for (const [r, c] of hint.exclude) {
        check(level.solution[r] !== c, `hint excluded the answer (seed ${level.seed})`);
        marks[r][c] = CROSS;
      }
    }
  }
}

/* 6. candidateGrid never offers a cell that breaks a rule. */
for (const { level } of boards) {
  const { n } = level;
  const marks = emptyMarks(n);
  marks[0][level.solution[0]] = CAT;
  marks[2][level.solution[2]] = CAT;
  const grid = candidateGrid(level, marks);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!grid[r][c]) continue;
      check(marks[r][c] === EMPTY, 'candidate on a marked cell');
      for (const [cr, cc] of [[0, level.solution[0]], [2, level.solution[2]]]) {
        const touches = Math.abs(cr - r) <= 1 && Math.abs(cc - c) <= 1;
        const shares = cr === r || cc === c || level.regions[cr][cc] === level.regions[r][c];
        check(!touches && !shares, 'candidate conflicts with a placed cat');
      }
    }
  }
}

/* 7. A longer chain never makes a board unsolvable that a shorter one solves. */
for (const { level, spec } of boards.filter((b) => b.spec.maxRank === 5)) {
  const longer = solveByDeduction(level, { maxRank: 5, chainLength: spec.chainLength + 3 });
  check(longer.solved, `longer chains broke seed ${level.seed}`);
}

console.log(failures ? `\n${failures} check(s) failed` : 'all engine checks passed');
process.exit(failures ? 1 : 0);
