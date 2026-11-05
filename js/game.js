/**
 * The game screen: one board, its input, lives, hints and coaching.
 *
 * Input
 *   tap a cell        toggle a cross (empty <-> cross).
 *                     With "Maybe-Lala marks" on: empty -> maybe -> cross -> empty,
 *                     so a tap pencils in a maybe and a drag lays crosses.
 *   double-tap        place a cat (the first tap of the pair is taken back)
 *   A correct cat and the red cross left by a wrong cat are locked: no tap,
 *   drag, key or Clear changes them.
 *   drag across cells paint crosses. A drag that starts on a mark changes
 *                     only that kind of mark: from a cross it erases crosses
 *                     (with Maybe-Lala marks on, it turns them into maybes);
 *                     from a maybe it clears maybes.
 *   keyboard          arrows move, Space/Enter cycles, X cross, C cat,
 *                     M maybe, Backspace clears, H hint
 *
 * Challenge rules
 *   A cat on a wrong cell costs a life (a paw) and the cell is crossed out.
 *   Three lives and two hints per board. Crosses are never penalised, but a
 *   hint points out a cross that hides a cat before anything else.
 */
import {
  emptyMarks, candidateGrid, findHint, isOpenMark, CAT, CROSS, EMPTY, MAYBE, WRONG,
} from './engine.js';
import { BoardView } from './board-view.js';
import { explainHint } from './explain.js';
import { lalaFace, pawIcon, ICONS } from './lala.js';
import { settings, saveBoard, loadBoard, clearBoard } from './store.js';
import { audio } from './audio.js';

export const STARTING_LIVES = 3;
/** Two taps on one cell within this time count as a double tap. */
const DOUBLE_TAP_MS = 320;

/**
 * Drag modes. `to` is the mark a drag leaves; `only`, when set, limits the
 * drag to cells holding that mark.
 */
const DRAG_MODES = {
  cross: { to: CROSS },
  eraseCrosses: { only: CROSS, to: EMPTY },
  crossToMaybe: { only: CROSS, to: MAYBE },
  eraseMaybes: { only: MAYBE, to: EMPTY },
};
export const STARTING_HINTS = 2;

/** 3 stars for a clean solve, 2 for at most two slips or hints, else 1. */
export function starsFor(mistakes, hintsUsed) {
  const slips = mistakes + hintsUsed;
  if (slips === 0) return 3;
  return slips <= 2 ? 2 : 1;
}


export class Game {
  /**
   * @param {HTMLElement} root  where the screen is mounted
   * @param {object} options
   *   board     decoded board (n, regions, solution, chainLength)
   *   key       save key, e.g. "level:12" or "quick:7:hard:12345"
   *   eyebrow   small line above the title (chapter, size...)
   *   title     big title ("Level 12")
   *   coach     true to show the next logical step for free after each move
   *   onWin(result), onLose(), onExit(), onRules()
   */
  constructor(root, options) {
    this.root = root;
    this.options = options;
    this.board = options.board;
    this.key = options.key;
    this.coach = Boolean(options.coach);
    this.finished = false;
    this.drag = null;
    this.tipHint = null;

    const saved = loadBoard(this.key);
    this.marks = saved?.marks ?? emptyMarks(this.board.n);
    this.lives = saved?.lives ?? STARTING_LIVES;
    this.hintsLeft = saved?.hintsLeft ?? STARTING_HINTS;
    this.hintsUsed = saved?.hintsUsed ?? 0;
    this.mistakes = saved?.mistakes ?? 0;
    this.elapsed = saved?.elapsed ?? 0;
    this.history = saved?.history ?? [];

    this.mount();
    this.refresh();
    this.startTimer();
    if (this.coach) this.showCoachTip();
  }

  /* ---------------------------------------------------------------- *
   * Layout
   * ---------------------------------------------------------------- */

