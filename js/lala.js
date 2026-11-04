/**
 * Lala, drawn in SVG.
 *
 * One drawing serves every size: the large portrait on the home screen, the
 * coach avatar, and the cat token on the board. `mood` changes only the eyes
 * and mouth, so she reads as the same cat everywhere.
 *
 * Colours come from CSS custom properties (see css/app.css) so the art
 * follows the light and dark themes.
 */

const EYES = {
  // Open, round eyes with a highlight.
  calm: `
    <ellipse cx="37" cy="55" rx="5.2" ry="6.4" fill="var(--lala-ink)"/>
    <ellipse cx="63" cy="55" rx="5.2" ry="6.4" fill="var(--lala-ink)"/>
    <circle cx="38.8" cy="52.6" r="1.9" fill="#fff"/>
    <circle cx="64.8" cy="52.6" r="1.9" fill="#fff"/>`,
  // Upturned arcs: a happy squint.
  happy: `
    <path d="M31.5 57 q5.5 -7 11 0" stroke="var(--lala-ink)" stroke-width="3.2" fill="none" stroke-linecap="round"/>
    <path d="M57.5 57 q5.5 -7 11 0" stroke="var(--lala-ink)" stroke-width="3.2" fill="none" stroke-linecap="round"/>`,
  // Closed, drooping lines: sleepy.
  sleepy: `
    <path d="M31.5 55 q5.5 4.5 11 0" stroke="var(--lala-ink)" stroke-width="3" fill="none" stroke-linecap="round"/>
    <path d="M57.5 55 q5.5 4.5 11 0" stroke="var(--lala-ink)" stroke-width="3" fill="none" stroke-linecap="round"/>`,
  // One eye open, one winking.
  wink: `
    <ellipse cx="37" cy="55" rx="5.2" ry="6.4" fill="var(--lala-ink)"/>
    <circle cx="38.8" cy="52.6" r="1.9" fill="#fff"/>
    <path d="M57.5 56 q5.5 -6 11 0" stroke="var(--lala-ink)" stroke-width="3.2" fill="none" stroke-linecap="round"/>`,
  // Wide, startled eyes for a wrong move.
  oops: `
    <circle cx="37" cy="55" r="6.6" fill="#fff" stroke="var(--lala-ink)" stroke-width="2.4"/>
    <circle cx="63" cy="55" r="6.6" fill="#fff" stroke="var(--lala-ink)" stroke-width="2.4"/>
    <circle cx="37" cy="56" r="2.8" fill="var(--lala-ink)"/>
    <circle cx="63" cy="56" r="2.8" fill="var(--lala-ink)"/>`,
};

const MOUTHS = {
  calm: '<path d="M44 70 q3 3.2 6 0 q3 3.2 6 0" stroke="var(--lala-ink)" stroke-width="2.2" fill="none" stroke-linecap="round"/>',
  happy: '<path d="M43 69 q7 9 14 0 z" fill="var(--lala-mouth)" stroke="var(--lala-ink)" stroke-width="2.2" stroke-linejoin="round"/>',
  sleepy: '<path d="M46 71 q4 1.6 8 0" stroke="var(--lala-ink)" stroke-width="2.2" fill="none" stroke-linecap="round"/>',
  wink: '<path d="M44 70 q3 3.2 6 0 q3 3.2 6 0" stroke="var(--lala-ink)" stroke-width="2.2" fill="none" stroke-linecap="round"/>',
  oops: '<ellipse cx="50" cy="72" rx="3.4" ry="4" fill="var(--lala-mouth)" stroke="var(--lala-ink)" stroke-width="2"/>',
};

/**
 * Lala's head.
 *   mood      calm | happy | sleepy | wink | oops
 *   whiskers  false for the small board token, where they would blur
 *   label     accessible name; omit for decorative use
 */
