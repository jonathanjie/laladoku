/**
 * Campaign level bank: lazily loads chunks built by scripts/build_levels.mjs.
 *
 * Level numbers are 1-based for players; chunk offsets are 0-based.
 */
import { decodeLevel } from './engine.js';

let indexPromise = null;
const chunkPromises = new Map();

function fetchJSON(url) {
  // Revalidate so a cached index from an older build cannot point at chunk
  // offsets that no longer match the shipped levels.
  return fetch(url, { cache: 'no-cache' }).then((res) => {
    if (!res.ok) throw new Error(`${url} unavailable (${res.status})`);
    return res.json();
  });
}

export function loadIndex() {
  indexPromise ??= fetchJSON('levels/index.json');
  return indexPromise;
}

/** The chapter that holds a level, with the level's place inside it. */
export function chapterOf(index, levelNumber) {
  const offset = levelNumber - 1;
  const chapterIndex = index.chapters.findIndex(
    (ch) => offset >= ch.start && offset < ch.start + ch.count,
  );
  const chapter = index.chapters[chapterIndex];
  return { chapter, chapterIndex, position: offset - chapter.start + 1 };
}

/** Decoded board for a 1-based level number. */
export async function loadLevel(levelNumber) {
  const index = await loadIndex();
  if (levelNumber < 1 || levelNumber > index.total) {
    throw new RangeError(`no level ${levelNumber}`);
  }
  const offset = levelNumber - 1;
  const chunk = index.chunks.find((ch) => offset >= ch.start && offset < ch.start + ch.count);
  if (!chunkPromises.has(chunk.file)) chunkPromises.set(chunk.file, fetchJSON(chunk.file));
  const data = await chunkPromises.get(chunk.file);
  return decodeLevel(data.levels[offset - data.start]);
}
