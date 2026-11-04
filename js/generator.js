/**
 * Laladoku level generator.
 *
 * A level is built from a seed, so the same seed always gives the same board:
 *
 *   1. Place n cats, one per row and column, with no two cats touching.
 *   2. Grow one colour region around each cat by random flood fill. Every
 *      region is contiguous and holds exactly its own cat.
 *   3. Solve the board with the hint ladder only, up to the level's highest
 *      allowed rank, and count the cells the ladder could not settle.
 *   4. Repair by local search: move one border cell from its region into a
 *      neighbouring region, and keep the move if no more cells are left
 *      unsettled than before. Stop when the ladder settles every cell.
 *      Sound deductions that reach a full board also prove the solution is
 *      unique.
 *   5. Harden: keep moving cells while the board stays solvable and its
 *      difficulty score does not drop. The board must end up needing its
 *      tier's hardest rank at least once.
 *   6. If either search stalls, start again from new regions (and, every few
 *      restarts, new cats).
 */
import {
  solveByDeduction, countSolutions, EMPTY, DEFAULT_CHAIN_LENGTH,
} from './engine.js';

/** Deterministic 32-bit PRNG (mulberry32). Returns floats in [0, 1). */
export function createRandom(seed) {
  let state = seed >>> 0;
  return function random() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomInt(random, maxExclusive) {
  return Math.floor(random() * maxExclusive);
}

function shuffled(random, items) {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(random, i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Step 1: a random column for each row so that columns are all different and
 * cats in neighbouring rows are at least two columns apart.
 * Returns null for n = 2 and n = 3, where no such placement exists.
 */
export function placeCats(n, random) {
  const solution = [];
  const usedCols = new Set();

  const place = (row) => {
    if (row === n) return true;
    for (const col of shuffled(random, [...Array(n).keys()])) {
      if (usedCols.has(col)) continue;
      if (row > 0 && Math.abs(solution[row - 1] - col) < 2) continue;
      solution.push(col);
      usedCols.add(col);
      if (place(row + 1)) return true;
      solution.pop();
      usedCols.delete(col);
    }
    return false;
  };

  return place(0) ? solution : null;
}

const ORTHOGONAL_STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/**
 * Choose a target size for each region. Boards with uneven regions solve
 * better by logic: a tiny region pins its cat almost at once and gives the
 * player a place to start, and one large region soaks up the space that is
 * left. Regions of equal size tend to allow several symmetric solutions.
 *
 * The shape used here: one large region of about a third of the board, one
 * or two tiny regions of 1-3 cells, and the rest sharing what remains.
 */
export function regionTargets(n, random) {
  const total = n * n;
  const targets = new Array(n).fill(0);
  const order = shuffled(random, [...Array(n).keys()]);

  const largeShare = 0.28 + random() * 0.08;
  targets[order[0]] = Math.round(total * largeShare);

  const tinyCount = n >= 6 ? 1 + randomInt(random, 2) : 1;
  for (let i = 1; i <= tinyCount; i++) targets[order[i]] = 1 + randomInt(random, 3);

  const rest = order.slice(1 + tinyCount);
  const weights = rest.map(() => 0.6 + random() * 0.8);
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const remaining = total - targets.reduce((a, b) => a + b, 0);
  rest.forEach((id, i) => {
    targets[id] = Math.max(2, Math.round((remaining * weights[i]) / weightSum));
  });
  return targets;
}

/**
 * Step 2: grow regions outward from the cats until every cell is coloured.
 *
 * Each round picks a region that can still grow, weighted by how far it is
 * below its target size, and gives it one random uncoloured neighbour. A
 * region that has reached its target only grows when no other region can,
 * so the targets are approximate but every cell always gets a colour.
 */
export function growRegions(n, solution, random) {
  const regions = Array.from({ length: n }, () => new Array(n).fill(-1));
  const frontier = Array.from({ length: n }, () => []);
  const sizes = new Array(n).fill(1);
  const targets = regionTargets(n, random);

  const addNeighbours = (id, r, c) => {
    for (const [dr, dc] of ORTHOGONAL_STEPS) {
      const rr = r + dr, cc = c + dc;
      if (rr >= 0 && rr < n && cc >= 0 && cc < n && regions[rr][cc] === -1) {
        frontier[id].push([rr, cc]);
      }
    }
  };

  for (let r = 0; r < n; r++) {
    regions[r][solution[r]] = r;
    addNeighbours(r, r, solution[r]);
  }

  let uncoloured = n * n - n;
  while (uncoloured > 0) {
    // Drop frontier cells that another region has already taken.
    const growable = [];
    for (let id = 0; id < n; id++) {
      frontier[id] = frontier[id].filter(([r, c]) => regions[r][c] === -1);
      if (frontier[id].length) growable.push(id);
    }
    const id = pickGrowingRegion(growable, sizes, targets, random);
    const [r, c] = frontier[id][randomInt(random, frontier[id].length)];
    regions[r][c] = id;
    sizes[id]++;
    addNeighbours(id, r, c);
    uncoloured--;
  }
  return regions;
}

/** Pick a region to grow, weighted by how far it is below its target. */
function pickGrowingRegion(growable, sizes, targets, random) {
  const deficits = growable.map((id) => Math.max(0, targets[id] - sizes[id]));
  const deficitSum = deficits.reduce((a, b) => a + b, 0);
  if (deficitSum === 0) return growable[randomInt(random, growable.length)];

  let pick = random() * deficitSum;
  for (let i = 0; i < growable.length; i++) {
    pick -= deficits[i];
    if (pick < 0) return growable[i];
  }
  return growable[growable.length - 1];
}

/** Is the region `id` still one 4-connected piece if (skipR, skipC) leaves it? */
function staysConnectedWithout(regions, id, skipR, skipC) {
  const n = regions.length;
  const cells = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (regions[r][c] === id && !(r === skipR && c === skipC)) cells.push([r, c]);
    }
  }
  if (!cells.length) return false;

  const key = (r, c) => r * n + c;
  const seen = new Set([key(...cells[0])]);
  const stack = [cells[0]];
  while (stack.length) {
    const [r, c] = stack.pop();
    for (const [dr, dc] of ORTHOGONAL_STEPS) {
      const rr = r + dr, cc = c + dc;
      if (rr < 0 || rr >= n || cc < 0 || cc >= n) continue;
      if (rr === skipR && cc === skipC) continue;
      if (regions[rr][cc] !== id || seen.has(key(rr, cc))) continue;
      seen.add(key(rr, cc));
      stack.push([rr, cc]);
    }
  }
  return seen.size === cells.length;
}

/** Cells the deduction ladder left open. 0 means the board is solved. */
function unsettledCells(marks) {
  let count = 0;
  for (const row of marks) for (const mark of row) if (mark === EMPTY) count++;
  return count;
}

/**
 * Pick the cell to move. Cells the ladder could not settle are where the
 * ambiguity lives, so most moves happen at or next to them; the rest are
 * random so the search can leave a dead end.
 */
function pickCellToMove(n, marks, random) {
  const focusShare = 0.75;
  if (random() < focusShare) {
    const open = [];
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) if (marks[r][c] === EMPTY) open.push([r, c]);
    }
    if (open.length) {
      const [r, c] = open[randomInt(random, open.length)];
      const dr = randomInt(random, 3) - 1;
      const dc = randomInt(random, 3) - 1;
      return [Math.min(n - 1, Math.max(0, r + dr)), Math.min(n - 1, Math.max(0, c + dc))];
    }
  }
  return [randomInt(random, n), randomInt(random, n)];
}

