/**
 * Laladoku app shell: screens, routing and sheets.
 *
 * Routes (hash based, so the app works from any static host and offline):
 *   #/                       home
 *   #/map                    chapter map
 *   #/play/<level>           campaign level
 *   #/quick                  Quick Play setup
 *   #/quick/<size>/<tier>/<seed>   a generated Quick Play board
 *   #/learn                  Techniques notebook
 */
import { decodeLevel, candidateGrid, CAT, CROSS, EMPTY } from './engine.js';
import { loadIndex, loadLevel, chapterOf } from './levels.js';
import { Game, STARTING_LIVES, STARTING_HINTS } from './game.js';
import { BoardView } from './board-view.js';
import { TECHNIQUES, explainHint } from './explain.js';
import { lalaFace, pawIcon, ICONS } from './lala.js';
import * as store from './store.js';
import { installMode, promptInstall, onInstallChange } from './install.js';
import { applyTheme } from './theme.js';
import { audio } from './audio.js';

const app = document.getElementById('app');
const sheet = document.getElementById('sheet');

/** Levels where Lala shows the next logical step for free. */
const COACHED_LEVELS = 3;

const QUICK_SIZES = [5, 6, 7, 8, 9, 10];
/** From this size up, generating on a phone can take several seconds. */
const QUICK_SLOW_SIZE = 9;
const QUICK_TIERS = [
  { id: 'easy', name: 'Easy', note: 'Last spot and Lined up' },
  { id: 'medium', name: 'Medium', note: 'Adds Locked sets' },
  { id: 'hard', name: 'Hard', note: 'Needs Blocked cells' },
];

let activeGame = null;
let routeToken = 0;
/** Stops the home screen from listening for install changes once we leave it. */
let stopInstallWatch = null;
/** Quick Play's generator thread, started on first use. */
let quickWorker = null;
/** The Quick Play board being generated right now: { reject }, or null. */
let quickPending = null;
/** The Techniques notebook's example boards, fetched on first visit. */
let examplesPromise = null;

/* ------------------------------------------------------------------ *
 * Routing
 * ------------------------------------------------------------------ */

applyTheme(store.settings().theme);
window.addEventListener('hashchange', route);
// Browsers only allow sound after the player interacts with the page.
document.addEventListener('pointerdown', () => audio.unlock(), { capture: true });
document.addEventListener('keydown', () => audio.unlock(), { capture: true });
route();
registerServiceWorker();

async function route() {
  const token = ++routeToken;
  activeGame?.destroy();
  activeGame = null;
  stopInstallWatch?.();
  stopInstallWatch = null;
  cancelQuickGeneration();
  closeSheet();

  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  try {
    if (parts[0] === 'play') await showLevel(Number(parts[1]), token);
    else if (parts[0] === 'map') await showMap(token);
    else if (parts[0] === 'quick' && parts.length === 4) await showQuickGame(parts, token);
    else if (parts[0] === 'quick') showQuickSetup();
    else if (parts[0] === 'learn') await showNotebook(token);
    else await showHome(token);
  } catch (error) {
    console.error(error);
    if (token === routeToken) showError();
  }
  if (token === routeToken) {
    window.scrollTo(0, 0);
    app.querySelector('h1')?.focus({ preventScroll: true });
  }
}

function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

/* ------------------------------------------------------------------ *
 * Home
 * ------------------------------------------------------------------ */

