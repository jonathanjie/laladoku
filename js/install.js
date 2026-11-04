/**
 * Installing Laladoku on the home screen.
 *
 * Browsers differ:
 *   - Chrome, Edge and Samsung Internet fire `beforeinstallprompt`. We keep
 *     that event and show our own Install button, which opens the browser's
 *     install dialog.
 *   - Safari on iPhone and iPad has no such event; websites cannot open the
 *     dialog. We show the steps instead: Share, then Add to Home Screen.
 *   - Other browsers get short menu instructions.
 * Once the game runs from the home screen, nothing is shown.
 */

let deferredPrompt = null;
const listeners = new Set();

function notify() {
  for (const listener of listeners) listener();
}

window.addEventListener('beforeinstallprompt', (event) => {
  // Stop the browser's own mini bar; our button will open the dialog.
  event.preventDefault();
  deferredPrompt = event;
  notify();
});

window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  notify();
});

/** Call `listener` whenever the install options change. Returns an unsubscribe function. */
export function onInstallChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** True when the game is already running as an installed app. */
export function isInstalled() {
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

/** iPhone, iPod or iPad. iPadOS reports itself as a Mac, so check for touch too. */
export function isAppleMobile() {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/**
 * How this browser installs apps:
 *   'installed'  already on the home screen
 *   'prompt'     we can open the install dialog ourselves
 *   'apple'      Safari: Share, then Add to Home Screen
 *   'menu'       anything else: the browser's own menu
 */
export function installMode() {
  if (isInstalled()) return 'installed';
  if (deferredPrompt) return 'prompt';
  if (isAppleMobile()) return 'apple';
  return 'menu';
}

/** Open the browser's install dialog. Resolves to true if the player accepted. */
export async function promptInstall() {
  if (!deferredPrompt) return false;
  const event = deferredPrompt;
  deferredPrompt = null;
  event.prompt();
  const { outcome } = await event.userChoice;
  notify();
  return outcome === 'accepted';
}
