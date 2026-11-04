/**
 * Laladoku rules engine.
 *
 * Board model
 *   - `n` is the board size (4..10).
 *   - `regions[r][c]` is a region id in 0..n-1; every region is one contiguous
 *     colour area and every region holds exactly one cat.
 *   - `solution[r]` is the column of the cat in row `r`.
 *
 * The four rules, in the order the tutorial teaches them:
 *   1. one cat per row
 *   2. one cat per column
 *   3. one cat per colour region
 *   4. cats never touch, not even diagonally
 */

export const EMPTY = 0;
export const CAT = 1;
export const CROSS = 2;
/**
 * A "maybe Lala here" note the player pencils in. It is only a reminder:
 * every rule and deduction treats it exactly like an empty cell.
 */
export const MAYBE = 3;
/**
 * A cross left by a wrong cat. It is locked: the player cannot change it,
 * and every rule treats it exactly like a cross.
 */
export const WRONG = 4;

/** Is this cell still open as far as the rules are concerned? */
export function isOpenMark(mark) {
  return mark === EMPTY || mark === MAYBE;
}

/** Decode one level record from levels/chunk-*.json (see scripts/build_levels.mjs). */
export function decodeLevel(rec) {
  const n = rec.n;
  const regions = rec.m.map((row) => Array.from(row, (ch) => parseInt(ch, 36)));
  const solution = Array.from(rec.s, (ch) => parseInt(ch, 36));
  return {
    n,
    regions,
    solution,
    difficulty: rec.d,
    rank: rec.r,
    chainLength: rec.c || DEFAULT_CHAIN_LENGTH,
    steps: rec.st,
  };
}

/** A fresh, empty mark grid: EMPTY / CAT / CROSS per cell. */
export function emptyMarks(n) {
  return Array.from({ length: n }, () => new Array(n).fill(EMPTY));
}

/**
 * Region lookup tables, recomputed once per board.
 * `regionCells[id]` is the list of [r,c] in that region, which the hint
 * engine needs constantly.
 */
export function regionIndex(board) {
  const { n, regions } = board;
  const cells = Array.from({ length: n }, () => []);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) cells[regions[r][c]].push([r, c]);
  }
  return cells;
}

/** Does placing a cat at (r,c) conflict with a cat already on the board? */
export function conflicts(marks, r, c) {
  const n = marks.length;
  for (let i = 0; i < n; i++) {
    if (i !== r && marks[i][c] === CAT) return true;
    if (i !== c && marks[r][i] === CAT) return true;
  }
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const rr = r + dr, cc = c + dc;
      if (rr >= 0 && rr < n && cc >= 0 && cc < n && marks[rr][cc] === CAT) return true;
    }
  }
  return false;
}

/** Full validation of a finished board against the four rules. */
export function isSolved(board, marks) {
  const { n, regions } = board;
  const cols = new Set();
  const regs = new Set();
  for (let r = 0; r < n; r++) {
    let count = 0;
    for (let c = 0; c < n; c++) {
      if (marks[r][c] !== CAT) continue;
      count++;
      if (cols.has(c)) return false;
      cols.add(c);
      const reg = regions[r][c];
      if (regs.has(reg)) return false;
      regs.add(reg);
    }
    if (count !== 1) return false;
  }
  // adjacency
  const cats = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) if (marks[r][c] === CAT) cats.push([r, c]);
  }
  for (let i = 0; i < cats.length; i++) {
    for (let j = i + 1; j < cats.length; j++) {
      if (Math.abs(cats[i][0] - cats[j][0]) <= 1 && Math.abs(cats[i][1] - cats[j][1]) <= 1) {
        return false;
      }
    }
  }
  return cats.length === n;
}

/**
 * Count solutions, stopping at `limit`. Used to prove a generated board is
 * unique.
 */
export function countSolutions(board, limit = 2) {
  const { n, regions } = board;
  const placed = [];
  const usedCols = new Set();
  const usedRegions = new Set();
  let found = 0;

  const fits = (r, c) => {
    if (usedCols.has(c) || usedRegions.has(regions[r][c])) return false;
    for (const [pr, pc] of placed) {
      if (Math.abs(pr - r) <= 1 && Math.abs(pc - c) <= 1) return false;
    }
    return true;
  };

  const walk = (r) => {
    if (found >= limit) return;
    if (r === n) { found++; return; }
    for (let c = 0; c < n; c++) {
      if (!fits(r, c)) continue;
      placed.push([r, c]);
      usedCols.add(c);
      usedRegions.add(regions[r][c]);
      walk(r + 1);
      placed.pop();
      usedCols.delete(c);
      usedRegions.delete(regions[r][c]);
      if (found >= limit) return;
    }
  };

  walk(0);
  return found;
}