/**
 * Move one cell into a neighbouring region, if that keeps every region
 * contiguous and leaves the cats where they are. Returns the undo
 * information, or null when the chosen cell cannot move.
 */
function tryMoveCell(board, r, c, random) {
  const { n, regions, solution } = board;
  if (solution[r] === c) return null;

  const from = regions[r][c];
  const targets = [];
  for (const [dr, dc] of ORTHOGONAL_STEPS) {
    const rr = r + dr, cc = c + dc;
    if (rr < 0 || rr >= n || cc < 0 || cc >= n) continue;
    const to = regions[rr][cc];
    if (to !== from && !targets.includes(to)) targets.push(to);
  }
  if (!targets.length || !staysConnectedWithout(regions, from, r, c)) return null;

  regions[r][c] = targets[randomInt(random, targets.length)];
  return { r, c, from };
}

/**
 * Hill-climb a region map until the ladder solves it. Returns the final
 * deduction result, which has `solved` = true on success.
 */
function refineRegions(board, random, ladder, moveBudget) {
  let best = solveByDeduction(board, ladder);
  let bestScore = unsettledCells(best.marks);

  for (let move = 0; move < moveBudget && !best.solved; move++) {
    const [r, c] = pickCellToMove(board.n, best.marks, random);
    const undo = tryMoveCell(board, r, c, random);
    if (!undo) continue;

    const result = solveByDeduction(board, ladder);
    const score = unsettledCells(result.marks);
    // Equal scores are accepted so the search can drift across plateaus.
    if (score <= bestScore) {
      best = result;
      bestScore = score;
    } else {
      board.regions[undo.r][undo.c] = undo.from;
    }
  }
  return best;
}