async function showHome(token) {
  const index = await loadIndex();
  if (token !== routeToken) return;

  const next = Math.min(store.highestUnlocked(), index.total);
  const { chapter, position } = chapterOf(index, next);
  const allDone = store.result(index.total) !== null;
  const stars = store.totalStars();

  app.innerHTML = `
    <section class="screen home">
      <div class="home__hero">
        <div class="home__lala">${lalaFace({ mood: 'calm', label: 'Lala, an orange tabby cat' })}</div>
        <h1 class="home__title" tabindex="-1">Lala<span>doku</span></h1>
        <p class="home__tag">A calm logic puzzle for one orange cat and all her friends.</p>
      </div>

      <a class="continue" href="#/play/${next}">
        <span class="eyebrow">${allDone ? 'Play again' : next === 1 ? 'Start here' : 'Continue'}</span>
        <span class="continue__level">Level ${next}</span>
        <span class="continue__meta">${chapter.name} · ${position} of ${chapter.count} · ${chapter.size}×${chapter.size}</span>
        <span class="continue__go" aria-hidden="true">${ICONS.back}</span>
      </a>

      <div class="home__grid">
        <a class="tile" href="#/map">${ICONS.map}<b>Chapters</b><span>${index.chapters.length} chapters, ${index.total} levels</span></a>
        <a class="tile" href="#/quick">${ICONS.dice}<b>Quick Play</b><span>A fresh puzzle, made just now</span></a>
        <a class="tile" href="#/learn">${ICONS.book}<b>Techniques</b><span>Lala’s notebook of tricks</span></a>
        <button class="tile" data-action="settings">${ICONS.gear}<b>Settings</b><span>${stars} ★ collected</span></button>
      </div>
      <div class="install-slot"></div>
    </section>`;

  app.querySelector('[data-action="settings"]').addEventListener('click', showSettings);
  const installSlot = app.querySelector('.install-slot');
  renderInstallBanner(installSlot);
  // Chrome may offer installing a moment after the page loads.
  stopInstallWatch = onInstallChange(() => renderInstallBanner(installSlot));
  if (!store.hasSeenRules()) {
    showRules();
    store.markRulesSeen();
  }
}

/* ------------------------------------------------------------------ *
 * Add to home screen
 * ------------------------------------------------------------------ */

function renderInstallBanner(slot) {
  const mode = installMode();
  if (mode === 'installed' || store.installBannerHidden()) {
    slot.innerHTML = '';
    return;
  }
  slot.innerHTML = `
    <aside class="install" aria-label="Install Laladoku">
      <img class="install__icon" src="icons/icon-192.png" alt="" width="56" height="56">
      <div class="install__text">
        <b>Put Lala on your home screen</b>
        <span>Full screen, plays offline, one tap away.</span>
      </div>
      <button class="btn btn--primary install__go" data-install>${mode === 'prompt' ? 'Install' : 'Show me how'}</button>
      <button class="icon-btn install__close" data-hide-install aria-label="Hide this">${ICONS.close}</button>
    </aside>`;
  slot.querySelector('[data-install]').addEventListener('click', startInstall);
  slot.querySelector('[data-hide-install]').addEventListener('click', () => {
    store.hideInstallBanner();
    slot.innerHTML = '';
  });
}

async function startInstall() {
  const mode = installMode();
  if (mode === 'prompt') await promptInstall();
  else if (mode === 'apple') showAppleInstallSteps();
  else if (mode === 'menu') showMenuInstallSteps();
}

function installStepsHtml(steps) {
  return `<ol class="install-steps">${steps.map(([icon, text]) => `
    <li><span class="install-steps__icon">${icon}</span><span>${text}</span></li>`).join('')}
  </ol>`;
}

function showAppleInstallSteps() {
  openSheet({
    mood: 'wink',
    html: `
      <h2 id="sheet-title" class="sheet__title">Add Lala to your Home Screen</h2>
      <p class="sheet__detail">iPhone and iPad install web apps from the Share menu.</p>
      ${installStepsHtml([
        [ICONS.share, 'Tap the <b>Share</b> button. In Safari it\u2019s in the toolbar; if you don\u2019t see it, tap <b>\u2022\u2022\u2022</b> first. In Chrome it\u2019s in the address bar.'],
        [ICONS.addSquare, 'Scroll down the list and tap <b>Add to Home Screen</b>.'],
        [lalaFace({ mood: 'happy' }), 'Tap <b>Add</b>. Lala\u2019s icon appears on your Home Screen, and the game opens full screen and works offline.'],
      ])}
      <div class="sheet__actions"><button class="btn btn--primary" data-close>Got it</button></div>`,
  });
}

function showMenuInstallSteps() {
  openSheet({
    mood: 'wink',
    html: `
      <h2 id="sheet-title" class="sheet__title">Install Laladoku</h2>
      <p class="sheet__detail">Your browser keeps this in its menu.</p>
      ${installStepsHtml([
        [ICONS.kebab, 'Open the browser menu: <b>\u22ee</b> or <b>\u2022\u2022\u2022</b>, usually at the top or bottom of the screen.'],
        [ICONS.addSquare, 'Choose <b>Install app</b> or <b>Add to Home screen</b>.'],
        [lalaFace({ mood: 'happy' }), 'Confirm. Lala\u2019s icon appears with your other apps, and the game works offline.'],
      ])}
      <div class="sheet__actions"><button class="btn btn--primary" data-close>Got it</button></div>`,
  });
}

