/**
 * Laladoku audio. Every sound is synthesized with the Web Audio API, so the
 * game ships no audio files and plays offline.
 *
 * Three layers:
 *   createMixer  the signal chain: effect and music buses, a shared reverb,
 *                and a limiter so stacked sounds never clip.
 *   SoundKit     one method per sound effect, each scheduled at a given
 *                time on any AudioContext (live or offline, for previews).
 *   MusicBox     calm generative background music in C major: soft pad
 *                chords, a gentle bass and a music-box melody that is never
 *                the same twice.
 * The `audio` object at the bottom ties them to the player's settings and to
 * the browser's rule that sound may only start after a tap or key press.
 */
import { settings } from './store.js';

/* ------------------------------------------------------------------ *
 * Pitch helpers
 * ------------------------------------------------------------------ */

/** Frequency of a MIDI note number (69 = A4 = 440 Hz). */
export function hz(midi) {
  return 440 * 2 ** ((midi - 69) / 12);
}

/** MIDI note numbers for the notes the cats play. */
const C5 = 72, D5 = 74, E5 = 76, G5 = 79, A5 = 81, C6 = 84;

/**
 * Each cat placed plays the next note of the refrain of "Jesus Loves Me"
 * (William B. Bradbury, 1862, public domain), in C major as most hymnals
 * print it. Two phrases of five notes cover a 10x10 board:
 *
 *   "Yes, Je - sus loves me"   G  E  G  A  C'
 *   "Yes, Je - sus loves me"   G  E  C  E  D
 *
 * A 5x5 board plays the first phrase and ends on the high C.
 */
const CAT_NOTES = [
  G5, E5, G5, A5, C6,
  G5, E5, C5, E5, D5,
];

/* ------------------------------------------------------------------ *
 * Mixer
 * ------------------------------------------------------------------ */

/** A stereo impulse response: decaying noise, which sounds like a small room. */
function makeReverbImpulse(ctx, seconds = 2.2) {
  const length = Math.floor(ctx.sampleRate * seconds);
  const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = impulse.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      const fade = (1 - i / length) ** 3;
      data[i] = (Math.random() * 2 - 1) * fade;
    }
  }
  return impulse;
}

/** Music bus level when playing; effects sit on top of it. */
const MUSIC_LEVEL = 0.32;

export function createMixer(ctx) {
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -10;
  limiter.knee.value = 6;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.2;
  limiter.connect(ctx.destination);

  const master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(limiter);

  const sfx = ctx.createGain();
  sfx.gain.value = 0.8;
  sfx.connect(master);

  const music = ctx.createGain();
  music.gain.value = MUSIC_LEVEL;
  music.connect(master);

  const reverb = ctx.createConvolver();
  reverb.buffer = makeReverbImpulse(ctx);
  const reverbReturn = ctx.createGain();
  reverbReturn.gain.value = 0.5;
  reverb.connect(reverbReturn);
  reverbReturn.connect(master);

  // One second of white noise, reused by every noisy sound.
  const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const noiseData = noise.getChannelData(0);
  for (let i = 0; i < noiseData.length; i++) noiseData[i] = Math.random() * 2 - 1;

  return { ctx, master, sfx, music, reverb, noise };
}

/* ------------------------------------------------------------------ *
 * Voices: small building blocks shared by effects and music
 * ------------------------------------------------------------------ */

/**
 * A gain node that fades in over `attack` and decays exponentially to
 * silence over `decay` seconds. Exponential ramps cannot reach zero, so the
 * envelope ends at a level far below hearing.
 */
function envelope(ctx, start, { peak, attack = 0.005, decay }) {
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + attack + decay);
  return gain;
}

/** Send a node to `dest`, plus some of it to the reverb. */
function route(mixer, node, dest, reverbAmount) {
  node.connect(dest);
  if (reverbAmount > 0) {
    const send = mixer.ctx.createGain();
    send.gain.value = reverbAmount;
    node.connect(send);
    send.connect(mixer.reverb);
  }
}

