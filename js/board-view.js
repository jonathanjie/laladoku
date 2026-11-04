/**
 * Board view: draws a board and its marks, and shows hint highlights.
 *
 * It knows nothing about rules or lives. The game screen feeds it marks and
 * listens for taps and drags; the Techniques notebook uses it read-only.
 */
import { CAT, CROSS, EMPTY } from './engine.js';
import { lalaFace, CROSS_SVG } from './lala.js';

/**
 * Region colours, in hue order around the colour wheel. The CSS defines one
 * custom property per entry for each theme (--region-0 ... --region-9).
 * Names are used in hint text ("the mint colour").
 */
export const REGION_COLOURS = [
  'rose', 'apricot', 'butter', 'lime', 'mint', 'teal', 'sky', 'periwinkle', 'lilac', 'pink',
];

/** Which regions share an edge. */
function regionNeighbours(board) {
  const { n, regions } = board;
  const neighbours = Array.from({ length: n }, () => new Set());
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const id = regions[r][c];
      if (r + 1 < n && regions[r + 1][c] !== id) {
        neighbours[id].add(regions[r + 1][c]);
        neighbours[regions[r + 1][c]].add(id);
      }
      if (c + 1 < n && regions[r][c + 1] !== id) {
        neighbours[id].add(regions[r][c + 1]);
        neighbours[regions[r][c + 1]].add(id);
      }
    }
  }
  return neighbours;
}

/**
 * Give every region its own colour.
 *
 * A board with n regions uses n hues spread evenly around the wheel, so a
 * 5x5 board never gets two near-identical purples. The hues are then handed
 * out greedily, busiest region first, so that regions which touch get hues
 * as far apart as possible. The result depends only on the region map, so a
 * board always looks the same.
 */
export function assignColours(board) {
  const { n } = board;
  const neighbours = regionNeighbours(board);
  const palette = REGION_COLOURS.length;
  const hues = Array.from({ length: n }, (_, i) => Math.round((i * palette) / n) % palette);
  const colour = new Array(n).fill(-1);
  const free = new Set(hues);
  const order = [...Array(n).keys()].sort((a, b) => neighbours[b].size - neighbours[a].size || a - b);

  const hueGap = (a, b) => {
    const d = Math.abs(a - b) % palette;
    return Math.min(d, palette - d);
  };

  for (const id of order) {
    let best = -1, bestGap = -1;
    for (const candidate of free) {
      let closest = palette;
      for (const other of neighbours[id]) {
        if (colour[other] >= 0) closest = Math.min(closest, hueGap(candidate, colour[other]));
      }
      if (closest > bestGap) { best = candidate; bestGap = closest; }
    }
    colour[id] = best;
    free.delete(best);
  }
  return colour;
}

export class BoardView {
  /**
   * @param {object} board   decoded board { n, regions }
   * @param {object} options
   *   interactive  true to make cells focusable buttons
   *   label        accessible name of the grid
   */
  constructor(board, { interactive = false, label = 'Puzzle board' } = {}) {
    this.board = board;
    this.colours = assignColours(board);
    this.el = document.createElement('div');
    this.el.className = 'board';
    if (interactive) this.el.classList.add('board--interactive');
    if (board.n >= 9) this.el.classList.add('board--dense');
    this.el.style.setProperty('--n', board.n);
    this.el.setAttribute('role', 'grid');
    this.el.setAttribute('aria-label', label);
    this.cells = [];
    this.drawCells(interactive);
  }

  colourName(regionId) {
    return REGION_COLOURS[this.colours[regionId]];
  }

