# Laladoku

A calm logic puzzle starring **Lala**, an orange tabby cat. Place one cat in
every row, every column and every colour region, and make sure no two cats
touch, not even at the corners.

Every board is made by this project's own seeded generator. Every board has
exactly one solution, and every board can be solved by logic alone: no
guessing is ever needed.

Runs as an installable web app (PWA) on phones and desktops and works fully
offline after the first visit.

## Play

```bash
cd ~/Documents/workspace/laladoku
python3 -m http.server 8765
```

Open <http://127.0.0.1:8765/>, or play the live version at
<https://jonathanjie.github.io/laladoku/> (GitHub Pages, deployed from `main`).

**Installing:** the home screen shows a "Put Lala on your home screen" banner.
On Android and desktop Chrome or Edge, its Install button opens the browser's
install dialog. On iPhone and iPad, Apple does not let sites open that dialog,
so the button shows the steps: Share, then *Add to Home Screen*. The banner
hides once the game runs as an installed app, and Settings keeps the option.

| Input | Effect |
| --- | --- |
| Tap a cell | Toggle a cross (with Maybe-Lala marks on: silhouette, then cross, then clear) |
| Double-tap a cell quickly | Place Lala (a correct Lala is locked in place) |
| Drag across cells | Cross out many cells. A drag that starts on a cross erases crosses (with Maybe-Lala marks on, it turns them into silhouettes); one that starts on a silhouette clears silhouettes |
| Arrow keys, Space/Enter | Move, toggle a cross (press twice quickly for a cat) |
| X, C, Backspace | Cross, cat, clear |
| M, H | Maybe-Lala mark, hint |

### Challenge rules

- **3 paws (lives) and 2 hints per board.** A cat on a wrong cell costs a paw
  and leaves a locked red cross, so the same slip never costs twice. A correct
  cat is locked too. Crosses are never penalised, and Clear only removes your
  own crosses and Maybe-Lala marks.
- A hint explains the next logical step in plain words, highlights it on the
  board, and offers to do it. If a cross covers a cat's cell, the hint points
  that out first.
- Stars: ★★★ with no slips and no hints, ★★ with up to two slips or hints in
  total, ★ otherwise.
- Progress, stars and the best time for each level are kept on the device.
  A replay shows the time to beat at the top and "New best!" when you win
  faster. An unfinished board is saved as you play, so a refresh resumes it.
- In the first three levels Lala coaches for free: she shows the next logical
  step after every move until you tell her you've got it.

### Modes

- **Chapters**: 442 levels in 12 chapters, from 5×5 to 10×10, ramping from
  gentle to expert.
- **Quick Play**: a brand-new board, generated on your device in a background
  thread, 5×5 to 10×10, Easy / Medium / Hard. The number in the URL is the
  generator seed: the same link always gives the same board, so it can be
  shared.
- **Techniques**: Lala's notebook explains the five deductions with real
  examples.

### Sound

All audio is synthesized live with the Web Audio API (`js/audio.js`), so the
game ships no audio files and plays offline.

- **Effects:** a pencil tick for crosses, a music-box note for each cat (the
  cats play the refrain of "Jesus Loves Me", Bradbury 1862, public domain:
  G E G A C, then G E C E D, one note per cat), a
  soft bonk for a wrong cat, a chime for hints, a win arpeggio with a "mrrp"
  from Lala, a bell per star, and a sleepy fall when the paws run out.
- **Music:** a calm generative music box in C major at 72 BPM, written by
  rules from song-writing rather than at random:
  - **Form AABA** of 8-bar sections (32 bars, about 1:47); each form draws
    new motifs and chords, so it never repeats exactly.
  - **Question and answer:** each section's first phrase ends open on G (V);
    the second ends G -> C (V -> I) with the melody stepping home to C.
  - **Motifs:** a one-bar rhythm and contour, repeated one step higher or
    lower, then turned upside down, then a long cadence note; a soft pickup
    note leads into the next phrase.
  - **Harmony:** strong beats land on notes of the current chord; the melody
    stays in C major pentatonic; the bass plays root then fifth.
  - It ducks under the win jingle. `test/music.test.mjs` checks these rules.
- Sound starts after the first tap (a browser rule), pauses while the app is
  hidden, and both layers can be switched off in Settings.

## The deduction ladder

The hint engine (`js/engine.js`) knows five techniques. Generated levels are
checked against them: a level is accepted only if this ladder can solve it
from an empty board.