/**
 * A music-box bell: a sine fundamental plus two quieter, faster-fading
 * partials. The slightly stretched upper partials give a metallic ring.
 */
function bell(mixer, start, freq, { gain = 0.25, decay = 1.2, dest = mixer.sfx, reverb = 0.3 } = {}) {
  const { ctx } = mixer;
  const partials = [
    { ratio: 1, level: 1, decay },
    { ratio: 2.01, level: 0.28, decay: decay * 0.5 },
    { ratio: 3.98, level: 0.12, decay: decay * 0.25 },
  ];
  for (const p of partials) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq * p.ratio;
    const env = envelope(ctx, start, { peak: gain * p.level, attack: 0.004, decay: p.decay });
    osc.connect(env);
    route(mixer, env, dest, reverb);
    osc.start(start);
    osc.stop(start + p.decay + 0.05);
  }
}

/** A short burst of filtered noise: pencil ticks and soft rubs. */
function noiseBurst(mixer, start, { duration, freq, q = 1, gain, dest = mixer.sfx, reverb = 0 }) {
  const { ctx } = mixer;
  const source = ctx.createBufferSource();
  source.buffer = mixer.noise;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = freq;
  filter.Q.value = q;
  const env = envelope(ctx, start, { peak: gain, attack: 0.002, decay: duration });
  source.connect(filter);
  filter.connect(env);
  route(mixer, env, dest, reverb);
  // Start at a random point in the buffer so repeated ticks differ slightly.
  source.start(start, Math.random() * 0.8);
  source.stop(start + duration + 0.05);
}

/** A plain oscillator note with an optional pitch glide. Returns the oscillator. */
function tone(mixer, start, {
  freq, glideTo = null, glideTime = 0.1, type = 'sine', gain, attack = 0.005, decay,
  dest = mixer.sfx, reverb = 0,
}) {
  const { ctx } = mixer;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, start + glideTime);
  const env = envelope(ctx, start, { peak: gain, attack, decay });
  osc.connect(env);
  route(mixer, env, dest, reverb);
  osc.start(start);
  osc.stop(start + attack + decay + 0.05);
  return osc;
}

/* ------------------------------------------------------------------ *
 * Sound effects
 * ------------------------------------------------------------------ */

export class SoundKit {
  constructor(mixer) {
    this.mixer = mixer;
  }

  /** Crossing out a cell: a pencil tick. */
  cross(t) {
    noiseBurst(this.mixer, t, { duration: 0.045, freq: 3200 + Math.random() * 600, q: 1.4, gain: 0.5 });
    tone(this.mixer, t, { freq: 1900, gain: 0.05, decay: 0.03 });
  }

  /** Painting crosses by dragging: a lighter tick, played often. */
  paint(t) {
    noiseBurst(this.mixer, t, { duration: 0.03, freq: 3600 + Math.random() * 800, q: 1.6, gain: 0.3 });
  }

  /** Pencilling in a maybe-Lala: a quiet, high pip. */
  maybe(t) {
    bell(this.mixer, t, hz(91), { gain: 0.07, decay: 0.25, reverb: 0.2 });
  }

  /** Clearing a cell or undoing: a soft, low rub. */
  erase(t) {
    noiseBurst(this.mixer, t, { duration: 0.07, freq: 1400, q: 0.8, gain: 0.32 });
  }

  /** A cat placed: the next note of the refrain (CAT_NOTES), so a solve plays the tune. */
  cat(t, catNumber) {
    const index = Math.min(Math.max(catNumber - 1, 0), CAT_NOTES.length - 1);
    bell(this.mixer, t, hz(CAT_NOTES[index]), { gain: 0.32, decay: 1.1, reverb: 0.35 });
    // A soft "pop" underneath, so the placement feels physical.
    tone(this.mixer, t, { freq: 240, glideTo: 520, glideTime: 0.05, type: 'triangle', gain: 0.12, decay: 0.08 });
  }