/* ------------------------------------------------------------------ *
 * Chapter map
 * ------------------------------------------------------------------ */

async function showMap(token) {
  const index = await loadIndex();
  if (token !== routeToken) return;
  const unlocked = store.highestUnlocked();
  const current = chapterOf(index, Math.min(unlocked, index.total)).chapterIndex;

  const chapters = index.chapters.map((ch, i) => {
    const first = ch.start + 1;
    const levels = Array.from({ length: ch.count }, (_, k) => first + k);
    const won = levels.filter((lv) => store.result(lv)).length;
    const open = first <= unlocked;
    const buttons = levels.map((lv) => {
      const res = store.result(lv);
      if (lv > unlocked) {
        return `<span class="lv lv--locked" aria-label="Level ${lv}, locked">${lv - ch.start}</span>`;
      }
      const stars = res ? `<i class="lv__stars" aria-hidden="true">${'★'.repeat(res.stars)}</i>` : '';
      const label = res ? `Level ${lv}, ${res.stars} stars, best time ${formatTime(res.seconds)}` : `Level ${lv}`;
      return `<a class="lv ${res ? 'lv--done' : 'lv--next'}" href="#/play/${lv}" aria-label="${label}" title="${label}">${lv - ch.start}${stars}</a>`;
    }).join('');

    return `
      <details class="chapter ${open ? '' : 'chapter--locked'}" ${i === current ? 'open' : ''}>
        <summary>
          <span class="chapter__num">${i + 1}</span>
          <span class="chapter__text">
            <b>${ch.name}</b>
            <span>${ch.size}×${ch.size} · ${difficultyWord(ch.maxRank)} · ${won}/${ch.count}</span>
          </span>
          <span class="chapter__bar" style="--done:${won / ch.count}"></span>
          ${open ? '' : `<span class="chapter__lock">${ICONS.lock}</span>`}
        </summary>
        <div class="chapter__levels">${buttons}</div>
      </details>`;
  }).join('');

  app.innerHTML = `
    <section class="screen map">
      <header class="topbar">
        <a class="icon-btn" href="#/" aria-label="Home">${ICONS.back}</a>
        <div class="topbar__title"><span class="eyebrow">${store.totalStars()} ★ collected</span><h1 tabindex="-1">Chapters</h1></div>
        <span class="icon-btn icon-btn--ghost"></span>
      </header>
      <div class="chapters">${chapters}</div>
    </section>`;
  app.querySelector('details[open]')?.scrollIntoView({ block: 'center' });
}

function difficultyWord(maxRank) {
  return ['', 'Gentle', 'Gentle', 'Tricky', 'Hard', 'Expert'][maxRank] || 'Hard';
}

/* ------------------------------------------------------------------ *
 * Campaign level
 * ------------------------------------------------------------------ */

async function showLevel(levelNumber, token) {
  const index = await loadIndex();
  if (!Number.isInteger(levelNumber) || levelNumber < 1 || levelNumber > index.total) {
    go('#/map');
    return;
  }
  if (levelNumber > store.highestUnlocked()) {
    go(`#/play/${store.highestUnlocked()}`);
    return;
  }
  const board = await loadLevel(levelNumber);
  if (token !== routeToken) return;
  const { chapter, position } = chapterOf(index, levelNumber);
  const previous = store.result(levelNumber);
  const bestNote = previous ? ` · best ${formatTime(previous.seconds)}` : '';

  activeGame = new Game(app, {
    board,
    key: `level:${levelNumber}`,
    eyebrow: `${chapter.name} · ${position}/${chapter.count}${bestNote}`,
    title: `Level ${levelNumber}`,
    coach: levelNumber <= COACHED_LEVELS,
    onExit: () => go('#/map'),
    onRules: showRules,
    onSettings: showSettings,
    onLose: () => showLose(`#/play/${levelNumber}`, `level:${levelNumber}`),
    onWin: (result) => {
      store.recordWin(levelNumber, result);
      const nextLevel = levelNumber < index.total ? levelNumber + 1 : null;
      const nextChapter = nextLevel && chapterOf(index, nextLevel).chapter;
      const chapterNote = nextChapter && nextChapter !== chapter
        ? `You finished <b>${chapter.name}</b>! Next up: <b>${nextChapter.name}</b>, ${nextChapter.size}×${nextChapter.size}.`
        : '';
      showWin(result, {
        previousBest: previous?.seconds,
        note: chapterNote,
        next: nextLevel ? `#/play/${nextLevel}` : '#/map',
        nextLabel: nextLevel ? `Level ${nextLevel}` : 'Back to chapters',
        back: '#/map',
      });
    },
  });
}