| Rank | Name | Idea |
| --- | --- | --- |
| R1 | Last spot | A row, column or colour has one open cell left. |
| R2 | Lined up | A colour fits only in one row (or column), so that line is used up. Or a line's open cells are all one colour, so the rest of that colour is out. |
| R3 | Locked set | k colours fit only in the same k lines, so those lines are full. |
| R4 | Blocked | A cat here would, by itself, cover every open cell of another row, column or colour. |
| R5 | Chain | A cat here forces a short chain of other cats, and the chain leaves a unit with nowhere to go. The chain length is bounded per level (2 forced cats by default, 5 in the last two chapters). |

Every step is a sound deduction, so when the ladder fills a board, that
board's solution is also unique. The tests check uniqueness separately by
brute force anyway.

## How levels are made

`js/generator.js` builds a board from a seed. The same seed always gives the
same board.

1. **Answer first.** Place n cats: one per row and column, none touching.
2. **Grow the colours.** Grow one region from each cat by random flood fill,
   aiming for uneven sizes: one large region (about a third of the board), one
   or two tiny ones, the rest in between. Uneven regions give the player
   places to start; equal ones tend to allow several solutions.
3. **Repair.** Solve with the ladder. Move one border cell into a neighbouring
   region and keep the move if the ladder settles at least as many cells as
   before. Repeat until it solves the whole board.
4. **Harden.** Keep moving cells while the board stays solvable and its
   difficulty score does not drop. The level must use its chapter's hardest
   technique at least once.
5. If the search stalls, start again from new regions (and every few
   restarts, new cats).

`scripts/build_levels.mjs` runs this on every CPU core to build the campaign
bank in `levels/` (about 7 minutes on 10 cores; `--scale 0.1` for a quick
trial). `scripts/build_examples.mjs` picks the notebook examples.

| Chapter | Size | Hardest technique | Levels |
| --- | --- | --- | --- |
| First Steps | 5×5 | R2 | 12 |
| Sunny Window | 6×6 | R2 | 20 |
| Yarn Basket | 7×7 | R3 | 30 |
| Garden Path | 7×7 | R4 | 30 |
| Rooftops | 8×8 | R3 | 40 |
| Night Market | 8×8 | R4 | 50 |
| Old Library | 9×9 | R4 | 60 |
| Harbour Lights | 10×10 | R4 | 60 |
| Moon Garden | 9×9 | R5, chains of 2 | 40 |
| Starry Attic | 10×10 | R5, chains of 2 | 40 |
| Lala's Dream | 9×9 | R5, chains of 5 | 30 |
| Cat Constellation | 10×10 | R5, chains of 5 | 30 |

### Level data format

`levels/index.json` lists the chapters and chunks. Each `levels/chunk-N.json`
holds a slice of the campaign:

```json
{ "start": 0, "levels": [
  { "n": 5, "m": ["00111", "..."], "s": "13024", "d": 3, "r": 2, "c": 0, "st": 9, "seed": 1 }
]}
```

- `n` board size, `m` region map (one base-36 digit per cell), `s` solution
  (the cat's column in each row)
- `d` difficulty score, `r` hardest rank needed, `c` longest chain allowed,
  `st` hints the ladder needs, `seed` the generator seed

## Tests

```bash
node test/engine.test.mjs
node test/levels.test.mjs
node test/music.test.mjs
```

- `engine.test.mjs` generates boards from fixed seeds and checks: the
  generator is deterministic, cat layouts obey the rules, every board has
  exactly one solution (brute force), the ladder solves each board within its
  tier, hints never cross out the answer, and candidates never break a rule.
- `levels.test.mjs` checks every level in the bank: size, contiguous regions,
  a valid stored solution, exactly one solution, solvable by the ladder within
  its recorded rank and chain length, and no duplicates.

## Project layout

```
index.html                 app shell
manifest.webmanifest       PWA manifest
sw.js                      service worker: precaches the app and level bank
css/app.css                picture-book styling, light and dark themes
js/app.js                  screens, routing, sheets
js/game.js                 game screen: input, lives, hints, coaching
js/audio.js                synthesized sound effects and generative music
js/board-view.js           board drawing, region colours, highlights
js/explain.js              hint text and the technique catalogue
js/engine.js               rules, solver, candidate grid, deduction ladder
js/generator.js            seeded level generator
js/quickplay-worker.js     Quick Play generation off the main thread
js/levels.js               level bank loader
js/store.js                local progress and settings
js/install.js              add-to-home-screen prompt and steps
js/lala.js                 Lala and the icons, in SVG
levels/                    generated level bank and notebook examples
scripts/build_levels.mjs   builds the level bank
scripts/build_examples.mjs builds the notebook examples
test/                      engine and level bank tests
icons/                     app icons (Lala)
work/                      scratch: benchmarks and screenshots, not shipped
```

Nothing leaves the device: no accounts, no analytics, no ads. Progress is
kept in `localStorage`.