/**
 * How hard a solve felt, from the hints it needed. Placing the last cat in a
 * unit (R1) is the baseline of every board and scores nothing; each step up
 * the ladder is worth more than the one below.
 */
const RANK_WEIGHTS = { 1: 0, 2: 1, 3: 3, 4: 4, 5: 8 };

export function difficultyScore(rankCounts) {
  let score = 0;
  for (const rank of Object.keys(RANK_WEIGHTS)) score += RANK_WEIGHTS[rank] * (rankCounts[rank] || 0);
  return score;
}

/**
 * Make a solvable board harder: try random cell moves and keep each one that
 * leaves the board solvable by the same ladder without lowering its score.
 */
function hardenRegions(board, random, ladder, moveBudget, solved) {
  let best = solved;
  let bestScore = difficultyScore(best.rankCounts);

  for (let move = 0; move < moveBudget; move++) {
    const [r, c] = [randomInt(random, board.n), randomInt(random, board.n)];
    const undo = tryMoveCell(board, r, c, random);
    if (!undo) continue;

    const result = solveByDeduction(board, ladder);
    const score = difficultyScore(result.rankCounts);
    if (result.solved && score >= bestScore) {
      best = result;
      bestScore = score;
    } else {
      board.regions[undo.r][undo.c] = undo.from;
    }
  }
  return best;
}

/**
 * Generate one level of size n from a seed.
 *
 * Options:
 *   maxRank      hardest deduction the player may need (5 = chains)
 *   chainLength  longest R5 chain allowed, in forced cats after the test cat
 *   minRank      the board must need at least one hint of this rank
 *   hardenMoves  cell moves spent making a solved board harder (0 = none)
 *
 * Returns { n, regions, solution, seed, restarts, steps, rankCounts,
 * hardestRank, score } or null if no board passed within `maxRestarts`.
 */
export function generateLevel(n, seed, {
  maxRank = 4,
  chainLength = DEFAULT_CHAIN_LENGTH,
  minRank = 1,
  hardenMoves = 0,
  maxRestarts = 30,
  movesPerRestart = 40 * n,
} = {}) {
  const random = createRandom(seed);
  const ladder = { maxRank, chainLength };
  // A cat layout can be hard to cover with good regions, so try a fresh
  // layout every few restarts instead of spending every restart on one.
  const restartsPerLayout = 3;
  let solution = null;

  for (let restart = 1; restart <= maxRestarts; restart++) {
    if ((restart - 1) % restartsPerLayout === 0) solution = placeCats(n, random);
    if (!solution) return null;

    const board = { n, regions: growRegions(n, solution, random), solution };
    let result = refineRegions(board, random, ladder, movesPerRestart);
    if (!result.solved) continue;
    if (hardenMoves) result = hardenRegions(board, random, ladder, hardenMoves, result);
    if (result.hardestRank < minRank) continue;

    return {
      ...board,
      seed,
      restarts: restart,
      steps: result.steps,
      rankCounts: result.rankCounts,
      hardestRank: result.hardestRank,
      score: difficultyScore(result.rankCounts),
    };
  }
  return null;
}

/** Independent check used by tests: brute-force solution count. */
export function hasUniqueSolution(board) {
  return countSolutions(board, 2) === 1;
}