/* ------------------------------------------------------------------ *
 * Quick Play
 * ------------------------------------------------------------------ */

function showQuickSetup() {
  const solved = store.quickPlaySolved();
  const sizeChips = QUICK_SIZES.map((n, i) => `
    <label class="chip"><input type="radio" name="size" value="${n}" ${i === 1 ? 'checked' : ''}><span>${n}×${n}</span></label>`).join('');
  const tierChips = QUICK_TIERS.map((t, i) => `
    <label class="chip chip--wide"><input type="radio" name="tier" value="${t.id}" ${i === 1 ? 'checked' : ''}>
      <span><b>${t.name}</b><small>${t.note}</small></span></label>`).join('');

  app.innerHTML = `
    <section class="screen quick">
      <header class="topbar">
        <a class="icon-btn" href="#/" aria-label="Home">${ICONS.back}</a>
        <div class="topbar__title"><span class="eyebrow">${solved} solved</span><h1 tabindex="-1">Quick Play</h1></div>
        <span class="icon-btn icon-btn--ghost"></span>
      </header>
      <p class="lede">Lala draws a brand-new board for you. It always has exactly one answer, and you can always reach it by logic.</p>
      <form class="quick__form">
        <fieldset><legend>Board size</legend><div class="chips chips--sizes">${sizeChips}</div></fieldset>
        <fieldset><legend>Difficulty</legend><div class="chips chips--stack">${tierChips}</div></fieldset>
        <button class="btn btn--primary btn--big" type="submit">Draw me a puzzle</button>
      </form>
    </section>`;

  app.querySelector('form').addEventListener('submit', (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const seed = (Math.random() * 2 ** 31) >>> 0;
    go(`#/quick/${form.get('size')}/${form.get('tier')}/${seed}`);
  });
}


function generateQuick(size, tier, seed) {
  quickWorker ??= new Worker(new URL('./quickplay-worker.js', import.meta.url), { type: 'module' });
  const worker = quickWorker;
  const id = `${size}/${tier}/${seed}`;
  return new Promise((resolve, reject) => {
    const onMessage = ({ data }) => {
      if (data.id !== id) return;
      worker.removeEventListener('message', onMessage);
      quickPending = null;
      if (data.error) reject(new Error(data.error));
      else resolve(data.level);
    };
    worker.addEventListener('message', onMessage);
    quickPending = { reject };
    worker.postMessage({ id, size, tier, seed });
  });
}

/**
 * Leaving the drawing screen stops the generator. A worker cannot be
 * interrupted mid-search, so it is closed and a fresh one starts next time.
 */
function cancelQuickGeneration() {
  if (!quickPending) return;
  quickWorker.terminate();
  quickWorker = null;
  quickPending.reject(new Error('cancelled'));
  quickPending = null;
}

async function showQuickGame([, sizeText, tier, seedText], token) {
  const size = Number(sizeText);
  const seed = Number(seedText);
  if (!QUICK_SIZES.includes(size) || !QUICK_TIERS.some((t) => t.id === tier) || !Number.isFinite(seed)) {
    go('#/quick');
    return;
  }
  app.innerHTML = `
    <section class="screen drawing" aria-busy="true">
      <div class="drawing__lala">${lalaFace({ mood: 'wink' })}</div>
      <h1 tabindex="-1">Lala is drawing your puzzle…</h1>
      <p>Placing cats, painting colours, and checking it can be solved by logic.</p>
      ${size >= QUICK_SLOW_SIZE ? '<p class="drawing__note">Big boards take a few seconds, a little longer on a phone.</p>' : ''}
    </section>`;

  let level;
  try {
    level = await generateQuick(size, tier, seed);
  } catch {
    if (token === routeToken) showQuickFailure(size, tier);
    return;
  }
  if (token !== routeToken) return;
  const tierInfo = QUICK_TIERS.find((t) => t.id === tier);
  const replay = () => go(`#/quick/${size}/${tier}/${(Math.random() * 2 ** 31) >>> 0}`);

  activeGame = new Game(app, {
    board: level,
    key: `quick:${size}:${tier}:${seed}`,
    eyebrow: `Quick Play · ${tierInfo.name}`,
    title: `${size}×${size}`,
    coach: false,
    onExit: () => go('#/quick'),
    onRules: showRules,
    onSettings: showSettings,
    onLose: () => showLose(location.hash, `quick:${size}:${tier}:${seed}`),
    onWin: (result) => {
      store.recordQuickPlayWin();
      showWin(result, { next: null, onNext: replay, nextLabel: 'Another one', back: '#/quick' });
    },
  });
}