  /** A cat on a wrong cell: a gentle low bonk and two falling notes. */
  wrong(t) {
    tone(this.mixer, t, { freq: 170, glideTo: 60, glideTime: 0.18, gain: 0.5, decay: 0.22 });
    tone(this.mixer, t + 0.02, { freq: hz(64), type: 'triangle', gain: 0.16, decay: 0.18 });
    tone(this.mixer, t + 0.13, { freq: hz(60), type: 'triangle', gain: 0.16, decay: 0.3 });
  }

  /** A hint appears: a two-note sparkle. */
  hint(t) {
    bell(this.mixer, t, hz(81), { gain: 0.18, decay: 0.9, reverb: 0.6 });
    bell(this.mixer, t + 0.09, hz(88), { gain: 0.15, decay: 1.1, reverb: 0.6 });
  }

  /** Lala's chirp: a short rolled "mrrp" that rises at the end. */
  chirp(t) {
    const { ctx } = this.mixer;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(420, t);
    osc.frequency.exponentialRampToValueAtTime(560, t + 0.1);
    osc.frequency.exponentialRampToValueAtTime(880, t + 0.22);
    osc.frequency.exponentialRampToValueAtTime(760, t + 0.3);

    // The rolled "rr": a fast tremolo that fades out over the first part.
    const tremolo = ctx.createGain();
    tremolo.gain.setValueAtTime(0.5, t);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 32;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.setValueAtTime(0.5, t);
    lfoDepth.gain.linearRampToValueAtTime(0, t + 0.16);
    lfo.connect(lfoDepth);
    lfoDepth.connect(tremolo.gain);

    // A vowel-like resonance, so it reads as a voice rather than a whistle.
    const formant = ctx.createBiquadFilter();
    formant.type = 'bandpass';
    formant.frequency.setValueAtTime(1100, t);
    formant.frequency.linearRampToValueAtTime(1700, t + 0.25);
    formant.Q.value = 1.2;

    const env = envelope(ctx, t, { peak: 0.55, attack: 0.03, decay: 0.3 });
    osc.connect(tremolo);
    tremolo.connect(formant);
    formant.connect(env);
    route(this.mixer, env, this.mixer.sfx, 0.25);
    osc.start(t);
    lfo.start(t);
    osc.stop(t + 0.4);
    lfo.stop(t + 0.4);
  }

  /** The board is solved: a rising arpeggio, a soft chord, and Lala's chirp. */
  win(t) {
    [72, 76, 79, 84, 88].forEach((note, i) => {
      bell(this.mixer, t + i * 0.09, hz(note), { gain: 0.24, decay: 1.4, reverb: 0.45 });
    });
    for (const note of [60, 64, 67]) {
      tone(this.mixer, t + 0.45, {
        freq: hz(note), type: 'triangle', gain: 0.07, attack: 0.04, decay: 1.6, reverb: 0.4,
      });
    }
    this.chirp(t + 0.7);
  }

  /** One star landing on the win sheet; later stars ring higher. */
  star(t, index) {
    bell(this.mixer, t, hz([84, 88, 91][index] ?? 91), { gain: 0.2, decay: 0.8, reverb: 0.5 });
  }

  /** Out of lives: three slow falling notes and a sleepy yawn. */
  lose(t) {
    [67, 64, 60].forEach((note, i) => {
      bell(this.mixer, t + i * 0.32, hz(note), { gain: 0.22, decay: 1.2, reverb: 0.5 });
    });
    tone(this.mixer, t + 1.05, {
      freq: 520, glideTo: 260, glideTime: 0.8, type: 'triangle', gain: 0.1, attack: 0.15, decay: 0.75, reverb: 0.3,
    });
  }
}

/* ------------------------------------------------------------------ *
 * Background music
 * ------------------------------------------------------------------ */

