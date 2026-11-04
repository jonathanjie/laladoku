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

const C5 = 72;
/** C major pentatonic from C5 upward: each cat placed plays the next note. */
const CAT_NOTES = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21].map((step) => C5 + step);

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

  /** A cat placed: the next note of the pentatonic scale, so a solve plays a tune. */
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

/** Chord progressions in C major: each chord is [bass root, ...pad notes] in MIDI. */
const PROGRESSIONS = [
  // I - vi - IV - V
  [[48, 60, 64, 67], [45, 57, 60, 64], [41, 57, 60, 65], [43, 55, 59, 62]],
  // IV - I - V - vi
  [[41, 57, 60, 65], [48, 55, 60, 64], [43, 55, 59, 62], [45, 57, 60, 64]],
  // vi - IV - I - V
  [[45, 57, 60, 64], [41, 57, 60, 65], [48, 55, 60, 64], [43, 55, 59, 62]],
];
/** Melody notes: C major pentatonic, C5 to E6. */
const MELODY_NOTES = [72, 74, 76, 79, 81, 84, 86, 88];
const BEATS_PER_MINUTE = 72;
const EIGHTHS_PER_BAR = 8;

export class MusicBox {
  constructor(mixer, random = Math.random) {
    this.mixer = mixer;
    this.random = random;
    this.melodyIndex = 2;
    this.progression = PROGRESSIONS[0];
    this.density = 0.5;
  }

  get eighth() {
    return 60 / BEATS_PER_MINUTE / 2;
  }

  get barLength() {
    return this.eighth * EIGHTHS_PER_BAR;
  }

  /** Schedule bar number `bar` (counting from 0) to start at time `t`. */
  scheduleBar(bar, t) {
    const { mixer } = this;
    // Every four bars, pick a progression and how busy the melody is, so the
    // music breathes: some phrases sing, some only hum.
    if (bar % 4 === 0) {
      this.progression = PROGRESSIONS[Math.floor(this.random() * PROGRESSIONS.length)];
      this.density = [0.25, 0.45, 0.6][Math.floor(this.random() * 3)];
    }
    const [root, ...chord] = this.progression[bar % 4];

    // Pad: the chord with a slow attack, as softly detuned pairs for warmth.
    for (const note of chord) {
      for (const cents of [-6, 6]) {
        const osc = tone(mixer, t, {
          freq: hz(note), type: 'triangle', gain: 0.035, attack: 0.9,
          decay: this.barLength + 0.8, dest: mixer.music, reverb: 0.5,
        });
        osc.detune.value = cents;
      }
    }

    // Bass: the root on beats one and three.
    for (const step of [0, 4]) {
      tone(mixer, t + step * this.eighth, {
        freq: hz(root), gain: 0.22, attack: 0.02, decay: 1.4, dest: mixer.music,
      });
    }

    // Melody: music-box notes that mostly step to a neighbouring note.
    for (let step = 0; step < EIGHTHS_PER_BAR; step++) {
      const strongBeat = step % 2 === 0;
      const chance = strongBeat ? this.density : this.density * 0.4;
      if (this.random() >= chance) continue;
      const move = [-2, -1, -1, 0, 1, 1, 2][Math.floor(this.random() * 7)];
      this.melodyIndex = Math.min(MELODY_NOTES.length - 1, Math.max(0, this.melodyIndex + move));
      bell(mixer, t + step * this.eighth, hz(MELODY_NOTES[this.melodyIndex]), {
        gain: strongBeat ? 0.2 : 0.13, decay: 1.6, dest: mixer.music, reverb: 0.55,
      });
    }
  }
}

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