/* ------------------------------------------------------------------ *
 * Techniques notebook
 * ------------------------------------------------------------------ */


async function showNotebook(token) {
  examplesPromise ??= fetch('levels/examples.json').then((r) => r.json());
  const examples = await examplesPromise;
  if (token !== routeToken) return;

  app.innerHTML = `
    <section class="screen notebook">
      <header class="topbar">
        <a class="icon-btn" href="#/" aria-label="Home">${ICONS.back}</a>
        <div class="topbar__title"><span class="eyebrow">Lala’s notebook</span><h1 tabindex="-1">Techniques</h1></div>
        <span class="icon-btn icon-btn--ghost"></span>
      </header>
      <p class="lede">Every board can be solved with these five tricks, no guessing needed. They go from easy to hard; the later chapters need the later tricks.</p>
      <div class="notebook__rules">${rulesHtml()}</div>
      <ol class="techniques"></ol>
    </section>`;

  const list = app.querySelector('.techniques');
  for (const rank of [1, 2, 3, 4, 5]) {
    const technique = TECHNIQUES[rank];
    const item = document.createElement('li');
    item.className = 'technique';
    item.innerHTML = `
      <div class="technique__head">
        <span class="technique__num">${rank}</span>
        <div><h2>${technique.name}</h2><p class="technique__short">${technique.short}</p></div>
      </div>
      <p>${technique.long}</p>`;
    const example = examples[rank];
    if (example) item.appendChild(exampleFigure(example));
    list.appendChild(item);
  }
}

/** A small read-only board with the technique highlighted on it. */
function exampleFigure(example) {
  const board = decodeLevel({ n: example.n, m: example.m, s: '0'.repeat(example.n) });
  const marks = example.marks.map((row) => Array.from(row, (ch) => (ch === 'c' ? CAT : ch === 'x' ? CROSS : EMPTY)));
  const view = new BoardView(board, { label: 'Example board' });
  const open = candidateGrid(board, marks);
  view.render(marks, marks.map((row, r) => row.map((mark, c) => mark === EMPTY && !open[r][c])));
  const explained = explainHint(example.hint, board, view);
  view.highlight(explained.highlight);

  const figure = document.createElement('figure');
  figure.className = 'example';
  figure.appendChild(view.el);
  const caption = document.createElement('figcaption');
  caption.innerHTML = explained.text;
  figure.appendChild(caption);
  return figure;
}

/* ------------------------------------------------------------------ *
 * Sheets
 * ------------------------------------------------------------------ */

function openSheet({ html, mood = null, onClose = null, dismissable = true }) {
  sheet.innerHTML = `
    <div class="sheet__backdrop" ${dismissable ? 'data-close' : ''}></div>
    <div class="sheet__panel" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
      ${mood ? `<div class="sheet__lala">${lalaFace({ mood })}</div>` : ''}
      ${dismissable ? `<button class="icon-btn sheet__close" data-close aria-label="Close">${ICONS.close}</button>` : ''}
      <div class="sheet__content">${html}</div>
    </div>`;
  sheet.hidden = false;
  sheet.onclick = (e) => {
    if (e.target.closest('[data-close]')) {
      closeSheet();
      onClose?.();
    }
  };
  sheet.onkeydown = (e) => {
    if (e.key === 'Escape' && dismissable) {
      closeSheet();
      onClose?.();
    }
  };
  requestAnimationFrame(() => sheet.classList.add('is-open'));
  sheet.querySelector('.btn, [data-close]')?.focus();
}

function closeSheet() {
  sheet.classList.remove('is-open');
  sheet.hidden = true;
  sheet.innerHTML = '';
}