/*
 * The music follows a small piece of song-writing craft:
 *
 *   Form      AABA, 8 bars per section, 32 bars in all (about 1:47). After
 *             each form, new motifs and chords are drawn.
 *   Period    each 8-bar section is a question and an answer. The question
 *             phrase ends on G (the V chord), which sounds unfinished; the
 *             answer starts the same way and ends G -> C (V -> I), with the
 *             melody stepping home to C. Section B travels away and ends on
 *             G, which leads back into the last A.
 *   Phrase    4 bars: the motif, the motif one scale step higher or lower
 *             (a "sequence"), the motif upside down, then the cadence note.
 *   Harmony   strong beats (1 and 3) land on a note of the current chord;
 *             the bass plays the chord's root, then its fifth.
 *   Scale     the melody uses only C major pentatonic (C D E G A), which has
 *             no half steps and so never clashes with any chord in the key.
 */

/**
 * Chords in C major. `bass` is the bass root, `pad` the held chord, and
 * `tones` the pitch classes (0 = C, 2 = D, ...) a melody may land on.
 */
const CHORDS = {
  C: { bass: 48, pad: [60, 64, 67], tones: [0, 4, 7] },
  Dm: { bass: 50, pad: [57, 62, 65], tones: [2, 5, 9] },
  Em: { bass: 52, pad: [55, 59, 64], tones: [4, 7, 11] },
  F: { bass: 41, pad: [57, 60, 65], tones: [5, 9, 0] },
  G: { bass: 43, pad: [55, 59, 62], tones: [7, 11, 2] },
  Am: { bass: 45, pad: [57, 60, 64], tones: [9, 0, 4] },
};

/** Question phrases end on G (V): the music pauses, unresolved. */
const QUESTIONS = [['C', 'Am', 'F', 'G'], ['C', 'F', 'Dm', 'G'], ['Am', 'F', 'C', 'G'], ['F', 'C', 'Dm', 'G']];
/** Answer phrases end G -> C (V -> I): the music comes home. */
const ANSWERS = [['C', 'Am', 'G', 'C'], ['F', 'Dm', 'G', 'C'], ['Am', 'F', 'G', 'C'], ['C', 'F', 'G', 'C']];
/** The bridge (section B) starts away from home ... */
const BRIDGE_QUESTIONS = [['F', 'G', 'Em', 'Am'], ['Dm', 'Em', 'F', 'Am']];
/** ... and ends on G, so the last A feels like a return. */
const BRIDGE_ANSWERS = [['F', 'Dm', 'Em', 'G'], ['Dm', 'Em', 'F', 'G']];

const FORM = ['A', 'A', 'B', 'A'];
const BARS_PER_PHRASE = 4;
const BARS_PER_PERIOD = 8;
const BARS_PER_FORM = FORM.length * BARS_PER_PERIOD;

/** Melody notes: C major pentatonic from G4 to E6. */
export const MELODY_NOTES = [67, 69, 72, 74, 76, 79, 81, 84, 86, 88];
const PENTATONIC_CLASSES = [0, 2, 4, 7, 9];

/**
 * One-bar rhythms, as eighth notes (1 = a note starts). Every rhythm starts
 * on the downbeat and leaves a breath at the end of the bar.
 */
const RHYTHMS = [
  [1, 0, 1, 0, 1, 0, 0, 0], // three even steps, then a breath
  [1, 0, 0, 1, 1, 0, 1, 0], // long-short: a gentle lilt
  [1, 1, 1, 0, 1, 0, 0, 0], // a quick run into beat 3
  [1, 0, 1, 1, 1, 0, 0, 0],
  [1, 0, 0, 0, 1, 0, 1, 0], // sparse, for calm phrases
  [1, 0, 1, 0, 1, 0, 1, 0], // walking quarter notes
];
/** Melodic moves in scale steps; mostly small steps, the odd leap. */
const MOVES = [-1, -1, 1, 1, -2, 2, 0];
/** How loud each bar of a phrase is: a small swell toward bar 3. */
const PHRASE_ARCH = [0.92, 1, 1.08, 0.95];

const BEATS_PER_MINUTE = 72;
const EIGHTHS_PER_BAR = 8;
const STRONG_STEPS = [0, 4];