/* ------------------------------------------------------------------ *
 * Candidate grid
 * ------------------------------------------------------------------ */

/**
 * Which cells can still legally hold a cat, given the current marks.
 * A cell is a candidate when it is not crossed, its row/column/region has no
 * cat yet, and it does not touch an existing cat.
 */
export function candidateGrid(board, marks) {
  const { n, regions } = board;
  const rowCat = new Array(n).fill(-1);
  const colCat = new Array(n).fill(-1);
  const regCat = new Array(n).fill(-1);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (marks[r][c] === CAT) {
        rowCat[r] = c;
        colCat[c] = r;
        regCat[regions[r][c]] = r;
      }
    }
  }

  const grid = Array.from({ length: n }, () => new Array(n).fill(false));
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!isOpenMark(marks[r][c])) continue;
      if (rowCat[r] >= 0 || colCat[c] >= 0) continue;
      if (regCat[regions[r][c]] >= 0) continue;
      let touching = false;
      for (let dr = -1; dr <= 1 && !touching; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const rr = r + dr, cc = c + dc;
          if (rr >= 0 && rr < n && cc >= 0 && cc < n && marks[rr][cc] === CAT) {
            touching = true;
            break;
          }
        }
      }
      if (!touching) grid[r][c] = true;
    }
  }
  return grid;
}

/* ------------------------------------------------------------------ *
 * Hint engine
 *
 * A ladder of deductions from simplest to hardest. Each hint names the rank
 * it belongs to so the UI can describe *why* the move holds.
 *
 *   R1  a unit (row / column / region) has exactly one candidate left
 *   R2  a region's candidates all sit in one row/column ("region in line"),
 *       or a line's candidates all belong to one region ("line in region")
 *   R3  set locking: k regions confined to k lines, so those lines belong to
 *       those regions
 *   R4  direct contradiction: a cat here would, by itself, cover every open
 *       cell of another row, column or region
 *   R5  chain: a test cat here forces up to `chainLength` more cats, and
 *       then some unit has nowhere to go. The chain length is bounded, so
 *       a level never needs open-ended trial and error.
 * ------------------------------------------------------------------ */

const RANK_NAMES = {
  1: 'Only one spot left',
  2: 'Region locked to a line',
  3: 'Set locking',
  4: 'Blocked',
  5: 'Chain reaction',
};

function unitOf(grid, n, cells) {
  return cells.filter(([r, c]) => grid[r][c]);
}

/**
 * R1: find a unit with exactly one remaining candidate.
 * Returns { r, c, rank: 1, unit: 'row'|'col'|'region', index } or null.
 */
function findR1(board, marks, grid) {
  const { n, regions } = board;

  for (let r = 0; r < n; r++) {
    if (marks[r].includes(CAT)) continue;
    const open = [];
    for (let c = 0; c < n; c++) if (grid[r][c]) open.push(c);
    if (open.length === 1) return { r, c: open[0], rank: 1, unit: 'row', index: r };
  }

  for (let c = 0; c < n; c++) {
    let hasCat = false;
    for (let r = 0; r < n; r++) if (marks[r][c] === CAT) hasCat = true;
    if (hasCat) continue;
    const open = [];
    for (let r = 0; r < n; r++) if (grid[r][c]) open.push(r);
    if (open.length === 1) return { r: open[0], c, rank: 1, unit: 'col', index: c };
  }

  const regCells = regionIndex(board);
  for (let id = 0; id < n; id++) {
    const cells = regCells[id];
    let hasCat = false;
    for (const [r, c] of cells) if (marks[r][c] === CAT) hasCat = true;
    if (hasCat) continue;
    const open = cells.filter(([r, c]) => grid[r][c]);
    if (open.length === 1) {
      return { r: open[0][0], c: open[0][1], rank: 1, unit: 'region', index: id };
    }
  }
  return null;
}

/**
 * R2: a region whose candidates are all inside a single row or column.
 * Because that region needs exactly one cat, the line's cat is spoken for,
 * so every other cell in that line can be excluded.
 *
 * Returns { rank: 2, exclude: [[r,c],...], region, line, kind } or null.
 */