function rulesHtml() {
  return `
    <ol class="rules">
      <li><span class="rules__icon rules__icon--row"></span><div><b>One cat in every row</b></div></li>
      <li><span class="rules__icon rules__icon--col"></span><div><b>One cat in every column</b></div></li>
      <li><span class="rules__icon rules__icon--colour"></span><div><b>One cat in every colour</b></div></li>
      <li><span class="rules__icon rules__icon--touch"></span><div><b>Cats never touch</b> — not even at the corners</div></li>
    </ol>`;
}

function showRules() {
  openSheet({
    mood: 'wink',
    html: `
      <h2 id="sheet-title" class="sheet__title">How to play</h2>
      ${rulesHtml()}
      <ul class="howto">
        <li>${store.settings().maybeMarks
    ? '<b>Tap</b> a cell to pencil in a maybe-Lala; tap again for a cross, once more to clear.'
    : '<b>Tap</b> a cell to cross it out; tap a cross to clear it.'}</li>
        <li><b>Double-tap</b> quickly to place Lala. Once she\u2019s in the right spot, she stays.</li>
        <li><b>Drag</b> across cells to cross out many at once.</li>
        <li>A cat on a wrong cell costs a paw and leaves a red \u2715 there. You have <b>${STARTING_LIVES} paws</b> and <b>${STARTING_HINTS} hints</b> per board.</li>
        <li>Every board has one answer and can be solved by logic alone. Stuck? The <a href="#/learn">Techniques notebook</a> shows how.</li>
      </ul>
      <div class="sheet__actions"><button class="btn btn--primary" data-close>Let’s play</button></div>`,
  });
}

function formatTime(seconds) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/**
 * The time line on the win sheet. On a replay it compares with the best
 * time from before this win: "New best!" or the best time to beat.
 */
function timeSummary(seconds, previousBest) {
  const time = formatTime(seconds);
  if (previousBest == null) return time;
  if (seconds < previousBest) return `${time} <b class="new-best">New best!</b>`;
  return `${time} (best ${formatTime(previousBest)})`;
}

function showWin(result, { previousBest, note = '', next, onNext, nextLabel, back }) {
  const stars = [1, 2, 3].map((i) =>
    `<span class="star ${i <= result.stars ? 'star--on' : ''}" style="--i:${i}">${ICONS.star}</span>`).join('');
  const detail = [
    timeSummary(result.seconds, previousBest),
    result.mistakes ? `${result.mistakes} slip${result.mistakes > 1 ? 's' : ''}` : 'no slips',
    result.hintsUsed ? `${result.hintsUsed} hint${result.hintsUsed > 1 ? 's' : ''}` : 'no hints',
  ].join(' · ');
  openSheet({
    mood: 'happy',
    dismissable: false,
    html: `
      <h2 id="sheet-title" class="sheet__title">Purr-fect!</h2>
      <div class="stars" aria-label="${result.stars} of 3 stars">${stars}</div>
      <p class="sheet__detail">${detail}</p>
      ${note ? `<p class="sheet__note">${note}</p>` : ''}
      <div class="sheet__actions">
        <button class="btn btn--primary" data-next>${nextLabel}</button>
        <button class="btn btn--quiet" data-back>Back</button>
      </div>`,
  });
  // Stars pop in at 360, 520 and 680 ms (see .star--on in app.css); ring as each lands.
  audio.stars(result.stars, 0.45, 0.16);
  sheet.querySelector('[data-next]').addEventListener('click', () => (onNext ? onNext() : go(next)));
  sheet.querySelector('[data-back]').addEventListener('click', () => go(back));
}

function showLose(retryHash, key) {
  audio.lose();
  openSheet({
    mood: 'sleepy',
    dismissable: false,
    html: `
      <h2 id="sheet-title" class="sheet__title">Out of paws</h2>
      <div class="lose-paws">${pawIcon(false).repeat(STARTING_LIVES)}</div>
      <p class="sheet__detail">Lala needs a little catnap. Every cell can be worked out by logic — try the board again with fresh paws.</p>
      <div class="sheet__actions">
        <button class="btn btn--primary" data-retry>Try again</button>
        <a class="btn btn--quiet" href="#/learn">Read the notebook</a>
      </div>`,
  });
  sheet.querySelector('[data-retry]').addEventListener('click', () => {
    store.clearBoard(key);
    go(retryHash);
  });
}