export const pitchClass = (midi) => ((midi % 12) + 12) % 12;
const pick = (random, list) => list[Math.floor(random() * list.length)];
const clampIndex = (i) => Math.min(MELODY_NOTES.length - 1, Math.max(0, i));

/** The melody note nearest to `index` whose pitch class is in `classes`. */
function nearestIndexIn(index, classes) {
  for (let distance = 0; distance < MELODY_NOTES.length; distance++) {
    for (const candidate of [index - distance, index + distance]) {
      if (candidate < 0 || candidate >= MELODY_NOTES.length) continue;
      if (classes.includes(pitchClass(MELODY_NOTES[candidate]))) return candidate;
    }
  }
  return index;
}

export class MusicBox {
  constructor(mixer, random = Math.random) {
    this.mixer = mixer;
    this.random = random;
    this.melodyIndex = 3;
    this.form = null;
  }

  get eighth() {
    return 60 / BEATS_PER_MINUTE / 2;
  }

  get barLength() {
    return this.eighth * EIGHTHS_PER_BAR;
  }

  /** A motif: one bar of rhythm, the moves between its notes, and where it starts. */
  newMotif(startIndex) {
    const rhythm = pick(this.random, RHYTHMS);
    const onsets = rhythm.reduce((count, hit) => count + hit, 0);
    const moves = Array.from({ length: onsets - 1 }, () => pick(this.random, MOVES));
    return { rhythm, moves, startIndex, shift: pick(this.random, [-1, 1, 1, 2]) };
  }

  /** Draw the motifs and chords for the next 32 bars. */
  newForm() {
    this.form = {
      A: {
        motif: this.newMotif(pick(this.random, [3, 4])),
        question: pick(this.random, QUESTIONS),
        answer: pick(this.random, ANSWERS),
      },
      B: {
        motif: this.newMotif(pick(this.random, [5, 6])),
        question: pick(this.random, BRIDGE_QUESTIONS),
        answer: pick(this.random, BRIDGE_ANSWERS),
      },
    };
  }

  /**
   * Compose bar number `bar` (counting from 0). Returns a plan, so the
   * music can be checked without playing it:
   *   { section, isAnswer, barInPhrase, chord, bass: [{ step, midi, decay }],
   *     melody: [{ step, midi, gain, decay }] }
   */
  composeBar(bar) {
    const formBar = bar % BARS_PER_FORM;
    if (formBar === 0 || !this.form) this.newForm();

    const section = FORM[Math.floor(formBar / BARS_PER_PERIOD)];
    const withinPeriod = formBar % BARS_PER_PERIOD;
    const isAnswer = withinPeriod >= BARS_PER_PHRASE;
    const barInPhrase = withinPeriod % BARS_PER_PHRASE;
    const { motif, question, answer } = this.form[section];
    const chordName = (isAnswer ? answer : question)[barInPhrase];
    const chord = CHORDS[chordName];
    const arch = PHRASE_ARCH[barInPhrase];
    const isCadence = barInPhrase === BARS_PER_PHRASE - 1;
    const goesHome = section === 'A' && isAnswer;

    const melody = [];
    const playNote = (step, index, { gain, decay = 1.6 }) => {
      this.melodyIndex = index;
      melody.push({ step, midi: MELODY_NOTES[index], gain: gain * arch, decay });
    };

    if (!isCadence) {
      // Bar 1: the motif. Bar 2: the motif, shifted a step (a sequence).
      // Bar 3: the motif upside down, carrying on from where bar 2 ended.
      const inverted = barInPhrase === 2;
      let index = barInPhrase === 0 ? motif.startIndex
        : barInPhrase === 1 ? motif.startIndex + motif.shift
          : this.melodyIndex;
      let moveNumber = 0;
      motif.rhythm.forEach((hit, step) => {
        if (!hit) return;
        if (moveNumber > 0) index += (inverted ? -1 : 1) * motif.moves[moveNumber - 1];
        moveNumber++;
        index = clampIndex(index);
        const strong = STRONG_STEPS.includes(step);
        // Strong beats sit on a note of the chord, so the tune agrees with
        // the harmony where the ear listens hardest.
        if (strong) index = nearestIndexIn(index, chord.tones);
        playNote(step, index, { gain: strong ? 0.2 : 0.13 });
      });
    } else {
      // The cadence: one long note on the downbeat. Coming home, it is C;
      // otherwise the nearest note of the chord, which sounds open.
      const goal = nearestIndexIn(this.melodyIndex, goesHome ? [0] : chord.tones);
      playNote(0, goal, { gain: 0.2, decay: 2.6 });
      // A question leads on with a soft pickup note into the next phrase.
      if (!goesHome) {
        const nextStart = isAnswer ? this.nextSectionStart(formBar) : motif.startIndex;
        playNote(6, clampIndex(nextStart + (nextStart > goal ? -1 : 1)), { gain: 0.11 });
      }
    }

    // Bass: the root on beat 1 and the fifth on beat 3; a cadence holds the root.
    const bass = isCadence
      ? [{ step: 0, midi: chord.bass, decay: 2.4 }]
      : [{ step: 0, midi: chord.bass, decay: 1.4 }, { step: 4, midi: chord.bass + 7, decay: 1.2 }];

    return { section, isAnswer, barInPhrase, chord: chordName, pad: chord.pad, bass, melody };
  }