export function lalaFace({ mood = 'calm', whiskers = true, label = '' } = {}) {
  const a11y = label
    ? `role="img" aria-label="${label}"`
    : 'aria-hidden="true" focusable="false"';
  const whiskerLines = whiskers ? `
    <g stroke="var(--lala-ink)" stroke-width="1.6" stroke-linecap="round" opacity=".75">
      <path d="M24 64 l-15 -3"/><path d="M24 68.5 l-15 2.5"/>
      <path d="M76 64 l15 -3"/><path d="M76 68.5 l15 2.5"/>
    </g>` : '';

  return `<svg class="lala" viewBox="0 0 100 100" ${a11y}>
    <g stroke="var(--lala-ink)" stroke-width="3" stroke-linejoin="round">
      <path d="M17 47 L21 12 Q22 9 25 11 L46 27 Z" fill="var(--lala-fur)"/>
      <path d="M83 47 L79 12 Q78 9 75 11 L54 27 Z" fill="var(--lala-fur)"/>
    </g>
    <path d="M23.5 37 L25.5 18 L39 28 Z" fill="var(--lala-ear)"/>
    <path d="M76.5 37 L74.5 18 L61 28 Z" fill="var(--lala-ear)"/>
    <ellipse cx="50" cy="58" rx="38" ry="32" fill="var(--lala-fur)" stroke="var(--lala-ink)" stroke-width="3"/>
    <g fill="var(--lala-stripe)">
      <path d="M44 27 q2 9 0 13 q-3 -6 0 -13z"/>
      <path d="M50 26 q2.4 10 0 15 q-2.4 -5 0 -15z"/>
      <path d="M56 27 q3 7 0 13 q-2 -4 0 -13z"/>
      <path d="M13 54 q8 1 12 4 q-7 1 -12 -4z"/>
      <path d="M14 63 q7 -1 10 1 q-6 3 -10 -1z"/>
      <path d="M87 54 q-8 1 -12 4 q7 1 12 -4z"/>
      <path d="M86 63 q-7 -1 -10 1 q6 3 10 -1z"/>
    </g>
    <ellipse cx="50" cy="71" rx="15" ry="11" fill="var(--lala-muzzle)"/>
    <ellipse cx="27" cy="66" rx="5.5" ry="3.4" fill="var(--lala-blush)"/>
    <ellipse cx="73" cy="66" rx="5.5" ry="3.4" fill="var(--lala-blush)"/>
    ${EYES[mood] || EYES.calm}
    <path d="M46.5 63.5 h7 l-3.5 4 z" fill="var(--lala-nose)" stroke="var(--lala-ink)" stroke-width="1.6" stroke-linejoin="round"/>
    ${MOUTHS[mood] || MOUTHS.calm}
    ${whiskerLines}
  </svg>`;
}

/** A "maybe Lala here" note: her head as a soft, flat silhouette. */
export const MAYBE_SVG = `<svg class="maybe" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
  <path d="M17 47 L21 12 Q22 9 25 11 L44 26 Q50 25 56 26 L75 11 Q78 9 79 12 L83 47 Q88 54 88 58 C88 76 71 90 50 90 C29 90 12 76 12 58 Q12 54 17 47 Z"/>
</svg>`;

/** The cross mark: two slightly uneven ink strokes, like a pencil tick. */
export const CROSS_SVG = `<svg class="cross" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
  <path d="M6.5 6.8 L17.4 17.2" /><path d="M17.2 6.4 L6.8 17.5" />
</svg>`;

/**
 * One of Lala's paw prints, used for lives: a rounded main pad and four toe
 * beans fanned around it. A lost life keeps only a faint dashed outline.
 */
export function pawIcon(filled = true) {
  return `<svg class="paw ${filled ? '' : 'paw--lost'}" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
    <path class="paw__pad" d="M16 13.6c-3.9 0-8.6 5-8.6 9 0 2.9 2.1 4.2 4.5 4.2 1.7 0 2.7-.9 4.1-.9s2.4.9 4.1.9c2.4 0 4.5-1.3 4.5-4.2 0-4-4.7-9-8.6-9z"/>
    <ellipse class="paw__bean" cx="6.6" cy="12.4" rx="2.6" ry="3.4" transform="rotate(-24 6.6 12.4)"/>
    <ellipse class="paw__bean" cx="12" cy="7.3" rx="2.7" ry="3.5" transform="rotate(-8 12 7.3)"/>
    <ellipse class="paw__bean" cx="20" cy="7.3" rx="2.7" ry="3.5" transform="rotate(8 20 7.3)"/>
    <ellipse class="paw__bean" cx="25.4" cy="12.4" rx="2.6" ry="3.4" transform="rotate(24 25.4 12.4)"/>
  </svg>`;
}

/** Small line icons for the tool buttons. */
export const ICONS = {
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5 8 12l7 7"/></svg>',
  undo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>',
  bulb: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.4 1.1 2.2h5c0-.8.4-1.6 1.1-2.2A6 6 0 0 0 12 3z"/></svg>',
  eraser: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 21-4-4 11-11 7 7-8 8z"/><path d="M7 21h13"/><path d="m9.5 10.5 7 7"/></svg>',
  book: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5"/></svg>',
  gear: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/></svg>',
  dice: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="4"/><circle cx="8.5" cy="8.5" r="1.2"/><circle cx="15.5" cy="15.5" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="15.5" cy="8.5" r="1.2"/><circle cx="8.5" cy="15.5" r="1.2"/></svg>',
  map: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 4-6 2.5v13.5l6-2.5 6 2.5 6-2.5V4l-6 2.5z"/><path d="M9 4v13.5M15 6.5V20"/></svg>',
  lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9.5 2.5h5"/></svg>',
  share: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7.5 7.5 12 3l4.5 4.5"/><path d="M8 10H6.5A1.5 1.5 0 0 0 5 11.5v8A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-8a1.5 1.5 0 0 0-1.5-1.5H16"/></svg>',
  addSquare: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8.5v7M8.5 12h7"/></svg>',
  dots: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="18" cy="12" r="1.4"/></svg>',
  kebab: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="6" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="18" r="1.4"/></svg>',
  star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.8l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8z"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
};