  drawCells(interactive) {
    const { n, regions } = this.board;
    for (let r = 0; r < n; r++) {
      const row = document.createElement('div');
      row.className = 'board__row';
      row.setAttribute('role', 'row');
      const cellRow = [];
      for (let c = 0; c < n; c++) {
        const id = regions[r][c];
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.dataset.r = r;
        cell.dataset.c = c;
        cell.setAttribute('role', 'gridcell');
        cell.style.setProperty('--fill', `var(--region-${this.colours[id]})`);
        // Thick ink on the sides where the colour changes.
        if (r === 0 || regions[r - 1][c] !== id) cell.classList.add('edge-t');
        if (r === n - 1 || regions[r + 1][c] !== id) cell.classList.add('edge-b');
        if (c === 0 || regions[r][c - 1] !== id) cell.classList.add('edge-l');
        if (c === n - 1 || regions[r][c + 1] !== id) cell.classList.add('edge-r');
        if (interactive) cell.tabIndex = r === 0 && c === 0 ? 0 : -1;
        cell.innerHTML = '<span class="cell__mark"></span>';
        row.appendChild(cell);
        cellRow.push(cell);
      }
      this.el.appendChild(row);
      this.cells.push(cellRow);
    }
  }

  cell(r, c) {
    return this.cells[r]?.[c] ?? null;
  }

  /**
   * Draw the marks. `blocked` (optional) is an n x n boolean grid of cells a
   * placed cat already rules out; they get a soft dot.
   */
  render(marks, blocked = null) {
    const { n } = this.board;
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const cell = this.cells[r][c];
        const mark = marks[r][c];
        const state = mark === CAT ? 'cat' : mark === CROSS ? 'cross' : 'empty';
        if (cell.dataset.state !== state) {
          cell.dataset.state = state;
          cell.firstChild.innerHTML = state === 'cat'
            ? lalaFace({ whiskers: this.board.n <= 7 })
            : state === 'cross' ? CROSS_SVG : '';
        }
        cell.classList.toggle('is-blocked', Boolean(blocked && mark === EMPTY && blocked[r][c]));
        cell.setAttribute(
          'aria-label',
          `Row ${r + 1}, column ${c + 1}, ${this.colourName(this.board.regions[r][c])}` +
            (state === 'cat' ? ', cat' : state === 'cross' ? ', crossed out' : ''),
        );
      }
    }
  }

  /** Play a one-shot animation class on a cell. */
  pulse(r, c, className, ms = 600) {
    const cell = this.cell(r, c);
    if (!cell) return;
    cell.classList.remove(className);
    void cell.offsetWidth; // restart the animation
    cell.classList.add(className);
    setTimeout(() => cell.classList.remove(className), ms);
  }

  /**
   * Show a hint on the board.
   *   zone     cells that explain the reason (a row, a colour...)
   *   focus    the cell the hint is about
   *   exclude  cells the hint crosses out
   *   ghost    cells that would hold a cat in a "what if" (R4/R5)
   */
  highlight({ zone = [], focus = [], exclude = [], ghost = [] } = {}) {
    this.clearHighlight();
    this.el.classList.add('has-highlight');
    for (const [r, c] of zone) this.cell(r, c)?.classList.add('hl-zone');
    for (const [r, c] of focus) this.cell(r, c)?.classList.add('hl-focus');
    for (const [r, c] of exclude) this.cell(r, c)?.classList.add('hl-exclude');
    ghost.forEach(([r, c], i) => {
      const cell = this.cell(r, c);
      if (!cell) return;
      cell.classList.add('hl-ghost');
      cell.firstChild.dataset.ghost = i + 1;
      cell.style.setProperty('--ghost-order', i);
    });
  }

  clearHighlight() {
    this.el.classList.remove('has-highlight');
    for (const row of this.cells) {
      for (const cell of row) {
        cell.classList.remove('hl-zone', 'hl-focus', 'hl-exclude', 'hl-ghost');
        delete cell.firstChild.dataset.ghost;
      }
    }
  }

  /** Cats bounce one after another, row by row, when the board is solved. */
  celebrate() {
    this.el.classList.add('is-solved');
    let order = 0;
    for (const row of this.cells) {
      for (const cell of row) {
        if (cell.dataset.state === 'cat') cell.style.setProperty('--win-order', order++);
      }
    }
  }
}
