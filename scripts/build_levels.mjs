#!/usr/bin/env node
/**
 * Build the Laladoku level bank with the seeded generator.
 *
 * Every level is generated here, from seeds, by js/generator.js. The campaign
 * is a list of chapters; each chapter fixes a board size and a band of the
 * deduction ladder (see CHAPTERS). Inside a chapter, levels are sorted by
 * difficulty score so it ramps up smoothly.
 *
 * Work is spread over one worker thread per CPU core. A seed that does not
 * yield a board is skipped and the next seed is tried, so the output is the
 * same on every run and every machine.
 *
 * Output (under levels/):
 *   index.json      chapter table, chunk table, per-size counts
 *   chunk-<k>.json  contiguous slices of the campaign
 *
 * Level record fields (short keys keep the payload small):
 *   n   board size
 *   m   region map, one base36 string per row
 *   s   solution, one base36 string (column of the cat in each row)
 *   d   difficulty score (see difficultyScore in js/generator.js)
 *   r   hardest deduction rank the level needs (1-5)
 *   c   longest R5 chain the hints may use, in forced cats
 *   st  number of hints the deduction ladder needs
 *   seed  the generator seed, so any level can be rebuilt
 *
 * Usage:
 *   node scripts/build_levels.mjs [--out levels] [--scale 1]
 *   --scale 0.1 builds a tenth of every chapter, for a quick trial run.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CHUNK_SIZE = 100;

/**
 * The campaign, easiest first.
 *   size        board size
 *   maxRank     hardest rank the player may need
 *   minRank     every level in the chapter needs this rank at least once
 *   chainLength longest R5 chain (only used when maxRank is 5)
 *   harden      cell moves spent making each board harder (0 = none)
 *   count       levels in the chapter
 */
const CHAPTERS = [
  { name: 'First Steps', size: 5, maxRank: 2, minRank: 1, harden: 0, count: 12 },
  { name: 'Sunny Window', size: 6, maxRank: 2, minRank: 2, harden: 0, count: 20 },
  { name: 'Yarn Basket', size: 7, maxRank: 3, minRank: 2, harden: 100, count: 30 },
  { name: 'Garden Path', size: 7, maxRank: 4, minRank: 4, harden: 200, count: 30 },
  { name: 'Rooftops', size: 8, maxRank: 3, minRank: 3, harden: 200, count: 40 },
  { name: 'Night Market', size: 8, maxRank: 4, minRank: 4, harden: 300, count: 50 },
  { name: 'Old Library', size: 9, maxRank: 4, minRank: 4, harden: 300, count: 60 },
  { name: 'Harbour Lights', size: 10, maxRank: 4, minRank: 4, harden: 300, count: 60 },
  { name: 'Moon Garden', size: 9, maxRank: 5, minRank: 5, chainLength: 2, harden: 300, count: 40 },
  { name: 'Starry Attic', size: 10, maxRank: 5, minRank: 5, chainLength: 2, harden: 300, count: 40 },
  { name: 'Lala’s Dream', size: 9, maxRank: 5, minRank: 5, chainLength: 5, harden: 300, count: 30 },
  { name: 'Cat Constellation', size: 10, maxRank: 5, minRank: 5, chainLength: 5, harden: 300, count: 30 },
];

const B36 = '0123456789abcdefghijklmnopqrstuvwxyz';

/** Seeds of different chapters must never collide, so space them apart. */
const SEEDS_PER_CHAPTER = 1_000_000;

if (!isMainThread) {
  const { generateLevel } = await import(path.join(ROOT, 'js/generator.js'));
  parentPort.on('message', ({ chapterIndex, seed }) => {
    const chapter = CHAPTERS[chapterIndex];
    const level = generateLevel(chapter.size, seed, {
      maxRank: chapter.maxRank,
      minRank: chapter.minRank,
      chainLength: chapter.chainLength,
      hardenMoves: chapter.harden,
      maxRestarts: 40,
    });
    parentPort.postMessage({ chapterIndex, seed, level });
  });
} else {
  await main();
}

function parseArgs() {
  const args = { out: 'levels', scale: 1 };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') args.out = argv[++i];
    else if (argv[i] === '--scale') args.scale = Number(argv[++i]);
  }
  return args;
}