  mount() {
    const { eyebrow, title } = this.options;
    this.root.innerHTML = `
      <section class="screen game" aria-label="${title}">
        <header class="topbar">
          <button class="icon-btn" data-action="exit" aria-label="Back to the map">${ICONS.back}</button>
          <div class="topbar__title">
            <span class="eyebrow">${eyebrow}</span>
            <h1>${title}</h1>
          </div>
          <div class="topbar__tools">
            <button class="icon-btn" data-action="rules" aria-label="How to play">${ICONS.book}</button>
            <button class="icon-btn" data-action="settings" aria-label="Settings">${ICONS.gear}</button>
          </div>
        </header>
        <div class="status">
          <div class="pill lives" role="img"></div>
          <div class="pill timer-pill">${ICONS.clock}<span class="timer" aria-label="Time"></span></div>
        </div>
        <div class="board-slot"></div>
        <div class="tip" aria-live="polite"></div>
        <nav class="toolbar" aria-label="Tools">
          <button class="tool tool--hint" data-action="hint">${ICONS.bulb}<span>Hint</span><b class="badge"></b></button>
          <button class="tool" data-action="restart">${ICONS.eraser}<span>Clear</span></button>
        </nav>
      </section>`;

    this.screen = this.root.querySelector('.game');
    this.livesEl = this.root.querySelector('.lives');
    this.timerEl = this.root.querySelector('.timer');
    this.tipEl = this.root.querySelector('.tip');
    this.hintBadge = this.root.querySelector('.badge');
    this.hintButton = this.root.querySelector('[data-action="hint"]');

    this.view = new BoardView(this.board, { interactive: true, label: `${title} board` });
    this.root.querySelector('.board-slot').appendChild(this.view.el);

    this.onClick = (e) => this.handleClick(e);
    this.onKey = (e) => this.handleKey(e);
    this.onVisibility = () => (document.hidden ? this.stopTimer() : this.startTimer());
    this.screen.addEventListener('click', this.onClick);
    document.addEventListener('keydown', this.onKey);
    document.addEventListener('visibilitychange', this.onVisibility);

    const el = this.view.el;
    el.addEventListener('pointerdown', (e) => this.pointerDown(e));
    el.addEventListener('pointermove', (e) => this.pointerMove(e));
    el.addEventListener('pointerup', (e) => this.pointerUp(e));
    el.addEventListener('pointercancel', () => this.endDrag());
    el.addEventListener('contextmenu', (e) => e.preventDefault());

    this.clearTip();
  }

  destroy() {
    this.stopTimer();
    document.removeEventListener('keydown', this.onKey);
    document.removeEventListener('visibilitychange', this.onVisibility);
  }

  refresh() {
    const blocked = settings().shadeBlocked ? this.blockedCells() : null;
    this.view.render(this.marks, blocked);

    // Redraw the paws only when the count changes, so the one just lost can
    // play its exit animation.
    if (this.livesShown !== this.lives) {
      const justLost = this.livesShown !== undefined && this.lives < this.livesShown;
      this.livesEl.innerHTML = Array.from(
        { length: STARTING_LIVES },
        (_, i) => pawIcon(i < this.lives),
      ).join('');
      if (justLost) this.livesEl.children[this.lives]?.classList.add('paw--just-lost');
      this.livesShown = this.lives;
    }
    this.livesEl.setAttribute('aria-label', `${this.lives} of ${STARTING_LIVES} lives left`);

    this.hintBadge.textContent = this.coach ? '∞' : this.hintsLeft;
    this.hintButton.classList.toggle('is-empty', !this.coach && this.hintsLeft === 0);
    this.hintButton.setAttribute(
      'aria-label',
      this.coach ? 'Hint (free while Lala coaches)' : `Hint, ${this.hintsLeft} left`,
    );
    this.renderTimer();
  }

  /** Empty cells that a placed cat already rules out. */
  blockedCells() {
    const grid = candidateGrid(this.board, this.marks);
    return this.marks.map((row, r) => row.map((mark, c) => mark === EMPTY && !grid[r][c]));
  }

  /** What a single tap turns a cell into. */
  nextTapMark(mark) {
    if (settings().maybeMarks) {
      // Maybe first; a second tap still gives a lone cross without a drag.
      if (mark === EMPTY) return MAYBE;
      if (mark === MAYBE) return CROSS;
      return EMPTY;
    }
    return mark === EMPTY ? CROSS : EMPTY;
  }

  /* ---------------------------------------------------------------- *
   * Timer
   * ---------------------------------------------------------------- */

  startTimer() {
    if (this.timer || this.finished) return;
    this.timer = setInterval(() => {
      this.elapsed++;
      this.renderTimer();
      if (this.elapsed % 5 === 0) this.persist();
    }, 1000);
  }

  stopTimer() {
    clearInterval(this.timer);
    this.timer = null;
  }

  renderTimer() {
    const show = settings().showTimer;
    this.timerEl.parentElement.hidden = !show;
    if (!show) return;
    const minutes = Math.floor(this.elapsed / 60);
    const seconds = String(this.elapsed % 60).padStart(2, '0');
    this.timerEl.textContent = `${minutes}:${seconds}`;
  }

