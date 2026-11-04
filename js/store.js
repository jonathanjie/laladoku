/**
 * Persistence: progress, settings and the in-progress board.
 *
 * Everything lives in localStorage on the device. No accounts, no network,
 * no analytics. If storage is blocked (private mode, full disk) the game
 * still works for the session; it just forgets on reload.
 */

const KEY = 'laladoku.v2';

const DEFAULTS = {
  // Campaign results by level number: { stars, seconds }.
  completed: {},
  quickPlaySolved: 0,
  seenRules: false,
  // The player closed the "add to home screen" banner on the home screen.
  installBannerHidden: false,
  settings: {
    // Shade cells that a placed cat already rules out.
    shadeBlocked: true,
    haptics: true,
    showTimer: true,
  },
  // One board in progress at a time: { key, marks, lives, hintsLeft, elapsed, history }.
  save: null,
};

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULTS);
    const parsed = JSON.parse(raw);
    return {
      ...structuredClone(DEFAULTS),
      ...parsed,
      settings: { ...DEFAULTS.settings, ...(parsed.settings || {}) },
    };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

const state = read();

function write() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Storage blocked or full: keep playing from memory.
  }
}

export function settings() {
  return state.settings;
}

export function updateSetting(key, value) {
  state.settings[key] = value;
  write();
}

export function installBannerHidden() {
  return state.installBannerHidden;
}

export function hideInstallBanner() {
  state.installBannerHidden = true;
  write();
}

export function hasSeenRules() {
  return state.seenRules;
}

export function markRulesSeen() {
  state.seenRules = true;
  write();
}

/** Record a campaign win, keeping the best stars and the fastest time. */
export function recordWin(level, { stars, seconds }) {
  const previous = state.completed[level];
  state.completed[level] = previous
    ? { stars: Math.max(previous.stars, stars), seconds: Math.min(previous.seconds, seconds) }
    : { stars, seconds };
  write();
}

export function recordQuickPlayWin() {
  state.quickPlaySolved++;
  write();
}

export function quickPlaySolved() {
  return state.quickPlaySolved;
}

export function result(level) {
  return state.completed[level] || null;
}

/** The furthest level the player may open: one past the highest level won. */
export function highestUnlocked() {
  const won = Object.keys(state.completed).map(Number);
  return won.length ? Math.max(...won) + 1 : 1;
}

export function totalStars() {
  return Object.values(state.completed).reduce((sum, r) => sum + r.stars, 0);
}

export function saveBoard(snapshot) {
  state.save = snapshot;
  write();
}

export function loadBoard(key) {
  return state.save && state.save.key === key ? state.save : null;
}

export function clearBoard(key) {
  if (state.save && state.save.key === key) {
    state.save = null;
    write();
  }
}

export function resetProgress() {
  Object.assign(state, structuredClone(DEFAULTS), { settings: state.settings, seenRules: true });
  write();
}