function showSettings() {
  const s = store.settings();
  const toggle = (key, label, note) => `
    <label class="toggle">
      <span><b>${label}</b><small>${note}</small></span>
      <input type="checkbox" data-setting="${key}" ${s[key] ? 'checked' : ''}>
      <i aria-hidden="true"></i>
    </label>`;
  const themeChips = [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']].map(([value, label]) => `
    <label class="chip"><input type="radio" name="theme" value="${value}" ${s.theme === value ? 'checked' : ''}><span>${label}</span></label>`).join('');

  openSheet({
    // A game on screen picks up changed settings (dots, timer, tap cycle).
    onClose: () => activeGame?.refresh(),
    html: `
      <h2 id="sheet-title" class="sheet__title">Settings</h2>

      <section class="settings-group" aria-labelledby="settings-sound">
        <h3 id="settings-sound">Sound</h3>
        ${toggle('sound', 'Sound effects', 'Ticks, chimes and Lala’s little chirps.')}
        ${toggle('music', 'Music', 'A calm music box that never plays the same tune twice.')}
      </section>

      <section class="settings-group" aria-labelledby="settings-play">
        <h3 id="settings-play">Play</h3>
        ${toggle('maybeMarks', 'Maybe-Lala marks', 'A tap pencils in a Lala silhouette where you think she might go. Tap again for a cross, once more to clear. Drag to cross out cells. Double-tap still places Lala.')}
        ${toggle('shadeBlocked', 'Guide dots', 'Dot the cells a placed Lala already rules out: her row, column, colour and neighbours. Turn off for a purer challenge.')}
        ${toggle('haptics', 'Vibration', 'A small buzz on moves and slips, where supported.')}
      </section>

      <section class="settings-group" aria-labelledby="settings-look">
        <h3 id="settings-look">Look</h3>
        <div class="theme-choice">
          <span class="theme-choice__label" id="theme-label">Theme</span>
          <div class="chips chips--three" role="radiogroup" aria-labelledby="theme-label">${themeChips}</div>
          <small>Auto matches your phone’s light or dark mode.</small>
        </div>
        ${toggle('showTimer', 'Show timer', 'The clock never limits you; it only keeps your best time.')}
      </section>

      <div class="sheet__actions">
        ${installMode() === 'installed' ? '' : '<button class="btn btn--quiet" data-install>Add to Home Screen</button>'}
        <button class="btn btn--quiet" data-reset>Reset progress</button>
        <button class="btn btn--primary" data-close>Done</button>
      </div>`,
  });

  sheet.querySelectorAll('[data-setting]').forEach((input) => {
    input.addEventListener('change', () => {
      store.updateSetting(input.dataset.setting, input.checked);
      if (input.dataset.setting === 'music') audio.setMusic(input.checked);
    });
  });
  sheet.querySelectorAll('input[name="theme"]').forEach((input) => {
    input.addEventListener('change', () => {
      store.updateSetting('theme', input.value);
      applyTheme(input.value);
    });
  });
  sheet.querySelector('[data-install]')?.addEventListener('click', () => {
    closeSheet();
    startInstall();
  });
  sheet.querySelector('[data-reset]').addEventListener('click', (e) => {
    if (e.target.dataset.confirm) {
      store.resetProgress();
      closeSheet();
      go('#/');
    } else {
      e.target.dataset.confirm = 'yes';
      e.target.textContent = 'Tap again to erase all stars';
    }
  });
}

function showQuickFailure(size, tier) {
  app.innerHTML = `
    <section class="screen drawing">
      <div class="drawing__lala">${lalaFace({ mood: 'sleepy' })}</div>
      <h1 tabindex="-1">Lala smudged this one</h1>
      <p>Not every sketch turns into a fair puzzle. She\u2019ll gladly draw another.</p>
      <a class="btn btn--primary" href="#/quick/${size}/${tier}/${(Math.random() * 2 ** 31) >>> 0}">Draw another</a>
      <a class="btn btn--quiet" href="#/quick">Change size</a>
    </section>`;
}

function showError() {
  app.innerHTML = `
    <section class="screen drawing">
      <div class="drawing__lala">${lalaFace({ mood: 'oops' })}</div>
      <h1 tabindex="-1">Something went wrong</h1>
      <p>Lala could not load this page. Check your connection and try again.</p>
      <a class="btn btn--primary" href="#/">Home</a>
    </section>`;
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}
