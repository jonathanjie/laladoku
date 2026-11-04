/**
 * Music checks: the composer follows its own theory rules. Bars are only
 * composed (planned), never played, so no audio hardware is needed.
 *
 *   node test/music.test.mjs
 */
import { MusicBox, MELODY_NOTES, PENTATONIC_CLASSES, CHORDS, pitchClass } from '../js/audio.js';
import { createRandom } from '../js/generator.js';

let failures = 0;
const check = (ok, message) => {
  if (!ok) { failures++; if (failures <= 20) console.log(`  FAIL ${message}`); }
};

const FORMS = 3;
const BARS = 32 * FORMS;
let barsChecked = 0;

for (let seed = 1; seed <= 25; seed++) {
  const box = new MusicBox(null, createRandom(seed));
  const plans = Array.from({ length: BARS }, (_, bar) => box.composeBar(bar));
  barsChecked += plans.length;

  plans.forEach((plan, bar) => {
    const where = `seed ${seed}, bar ${bar + 1}`;
    const chord = CHORDS[plan.chord];

    // Every melody note is in the C major pentatonic range.
    for (const note of plan.melody) {
      check(MELODY_NOTES.includes(note.midi), `${where}: note ${note.midi} outside the melody range`);
      check(PENTATONIC_CLASSES.includes(pitchClass(note.midi)), `${where}: note ${note.midi} not pentatonic`);
    }

    // Strong beats (1 and 3) land on a note of the chord.
    for (const note of plan.melody.filter((n) => n.step === 0 || n.step === 4)) {
      check(chord.tones.includes(pitchClass(note.midi)), `${where}: strong-beat ${note.midi} not in ${plan.chord}`);
    }

    // The bass starts every bar on the chord's root.
    check(plan.bass[0].step === 0 && plan.bass[0].midi === chord.bass, `${where}: bass does not start on the root`);

    // Every bar starts with a melody note on the downbeat.
    check(plan.melody.some((n) => n.step === 0), `${where}: no downbeat note`);

    if (plan.barInPhrase === 3) {
      if (plan.section === 'A' && plan.isAnswer) {
        // An answer comes home: V -> I, melody on C.
        check(plans[bar - 1].chord === 'G' && plan.chord === 'C', `${where}: answer does not cadence G -> C`);
        check(pitchClass(plan.melody[0].midi) === 0, `${where}: answer does not end on C`);
      } else if (plan.section === 'A') {
        // A question stays open on V.
        check(plan.chord === 'G', `${where}: question does not end on G`);
      } else if (plan.isAnswer) {
        // The bridge hands back to A on V.
        check(plan.chord === 'G', `${where}: bridge does not end on G`);
      }
    }

    // The motif's rhythm repeats in the next bar of the phrase (the sequence).
    if (plan.barInPhrase === 0) {
      const steps = (p) => p.melody.map((n) => n.step).join(',');
      check(steps(plan) === steps(plans[bar + 1]), `${where}: bar 2 does not repeat the motif rhythm`);
    }
  });

  // AABA: within one form, the second A repeats the first A exactly.
  for (let form = 0; form < FORMS; form++) {
    const base = form * 32;
    const firstA = JSON.stringify(plans.slice(base, base + 8));
    const secondA = JSON.stringify(plans.slice(base + 8, base + 16));
    check(firstA === secondA, `seed ${seed}, form ${form + 1}: the A sections differ`);
  }
}

console.log(`${barsChecked} bars composed and checked`);
console.log(failures ? `\n${failures} check(s) failed` : 'all music checks passed');
process.exit(failures ? 1 : 0);