  /** Where the next section's motif starts, for a pickup leading into it. */
  nextSectionStart(formBar) {
    const nextPeriod = Math.floor(formBar / BARS_PER_PERIOD) + 1;
    const nextSection = FORM[nextPeriod % FORM.length];
    return this.form[nextSection].motif.startIndex;
  }

  /** Compose bar `bar` and schedule it to start at time `t`. */
  scheduleBar(bar, t) {
    const { mixer } = this;
    const plan = this.composeBar(bar);

    // Pad: the chord with a slow attack, as softly detuned pairs for warmth.
    for (const note of plan.pad) {
      for (const cents of [-6, 6]) {
        const osc = tone(mixer, t, {
          freq: hz(note), type: 'triangle', gain: 0.035, attack: 0.9,
          decay: this.barLength + 0.8, dest: mixer.music, reverb: 0.5,
        });
        osc.detune.value = cents;
      }
    }
    for (const note of plan.bass) {
      tone(mixer, t + note.step * this.eighth, {
        freq: hz(note.midi), gain: 0.22, attack: 0.02, decay: note.decay, dest: mixer.music,
      });
    }
    for (const note of plan.melody) {
      bell(mixer, t + note.step * this.eighth, hz(note.midi), {
        gain: note.gain, decay: note.decay, dest: mixer.music, reverb: 0.55,
      });
    }
  }
}

export { PENTATONIC_CLASSES, CHORDS };

/* ------------------------------------------------------------------ *
 * Live audio, driven by settings
 * ------------------------------------------------------------------ */

/** How far ahead music is scheduled, and how often the queue is topped up. */
const LOOKAHEAD_SECONDS = 0.3;
const SCHEDULER_INTERVAL_MS = 100;
/** Drag-painting can cross many cells per second; space its ticks out. */
const PAINT_GAP_SECONDS = 0.04;
/** Music level while a win jingle plays over it. */
const DUCKED_LEVEL = 0.08;

class LiveAudio {
  constructor() {
    this.ctx = null;
    this.mixer = null;
    this.kit = null;
    this.musicBox = null;
    this.musicTimer = null;
    this.nextBar = 0;
    this.nextBarTime = 0;
    this.lastPaint = 0;
  }