function findR2(board, marks, grid) {
  const { n, regions } = board;
  const regCells = regionIndex(board);

  for (let id = 0; id < n; id++) {
    const cells = regCells[id];
    if (cells.some(([r, c]) => marks[r][c] === CAT)) continue;
    const open = cells.filter(([r, c]) => grid[r][c]);
    if (open.length < 2) continue;

    const rows = new Set(open.map(([r]) => r));
    if (rows.size === 1) {
      const r = open[0][0];
      const exclude = [];
      for (let c = 0; c < n; c++) {
        if (grid[r][c] && regions[r][c] !== id) exclude.push([r, c]);
      }
      if (exclude.length) return { rank: 2, exclude, region: id, line: r, kind: 'row' };
    }

    const cols = new Set(open.map(([, c]) => c));
    if (cols.size === 1) {
      const c = open[0][1];
      const exclude = [];
      for (let r = 0; r < n; r++) {
        if (grid[r][c] && regions[r][c] !== id) exclude.push([r, c]);
      }
      if (exclude.length) return { rank: 2, exclude, region: id, line: c, kind: 'col' };
    }
  }

  // The mirror case: every candidate in a row/column belongs to one region,
  // so that region's cat sits in this line and its other cells are excluded.
  for (let r = 0; r < n; r++) {
    if (marks[r].includes(CAT)) continue;
    const open = [];
    for (let c = 0; c < n; c++) if (grid[r][c]) open.push([r, c]);
    if (open.length < 2) continue;
    const regs = new Set(open.map(([, c]) => regions[r][c]));
    if (regs.size === 1) {
      const id = [...regs][0];
      const exclude = regCells[id].filter(
        ([rr, cc]) => rr !== r && grid[rr][cc],
      );
      if (exclude.length) return { rank: 2, exclude, region: id, line: r, kind: 'rowToRegion' };
    }
  }

  for (let c = 0; c < n; c++) {
    let hasCat = false;
    for (let r = 0; r < n; r++) if (marks[r][c] === CAT) hasCat = true;
    if (hasCat) continue;
    const open = [];
    for (let r = 0; r < n; r++) if (grid[r][c]) open.push([r, c]);
    if (open.length < 2) continue;
    const regs = new Set(open.map(([r]) => regions[r][c]));
    if (regs.size === 1) {
      const id = [...regs][0];
      const exclude = regCells[id].filter(
        ([rr, cc]) => cc !== c && grid[rr][cc],
      );
      if (exclude.length) return { rank: 2, exclude, region: id, line: c, kind: 'colToRegion' };
    }
  }

  return null;
}

/** Number of set bits in a small (n <= 32) bitmask. */
function bitCount(mask) {
  let count = 0;
  for (let m = mask; m; m &= m - 1) count++;
  return count;
}

/** The line numbers whose bits are set in `mask`, lowest first. */
function bitsOf(mask) {
  const out = [];
  for (let i = 0; mask >> i; i++) if (mask & (1 << i)) out.push(i);
  return out;
}

/**
 * R3: set locking. If k open regions are confined to k lines, those k lines
 * are fully consumed by those regions, so every other cell in those lines can
 * be excluded.
 *
 * Each open region is reduced to a bitmask of the rows (and of the columns)
 * its open cells use. Subsets of regions are searched depth-first; a subset
 * whose rows and columns both span more than the largest allowed set is cut
 * off, because adding regions can only widen it.
 */
const MAX_LOCKED_SET = 6;

function findR3(board, marks, grid) {
  const { n, regions } = board;
  const regCells = regionIndex(board);

  const openRegions = [];
  for (let id = 0; id < n; id++) {
    const cells = regCells[id];
    if (cells.some(([r, c]) => marks[r][c] === CAT)) continue;
    let rowMask = 0, colMask = 0, openCount = 0;
    for (const [r, c] of cells) {
      if (!grid[r][c]) continue;
      rowMask |= 1 << r;
      colMask |= 1 << c;
      openCount++;
    }
    if (openCount) openRegions.push({ id, rowMask, colMask, openCount });
  }

  const maxK = Math.min(MAX_LOCKED_SET, openRegions.length);
  const picked = [];

  const lockedLineHint = (ids, lineMask, kind) => {
    const exclude = [];
    for (const line of bitsOf(lineMask)) {
      for (let i = 0; i < n; i++) {
        const [r, c] = kind === 'row' ? [line, i] : [i, line];
        if (grid[r][c] && !ids.has(regions[r][c])) exclude.push([r, c]);
      }
    }
    if (!exclude.length) return null;
    return { rank: 3, exclude, regions: [...ids], kind, lines: bitsOf(lineMask) };
  };

  const search = (start, rowMask, colMask, openCount) => {
    const k = picked.length;
    if (k >= 2 && openCount > k) {
      const ids = new Set(picked.map((x) => x.id));
      if (bitCount(rowMask) === k) {
        const hint = lockedLineHint(ids, rowMask, 'row');
        if (hint) return hint;
      }
      if (bitCount(colMask) === k) {
        const hint = lockedLineHint(ids, colMask, 'col');
        if (hint) return hint;
      }
    }
    if (k >= maxK) return null;

    for (let i = start; i < openRegions.length; i++) {
      const reg = openRegions[i];
      const rows = rowMask | reg.rowMask;
      const cols = colMask | reg.colMask;
      if (bitCount(rows) > maxK && bitCount(cols) > maxK) continue;
      picked.push(reg);
      const hint = search(i + 1, rows, cols, openCount + reg.openCount);
      picked.pop();
      if (hint) return hint;
    }
    return null;
  };

  return search(0, 0, 0, 0);
}

