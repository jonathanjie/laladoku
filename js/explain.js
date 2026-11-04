/**
 * Turns engine hints into plain words and board highlights.
 *
 * The engine names deductions by rank (R1-R5). Players see the technique
 * names below instead, the same names the Techniques notebook teaches.
 */
import { regionIndex } from './engine.js';

export const TECHNIQUES = {
  1: {
    name: 'Last spot',
    short: 'A row, column or colour has one open cell left.',
    long: 'Every row, column and colour needs exactly one cat. When all but one of its cells are ruled out, the cat must go in the one that is left.',
  },
  2: {
    name: 'Lined up',
    short: 'A colour fits only in one line, so that line belongs to it.',
    long: 'If every open cell of a colour sits in one row, that colour’s cat will be in that row. A row holds only one cat, so the other cells of the row are out. It works the other way too: if a row’s open cells are all one colour, that colour’s cat is in this row, and the rest of the colour is out.',
  },
  3: {
    name: 'Locked set',
    short: 'Some colours share exactly that many lines, so those lines are full.',
    long: 'If two colours can only use the same two rows, those two rows will hold those two cats. Nothing else fits in those rows. The same holds for three colours in three rows, or for columns.',
  },
  4: {
    name: 'Blocked',
    short: 'A cat here would leave another row, column or colour empty.',
    long: 'Picture a cat on a cell. It rules out its row, its column, its colour and the eight cells around it. If that would cover every open cell of some other row, column or colour, that cat is impossible, so the cell is out.',
  },
  5: {
    name: 'Chain',
    short: 'A cat here forces other cats, and the chain runs into a wall.',
    long: 'Picture a cat on a cell, then follow what it forces: a row with one cell left must take a cat, which rules out more cells, and so on. If the chain leaves some row, column or colour with nowhere to go, the first cat was impossible. Hard levels need chains of a few cats; none needs open-ended guessing.',
  },
};

const lineCells = (n, kind, index) =>
  Array.from({ length: n }, (_, i) => (kind === 'row' ? [index, i] : [i, index]));

function unitCells(board, unit, index) {
  if (unit === 'region') return regionIndex(board)[index];
  return lineCells(board.n, unit, index);
}

function unitName(view, unit, index) {
  if (unit === 'row') return `row ${index + 1}`;
  if (unit === 'col') return `column ${index + 1}`;
  return `the <b class="swatch" data-colour="${view.colourName(index)}">${view.colourName(index)}</b> colour`;
}

const colourName = (view, id) =>
  `<b class="swatch" data-colour="${view.colourName(id)}">${view.colourName(id)}</b>`;

/**
 * Explain a hint for the given board view.
 * Returns { title, text, highlight } where `highlight` is passed to
 * BoardView.highlight and `text` is trusted HTML built only from numbers and
 * the fixed colour names.
 */
export function explainHint(hint, board, view) {
  const { n } = board;

  if (hint.kind === 'fix') {
    return {
      title: 'Oops, a stray cross',
      text: 'This cross covers a cell where a cat belongs. Clear it and keep going.',
      highlight: { focus: [[hint.r, hint.c]] },
    };
  }

  if (hint.rank === 9) {
    return {
      title: 'A peek at the answer',
      text: 'No simple step is left from here, so Lala shows you where one cat goes.',
      highlight: { focus: [[hint.r, hint.c]] },
    };
  }

  const technique = TECHNIQUES[hint.rank];

  if (hint.rank === 1) {
    return {
      title: technique.name,
      text: `Only one open cell is left in ${unitName(view, hint.unit, hint.index)}, so a cat goes there.`,
      highlight: { zone: unitCells(board, hint.unit, hint.index), focus: [[hint.r, hint.c]] },
    };
  }

  if (hint.rank === 2) {
    const { region, kind, line } = hint.highlight;
    const lineKind = kind === 'row' || kind === 'rowToRegion' ? 'row' : 'col';
    const lineWord = lineKind === 'row' ? `row ${line + 1}` : `column ${line + 1}`;
    const text = kind === 'row' || kind === 'col'
      ? `All the open cells of ${colourName(view, region)} are in ${lineWord}. Its cat will use up ${lineWord}, so the other cells there are out.`
      : `All the open cells of ${lineWord} are ${colourName(view, region)}. That colour’s cat must be in ${lineWord}, so the rest of ${colourName(view, region)} is out.`;
    return {
      title: technique.name,
      text,
      highlight: {
        zone: [...regionIndex(board)[region], ...lineCells(n, lineKind, line)],
        exclude: hint.exclude,
      },
    };
  }

  if (hint.rank === 3) {
    const { regions, kind, lines } = hint.highlight;
    const colours = regions.map((id) => colourName(view, id));
    const list = colours.length === 2
      ? colours.join(' and ')
      : `${colours.slice(0, -1).join(', ')} and ${colours.at(-1)}`;
    const lineWord = kind === 'row' ? 'rows' : 'columns';
    const numbers = lines.map((l) => l + 1).join(', ');
    const zone = regions.flatMap((id) => regionIndex(board)[id]);
    return {
      title: technique.name,
      text: `${list} can only use ${lineWord} ${numbers}. Those ${regions.length} ${lineWord} are full with their cats, so every other cell in them is out.`,
      highlight: { zone, exclude: hint.exclude },
    };
  }

  // R4 and R5: a "what if" cat on the excluded cell.
  const [r, c] = hint.exclude[0];
  const { unit, index, chain = [] } = hint.highlight;
  const target = unitName(view, unit, index);
  const text = hint.rank === 4
    ? `Imagine a cat here. It would rule out every open cell of ${target}. That can’t be, so this cell is out.`
    : `Imagine a cat here. It forces ${chain.length === 1 ? 'one more cat' : `${chain.length} more cats`}, and then ${target} has nowhere left. So this cell is out.`;
  return {
    title: technique.name,
    text,
    highlight: { zone: unitCells(board, unit, index), focus: [[r, c]], exclude: [[r, c]], ghost: chain },
  };
}