  /**
   * Browsers keep audio suspended until the player interacts. The app calls
   * this on every tap and key press; after the first, calls are cheap.
   */
  unlock() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    if (!this.ctx) {
      this.ctx = new AudioContextClass();
      this.mixer = createMixer(this.ctx);
      this.kit = new SoundKit(this.mixer);
      this.musicBox = new MusicBox(this.mixer);
      document.addEventListener('visibilitychange', () => this.onVisibility());
    }
    if (this.ctx.state === 'suspended' && !document.hidden) this.ctx.resume();
    if (settings().music) this.startMusic();
  }

  /** Go silent (and save battery) while the app is in the background. */
  onVisibility() {
    if (document.hidden) this.ctx.suspend();
    else this.ctx.resume();
  }

  get ready() {
    return Boolean(this.ctx) && this.ctx.state === 'running' && settings().sound;
  }

  /** Run a sound effect now, if effects are on and audio is unlocked. */
  play(name, ...args) {
    if (!this.ready) return;
    this.kit[name](this.ctx.currentTime + 0.01, ...args);
  }

  cross() { this.play('cross'); }
  maybe() { this.play('maybe'); }
  erase() { this.play('erase'); }
  cat(catNumber) { this.play('cat', catNumber); }
  wrong() { this.play('wrong'); }
  hint() { this.play('hint'); }
  lose() { this.play('lose'); }

  paint() {
    if (!this.ready || this.ctx.currentTime - this.lastPaint < PAINT_GAP_SECONDS) return;
    this.lastPaint = this.ctx.currentTime;
    this.play('paint');
  }

  /** The win jingle starts just after the last cat's note. */
  win() {
    if (!this.ready) return;
    this.duckMusic(3.5);
    this.kit.win(this.ctx.currentTime + 0.3);
  }

  /** The win sheet's stars ring as their animations land. */
  stars(count, firstDelaySeconds, gapSeconds) {
    if (!this.ready) return;
    for (let i = 0; i < count; i++) {
      this.kit.star(this.ctx.currentTime + firstDelaySeconds + i * gapSeconds, i);
    }
  }

  setMusic(on) {
    if (on) this.unlock();
    else this.stopMusic();
  }

  startMusic() {
    if (this.musicTimer || !this.ctx) return;
    const { music } = this.mixer;
    const now = this.ctx.currentTime;
    music.gain.cancelScheduledValues(now);
    music.gain.setValueAtTime(0.0001, now);
    music.gain.exponentialRampToValueAtTime(MUSIC_LEVEL, now + 2);
    this.nextBarTime = now + 0.1;
    this.musicTimer = setInterval(() => this.scheduleMusic(), SCHEDULER_INTERVAL_MS);
    this.scheduleMusic();
  }

  /** Keep a short queue of bars ahead of the playhead. */
  scheduleMusic() {
    // After the app was suspended, skip the bars that were missed.
    if (this.nextBarTime < this.ctx.currentTime) this.nextBarTime = this.ctx.currentTime + 0.05;
    while (this.nextBarTime < this.ctx.currentTime + LOOKAHEAD_SECONDS) {
      this.musicBox.scheduleBar(this.nextBar, this.nextBarTime);
      this.nextBar++;
      this.nextBarTime += this.musicBox.barLength;
    }
  }

  stopMusic() {
    if (!this.musicTimer) return;
    clearInterval(this.musicTimer);
    this.musicTimer = null;
    const { music } = this.mixer;
    const now = this.ctx.currentTime;
    music.gain.cancelScheduledValues(now);
    music.gain.setValueAtTime(music.gain.value, now);
    music.gain.linearRampToValueAtTime(0, now + 0.6);
  }

  /** Lower the music while a jingle plays, then bring it back. */
  duckMusic(seconds) {
    if (!this.musicTimer) return;
    const { music } = this.mixer;
    const now = this.ctx.currentTime;
    music.gain.cancelScheduledValues(now);
    music.gain.setValueAtTime(music.gain.value, now);
    music.gain.linearRampToValueAtTime(DUCKED_LEVEL, now + 0.2);
    music.gain.setValueAtTime(DUCKED_LEVEL, now + seconds);
    music.gain.linearRampToValueAtTime(MUSIC_LEVEL, now + seconds + 2);
  }
}

export const audio = new LiveAudio();
