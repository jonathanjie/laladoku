/**
 * Light and dark themes.
 *
 * The player picks Auto, Light or Dark in Settings. Auto follows the device
 * and keeps following it if the device switches (for example at sunset).
 * The chosen theme is written to <html data-theme>, which css/app.css reads;
 * an inline script in index.html applies it before the first paint.
 */
const deviceDark = window.matchMedia('(prefers-color-scheme: dark)');
let currentChoice = 'auto';

/** Browser chrome colour per theme: the paper colour of each. */
const CHROME_COLOURS = { light: '#fbf3e6', dark: '#1e1a22' };

function resolve(choice) {
  if (choice === 'light' || choice === 'dark') return choice;
  return deviceDark.matches ? 'dark' : 'light';
}

export function applyTheme(choice = 'auto') {
  currentChoice = choice;
  const theme = resolve(choice);
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', CHROME_COLOURS[theme]);
}

deviceDark.addEventListener('change', () => {
  if (currentChoice === 'auto') applyTheme('auto');
});