/**
 * Find a row, column or region that still needs a cat but has no candidate
 * left. Returns { unit: 'row'|'col'|'region', index } or null.
 */
function findStarvedUnit(board, marks, grid) {
  const { n, regions } = board;
  const rowNeedsCat = new Array(n).fill(true);
  const colNeedsCat = new Array(n).fill(true);
  const regionNeedsCat = new Array(n).fill(true);
  const rowHasRoom = new Array(n).fill(false);
  const colHasRoom = new Array(n).fill(false);
  const regionHasRoom = new Array(n).fill(false);

  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const id = regions[r][c];
      if (marks[r][c] === CAT) {
        rowNeedsCat[r] = false;
        colNeedsCat[c] = false;
        regionNeedsCat[id] = false;
      }
      if (grid[r][c]) {
        rowHasRoom[r] = true;
        colHasRoom[c] = true;
        regionHasRoom[id] = true;
      }
    }
  }

  for (let i = 0; i < n; i++) {
    if (rowNeedsCat[i] && !rowHasRoom[i]) return { unit: 'row', index: i };
    if (colNeedsCat[i] && !colHasRoom[i]) return { unit: 'col', index: i };
    if (regionNeedsCat[i] && !regionHasRoom[i]) return { unit: 'region', index: i };
  }
  return null;
}

/**
 * The default longest chain R5 may follow: a test cat plus this many forced
 * cats. Two forced cats is about as far as most players can follow in their
 * head. The hardest levels raise it through the `chainLength` option.
 */
export const DEFAULT_CHAIN_LENGTH = 2;

/**
 * Place a test cat at (r,c) on a copy of the marks and report whether the
 * board breaks.
 *
 * `forcedCats` = 0 (R4): only the direct effect of that one cat is checked.
 * The player can see it at a glance: the cat's row, column, colour and
 * neighbours would cover every open cell of some other unit.
 *
 * `forcedCats` > 0 (R5): after the test cat, up to this many forced cats are
 * placed too (each one the only cell left in its row, column or colour).
 *
 * Returns { starved, chain } where `starved` is the unit left with nowhere to
 * go and `chain` lists the forced cats, or null when no contradiction appears.
 */
function contradictionAfterPlacing(board, marks, r, c, forcedCats) {
  const trial = marks.map((row) => row.slice());
  trial[r][c] = CAT;
  const chain = [];

  for (;;) {
    const grid = candidateGrid(board, trial);
    const starved = findStarvedUnit(board, trial, grid);
    if (starved) return { starved, chain };
    if (chain.length >= forcedCats) return null;

    const forced = findR1(board, trial, grid);
    if (!forced) return null;
    trial[forced.r][forced.c] = CAT;
    chain.push([forced.r, forced.c]);
  }
}

/**
 * R4/R5: find a candidate cell where a cat would leave some unit with nowhere
 * to go. That cell can be excluded.
 */
function findContradiction(board, marks, grid, forcedCats) {
  const { n } = board;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!grid[r][c]) continue;
      const found = contradictionAfterPlacing(board, marks, r, c, forcedCats);
      if (found) {
        return {
          rank: forcedCats ? 5 : 4,
          exclude: [[r, c]],
          starved: found.starved,
          chain: found.chain,
        };
      }
    }
  }
  return null;
}

/**
 * Find the best available hint.
 *
 * Returns one of:
 *   { kind: 'place',  r, c, rank, reason }
 *   { kind: 'exclude', exclude: [[r,c],...], rank, reason }
 *   null  (nothing left to deduce)
 *
 * Ranks are searched in order so the player always gets the simplest
 * explanation that currently applies.
 */