  /* ---------------------------------------------------------------- *
   * Input
   * ---------------------------------------------------------------- */

  cellAt(x, y) {
    const el = document.elementFromPoint(x, y)?.closest('.cell');
    if (!el || !this.view.el.contains(el)) return null;
    return [Number(el.dataset.r), Number(el.dataset.c)];
  }

  pointerDown(e) {
    if (this.finished || e.button > 0) return;
    const at = this.cellAt(e.clientX, e.clientY);
    if (!at) return;
    e.preventDefault();
    this.view.el.setPointerCapture(e.pointerId);
    this.drag = { start: at, last: at, paint: null, changes: [] };
    this.view.cell(...at).focus({ preventScroll: true });
  }

  pointerMove(e) {
    const drag = this.drag;
    if (!drag) return;
    const at = this.cellAt(e.clientX, e.clientY);
    if (!at || (at[0] === drag.last[0] && at[1] === drag.last[1])) return;

    if (!drag.paint) {
      // The first cell of the drag decides what the drag does.
      const [sr, sc] = drag.start;
      drag.paint = this.dragModeFrom(this.marks[sr][sc]);
      this.paintCell(drag, sr, sc);
    }
    drag.last = at;
    this.paintCell(drag, at[0], at[1]);
  }

  paintCell(drag, r, c) {
    const before = this.marks[r][c];
    if (this.isLocked(r, c)) return;
    const mode = DRAG_MODES[drag.paint];
    // A drag that started on a mark changes only that kind of mark; the
    // cells between them stay as they are.
    if (mode.only !== undefined && before !== mode.only) return;
    if (before === mode.to) return;
    this.marks[r][c] = mode.to;
    drag.changes.push([r, c, before, mode.to]);
    if (mode.to === MAYBE) audio.maybe();
    else if (mode.to === EMPTY) audio.erase();
    else audio.paint();
  }

  /** What a drag does, decided by the mark on its first cell. */
  dragModeFrom(mark) {
    if (mark === CROSS) return settings().maybeMarks ? 'crossToMaybe' : 'eraseCrosses';
    if (mark === MAYBE) return 'eraseMaybes';
    return 'cross';
    this.refresh();
  }

  pointerUp(e) {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    if (drag.paint) {
      this.commit(drag.changes);
    } else {
      const at = this.cellAt(e.clientX, e.clientY) ?? drag.start;
      this.tap(...at);
    }
  }

  endDrag() {
    if (this.drag?.changes.length) this.commit(this.drag.changes);
    this.drag = null;
  }

  /**
   * A single tap toggles a cross, so clearing a cross can never place a cat
   * by mistake. A quick second tap on the same cell undoes the first tap and
   * places a cat. The first tap still acts at once, so play never lags.
   */
  tap(r, c) {
    const now = performance.now();
    const previous = this.lastTap;
    this.lastTap = null;

    if (this.isLocked(r, c)) return;

    const isDoubleTap = previous && previous.r === r && previous.c === c &&
      now - previous.time < DOUBLE_TAP_MS;
    if (isDoubleTap) {
      this.revertStep(previous.step);
      this.placeCat(r, c);
      return;
    }

    this.setMark(r, c, this.nextTapMark(this.marks[r][c]));
    this.lastTap = { r, c, time: now, step: this.history.at(-1) };
  }

  /** Quietly take back one step, if it is still the latest. */
  revertStep(step) {
    if (!step || this.history.at(-1) !== step) return;
    this.history.pop();
    for (const [r, c, before] of step.slice().reverse()) this.marks[r][c] = before;
  }

  handleKey(e) {
    if (this.finished || document.querySelector('.sheet:not([hidden])')) return;
    if (e.key === 'h' || e.key === 'H') { this.hint(); return; }

    const cell = document.activeElement?.closest?.('.cell');
    if (!cell || !this.view.el.contains(cell)) return;
    const r = Number(cell.dataset.r), c = Number(cell.dataset.c);
    const n = this.board.n;
    const moves = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };

    if (moves[e.key]) {
      e.preventDefault();
      const nr = Math.min(n - 1, Math.max(0, r + moves[e.key][0]));
      const nc = Math.min(n - 1, Math.max(0, c + moves[e.key][1]));
      cell.tabIndex = -1;
      const next = this.view.cell(nr, nc);
      next.tabIndex = 0;
      next.focus();
    } else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      this.tap(r, c);
    } else if (e.key === 'x' || e.key === 'X') {
      this.setMark(r, c, this.marks[r][c] === CROSS ? EMPTY : CROSS);
    } else if (e.key === 'm' || e.key === 'M') {
      this.setMark(r, c, this.marks[r][c] === MAYBE ? EMPTY : MAYBE);
    } else if (e.key === 'c' || e.key === 'C') {
      if (!this.isLocked(r, c)) this.placeCat(r, c);
    } else if (e.key === 'Backspace' || e.key === 'Delete') {
      this.setMark(r, c, EMPTY);
    }
  }

  handleClick(e) {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (!action) return;
    if (action === 'exit') this.options.onExit();
    else if (action === 'rules') this.options.onRules();
    else if (action === 'settings') this.options.onSettings();
    else if (action === 'hint') this.hint();
    else if (action === 'restart') this.clearMarks();
    else if (action === 'apply') this.applyTip();
    else if (action === 'dismiss') this.dismissTip();
    else if (action === 'coach-off') {
      this.coach = false;
      this.refresh();
      this.dismissTip();
    }
  }

  /* ---------------------------------------------------------------- *
   * Moves
   * ---------------------------------------------------------------- */

  /** Correct cats and red crosses never change once placed. */
  isLocked(r, c) {
    const mark = this.marks[r][c];
    return mark === CAT || mark === WRONG;
  }

  setMark(r, c, mark) {
    if (this.finished || this.marks[r][c] === mark || this.isLocked(r, c)) return;
    const before = this.marks[r][c];
    this.marks[r][c] = mark;
    // Cats make their own sound in placeCat.
    if (mark === CROSS) audio.cross();
    else if (mark === MAYBE) audio.maybe();
    else if (mark === EMPTY) audio.erase();
    this.commit([[r, c, before, mark]]);
  }

  placeCat(r, c) {
    if (this.finished) return;
    if (this.board.solution[r] !== c) {
      this.loseLife(r, c);
      return;
    }
    this.setMark(r, c, CAT);
    audio.cat(this.marks.flat().filter((m) => m === CAT).length);
    this.view.pulse(r, c, 'is-placed');
    this.buzz(8);
    this.checkWin();
  }

  loseLife(r, c) {
    this.lives--;
    this.mistakes++;
    // The cell is now known to be empty: lock a red cross on it, so the
    // same slip can never cost a second paw.
    const before = this.marks[r][c];
    this.marks[r][c] = WRONG;
    this.commit([[r, c, before, WRONG]], { keepTip: true });
    this.view.pulse(r, c, 'is-wrong', 700);
    this.buzz([30, 40, 30]);
    audio.wrong();

    if (this.lives <= 0) {
      this.finish();
      setTimeout(() => this.options.onLose(), 700);
      return;
    }
    this.showTip({
      mood: 'oops',
      title: 'Not there!',
      text: `Lala can’t sit on that cell, so she crossed it out. ${this.lives === 1 ? 'One paw left, careful!' : `${this.lives} paws left.`}`,
      actions: '<button class="btn btn--quiet" data-action="dismiss">OK</button>',
    });
  }

  /**
   * Record one step and react to it. Steps are kept so a double tap can
   * take back its first tap (see revertStep).
   */
  commit(changes, { keepTip = false } = {}) {
    if (!changes.length) return;
    this.history.push(changes);
    if (this.history.length > 300) this.history.shift();
    this.afterChange(keepTip);
  }

  afterChange(keepTip = false) {
    this.refresh();
    this.persist();
    if (this.finished) return;
    if (this.coach) this.showCoachTip();
    else if (!keepTip) this.dismissTip();
  }

  clearMarks() {
    if (this.finished) return;
    const changes = [];
    for (let r = 0; r < this.board.n; r++) {
      for (let c = 0; c < this.board.n; c++) {
        const mark = this.marks[r][c];
        if (mark === CROSS || mark === MAYBE) changes.push([r, c, mark, EMPTY]);
      }
    }
    for (const [r, c] of changes) this.marks[r][c] = EMPTY;
    if (changes.length) audio.erase();
    this.commit(changes);
  }

  checkWin() {
    const cats = this.marks.flat().filter((m) => m === CAT).length;
    // Wrong cats are never kept, so n cats means the board is solved.
    if (cats !== this.board.n) return;
    this.finish();
    this.dismissTip();
    this.view.celebrate();
    audio.win();
    const result = {
      stars: starsFor(this.mistakes, this.hintsUsed),
      seconds: this.elapsed,
      mistakes: this.mistakes,
      hintsUsed: this.hintsUsed,
    };
    setTimeout(() => this.options.onWin(result), 1100);
  }

  finish() {
    this.finished = true;
    this.stopTimer();
    this.screen.classList.add('is-finished');
    clearBoard(this.key);
  }

  persist() {
    if (this.finished) return;
    saveBoard({
      key: this.key,
      marks: this.marks,
      lives: this.lives,
      hintsLeft: this.hintsLeft,
      hintsUsed: this.hintsUsed,
      mistakes: this.mistakes,
      elapsed: this.elapsed,
      history: this.history,
    });
  }

  buzz(pattern) {
    if (settings().haptics && navigator.vibrate) navigator.vibrate(pattern);
  }

  /* ---------------------------------------------------------------- *
   * Hints and tips
   * ---------------------------------------------------------------- */

  /** The next logical step from the current marks. */
  nextStep() {
    // A cross on a cat's cell would make every later deduction wrong, so
    // point that out first.
    for (let r = 0; r < this.board.n; r++) {
      const c = this.board.solution[r];
      if (this.marks[r][c] === CROSS) return { kind: 'fix', r, c };
    }
    return findHint(this.board, this.marks, {
      maxRank: 5,
      chainLength: Math.max(this.board.chainLength ?? 2, 2),
      allowReveal: true,
    });
  }

  hint() {
    if (this.finished) return;
    if (!this.coach && this.hintsLeft === 0) {
      this.showTip({
        mood: 'sleepy',
        title: 'No hints left',
        text: 'Lala has shared both her hints for this board. You can still open the Techniques notebook from the book icon.',
        actions: '<button class="btn btn--quiet" data-action="dismiss">OK</button>',
      });
      return;
    }
    const step = this.nextStep();
    if (!step) return;
    if (!this.coach) {
      this.hintsLeft--;
      this.hintsUsed++;
      this.refresh();
      this.persist();
    }
    audio.hint();
    this.presentStep(step, { applyable: true });
  }

  showCoachTip() {
    const step = this.nextStep();
    if (!step) return;
    this.presentStep(step, { applyable: false });
  }

  presentStep(step, { applyable }) {
    const explained = explainHint(step, this.board, this.view);
    this.tipHint = step;
    this.view.highlight(explained.highlight);
    const actions = applyable
      ? `<button class="btn btn--primary" data-action="apply">Do it for me</button>
         <button class="btn btn--quiet" data-action="dismiss">I’ll do it</button>`
      : '<button class="btn btn--quiet" data-action="coach-off">I’ve got it from here</button>';
    this.showTip({
      mood: step.kind === 'fix' ? 'oops' : 'wink',
      eyebrow: this.coach && !applyable ? 'Lala’s tip' : 'Hint',
      title: explained.title,
      text: explained.text,
      actions,
    });
  }

  applyTip() {
    const step = this.tipHint;
    if (!step) return;
    this.dismissTip();
    if (step.kind === 'fix') {
      this.setMark(step.r, step.c, EMPTY);
    } else if (step.kind === 'place') {
      this.placeCat(step.r, step.c);
    } else {
      const changes = step.exclude
        .filter(([r, c]) => isOpenMark(this.marks[r][c]))
        .map(([r, c]) => [r, c, this.marks[r][c], CROSS]);
      for (const [r, c] of changes) this.marks[r][c] = CROSS;
      if (changes.length) audio.cross();
      this.commit(changes);
    }
  }

  showTip({ mood = 'calm', eyebrow = '', title, text, actions = '' }) {
    this.tipEl.innerHTML = `
      <div class="tip__card">
        <div class="tip__avatar">${lalaFace({ mood })}</div>
        <div class="tip__body">
          ${eyebrow ? `<span class="eyebrow">${eyebrow}</span>` : ''}
          <h2 class="tip__title">${title}</h2>
          <p class="tip__text">${text}</p>
          ${actions ? `<div class="tip__actions">${actions}</div>` : ''}
        </div>
      </div>`;
    this.tipEl.classList.add('is-active');
  }

  dismissTip() {
    this.tipHint = null;
    this.view.clearHighlight();
    this.clearTip();
  }

  /** Empty the tip strip. It takes no space, so the board can grow. */
  clearTip() {
    this.tipEl.classList.remove('is-active');
    this.tipEl.innerHTML = '';
  }
}