function encode(level, chapter) {
  return {
    n: level.n,
    m: level.regions.map((row) => row.map((v) => B36[v]).join('')),
    s: level.solution.map((v) => B36[v]).join(''),
    d: level.score,
    r: level.hardestRank,
    c: chapter.chainLength ?? 0,
    st: level.steps,
    seed: level.seed,
  };
}

/** Generate every chapter in parallel; returns one array of levels per chapter. */
function generateAll(targets) {
  return new Promise((resolve) => {
    const found = CHAPTERS.map(() => []);
    const signatures = new Set();
    const nextSeed = CHAPTERS.map((_, i) => i * SEEDS_PER_CHAPTER + 1);
    const inFlight = CHAPTERS.map(() => 0);
    const workers = [];
    let busy = 0;
    const started = Date.now();

    // Hand a worker the chapter that is furthest from its target, counting
    // the jobs already running so slow chapters are not oversubscribed.
    const pickChapter = () => {
      let best = -1, bestGap = 0;
      for (let i = 0; i < CHAPTERS.length; i++) {
        const gap = targets[i] - found[i].length - inFlight[i];
        if (gap > bestGap) { best = i; bestGap = gap; }
      }
      return best;
    };

    const dispatch = (worker) => {
      const chapterIndex = pickChapter();
      if (chapterIndex < 0) {
        if (busy === 0) {
          workers.forEach((w) => w.terminate());
          resolve(found);
        }
        return;
      }
      inFlight[chapterIndex]++;
      busy++;
      worker.postMessage({ chapterIndex, seed: nextSeed[chapterIndex]++ });
    };

    const threads = Math.max(1, os.availableParallelism?.() ?? os.cpus().length);
    for (let t = 0; t < threads; t++) {
      const worker = new Worker(fileURLToPath(import.meta.url));
      worker.on('message', ({ chapterIndex, level }) => {
        inFlight[chapterIndex]--;
        busy--;
        if (level && found[chapterIndex].length < targets[chapterIndex]) {
          const signature = JSON.stringify(level.regions);
          if (!signatures.has(signature)) {
            signatures.add(signature);
            found[chapterIndex].push(level);
            const done = found.reduce((a, f) => a + f.length, 0);
            const total = targets.reduce((a, b) => a + b, 0);
            const seconds = ((Date.now() - started) / 1000).toFixed(0);
            process.stdout.write(`\r  ${done}/${total} levels, ${seconds}s   `);
          }
        }
        dispatch(worker);
      });
      workers.push(worker);
    }
    workers.forEach(dispatch);
  });
}

async function main() {
  const args = parseArgs();
  const outDir = path.resolve(ROOT, args.out);
  const targets = CHAPTERS.map((ch) => Math.max(1, Math.round(ch.count * args.scale)));
  console.log(`building ${targets.reduce((a, b) => a + b, 0)} levels in ${CHAPTERS.length} chapters`);

  const found = await generateAll(targets);
  console.log();

  const records = [];
  const chapters = [];
  CHAPTERS.forEach((chapter, i) => {
    const levels = found[i].sort((a, b) => a.score - b.score || a.seed - b.seed);
    chapters.push({
      name: chapter.name,
      size: chapter.size,
      maxRank: chapter.maxRank,
      start: records.length,
      count: levels.length,
    });
    for (const level of levels) records.push(encode(level, chapter));
  });

  fs.mkdirSync(outDir, { recursive: true });
  for (const stale of fs.readdirSync(outDir)) {
    if (/^chunk-\d+\.json$/.test(stale)) fs.rmSync(path.join(outDir, stale));
  }

  const chunks = [];
  for (let start = 0; start < records.length; start += CHUNK_SIZE) {
    const file = `chunk-${start / CHUNK_SIZE}.json`;
    const part = records.slice(start, start + CHUNK_SIZE);
    fs.writeFileSync(path.join(outDir, file), JSON.stringify({ start, levels: part }));
    chunks.push({ file: `${args.out}/${file}`, start, count: part.length });
  }

  const sizes = {};
  for (const rec of records) sizes[rec.n] = (sizes[rec.n] || 0) + 1;
  const index = { version: 2, total: records.length, chunkSize: CHUNK_SIZE, sizes, chapters, chunks };
  fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(index, null, 1));

  for (const ch of chapters) console.log(`  ${ch.name.padEnd(18)} ${ch.size}x${ch.size}  ${ch.count} levels`);
  console.log(`wrote ${records.length} levels in ${chunks.length} chunks to ${args.out}/`);
}
