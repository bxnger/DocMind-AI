export interface Segment {
  text: string;
  changed: boolean;
}

export interface WordDiff {
  a: Segment[];
  b: Segment[];
  removedWords: number;
  addedWords: number;
}

/** Above this, the quotes are shown as changed whole instead of spending time on the table. */
const MAX_CELLS = 2_000_000;

const tokens = (text: string) => text.match(/\S+|\s+/g) ?? [];
const isWord = (token: string) => /\S/.test(token);

function segments(list: string[], keep: boolean[]): Segment[] {
  const out: Segment[] = [];
  list.forEach((text, index) => {
    // Spaces join the side of the words around them, so one change reads as one mark.
    const changed = isWord(text) ? !keep[index] : !keep[index - 1] && !keep[index + 1] && index > 0 && index < list.length - 1;
    const last = out[out.length - 1];
    if (last && last.changed === changed) last.text += text;
    else out.push({ text, changed });
  });
  return out;
}

/** Word-level difference of two real quotes. Joining a side's segments gives back its quote exactly. */
export function diffWords(before: string, after: string): WordDiff {
  const a = tokens(before);
  const b = tokens(after);
  const keepA = new Array<boolean>(a.length).fill(false);
  const keepB = new Array<boolean>(b.length).fill(false);
  if (a.length * b.length <= MAX_CELLS) {
    const width = b.length + 1;
    const table = new Uint32Array((a.length + 1) * width);
    for (let i = a.length - 1; i >= 0; i -= 1) {
      for (let j = b.length - 1; j >= 0; j -= 1) {
        const here = i * width + j;
        table[here] =
          a[i] === b[j] && isWord(a[i] ?? '')
            ? (table[here + width + 1] ?? 0) + 1
            : Math.max(table[here + width] ?? 0, table[here + 1] ?? 0);
      }
    }
    let i = 0;
    let j = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j] && isWord(a[i] ?? '')) {
        keepA[i] = true;
        keepB[j] = true;
        i += 1;
        j += 1;
      } else if ((table[(i + 1) * width + j] ?? 0) >= (table[i * width + j + 1] ?? 0)) i += 1;
      else j += 1;
    }
  }
  const count = (list: string[], keep: boolean[]) => list.filter((token, index) => isWord(token) && !keep[index]).length;
  return { a: segments(a, keepA), b: segments(b, keepB), removedWords: count(a, keepA), addedWords: count(b, keepB) };
}