export function findHint(board, marks, options = {}) {
  const { maxRank = 3, chainLength = DEFAULT_CHAIN_LENGTH } = options;
  const grid = candidateGrid(board, marks);

  const r1 = findR1(board, marks, grid);
  if (r1) {
    return {
      kind: 'place',
      r: r1.r,
      c: r1.c,
      rank: 1,
      reason: describeR1(board, r1),
      unit: r1.unit,
      index: r1.index,
    };
  }

  const r2 = findR2(board, marks, grid);
  if (r2) {
    return {
      kind: 'exclude',
      exclude: r2.exclude,
      rank: 2,
      reason: describeR2(r2),
      highlight: { region: r2.region, kind: r2.kind, line: r2.line },
    };
  }

  if (maxRank >= 3) {
    const r3 = findR3(board, marks, grid);
    if (r3) {
      return {
        kind: 'exclude',
        exclude: r3.exclude,
        rank: 3,
        reason: describeR3(r3),
        highlight: { regions: r3.regions, kind: r3.kind, lines: r3.lines },
      };
    }
  }

  for (const rank of [4, 5]) {
    if (maxRank < rank) break;
    const forcedCats = rank === 5 ? chainLength : 0;
    const found = findContradiction(board, marks, grid, forcedCats);
    if (found) {
      return {
        kind: 'exclude',
        exclude: found.exclude,
        rank,
        reason: describeContradiction(found),
        highlight: { ...found.starved, chain: found.chain },
      };
    }
  }

  // No deduction applies: fall back to the stored solution so the player is
  // never stuck, but mark it as a reveal rather than a deduction.
  if (options.allowReveal && board.solution) {
    for (let r = 0; r < board.n; r++) {
      const c = board.solution[r];
      if (isOpenMark(marks[r][c])) {
        return {
          kind: 'place',
          r,
          c,
          rank: 9,
          reason: 'This is where the cat belongs.',
        };
      }
    }
  }
  return null;
}

function regionColourWord() {
  return 'colour';
}

function describeR1(board, hint) {
  const { unit, index } = hint;
  if (unit === 'row') return `Only one cell is left in row ${index + 1}.`;
  if (unit === 'col') return `Only one cell is left in column ${index + 1}.`;
  return `Only one cell is left in this ${regionColourWord()} region.`;
}

function describeR2(hint) {
  const kind = hint.kind;
  if (kind === 'row') {
    return 'Every open cell in this colour sits in one row, so that row is taken — exclude the rest.';
  }
  if (kind === 'col') {
    return 'Every open cell in this colour sits in one column, so that column is taken — exclude the rest.';
  }
  if (kind === 'rowToRegion') {
    return 'This row can only be filled by one colour, so that colour is used up — exclude its other cells.';
  }
  return 'This column can only be filled by one colour, so that colour is used up — exclude its other cells.';
}

function describeR3(hint) {
  const k = hint.regions.length;
  const lines = hint.kind === 'row' ? 'rows' : 'columns';
  return `${k} colours are locked into ${k} ${lines}, so those ${lines} hold no other colour.`;
}

function describeContradiction(found) {
  const { unit, index } = found.starved;
  const where = unit === 'row' ? `row ${index + 1}`
    : unit === 'col' ? `column ${index + 1}`
      : 'another colour';
  if (found.rank === 4) {
    return `A cat here would block every open cell in ${where}.`;
  }
  return `A cat here forces other cats that leave ${where} with nowhere to go.`;
}

/**
 * Solve a board with the hint ladder only, never revealing the answer.
 *
 * Every hint is a sound deduction, so if the ladder fills the board the
 * solution is also unique. `maxRank` and `chainLength` are passed on to
 * findHint. Returns:
 *   solved       did the ladder finish the board
 *   steps        number of hints applied
 *   rankCounts   how many hints of each rank were needed
 *   hardestRank  the highest rank used (0 when unsolved before any hint)
 */
export function solveByDeduction(board, { maxRank = 4, chainLength = DEFAULT_CHAIN_LENGTH } = {}) {
  const marks = emptyMarks(board.n);
  const rankCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let steps = 0;
  let hardestRank = 0;
  // Each hint changes at least one of the n*n cells, so this bound is never
  // reached by a working ladder; it only guards against an engine bug.
  const stepLimit = board.n * board.n + 1;

  while (!isSolved(board, marks) && steps < stepLimit) {
    const hint = findHint(board, marks, { maxRank, chainLength });
    if (!hint) break;
    if (hint.kind === 'place') {
      marks[hint.r][hint.c] = CAT;
    } else {
      for (const [r, c] of hint.exclude) marks[r][c] = CROSS;
    }
    steps++;
    rankCounts[hint.rank]++;
    hardestRank = Math.max(hardestRank, hint.rank);
  }
  return { solved: isSolved(board, marks), steps, rankCounts, hardestRank, marks };
}
