import type { Difference } from '@/types/comparison';

export type UnifiedItem = { kind: 'same'; text: string } | { kind: 'change'; difference: Difference };

export interface UnifiedDiff {
  items: UnifiedItem[];
  /** Changes whose text could not be found in the documents' text. Listed apart, not placed at a guessed spot. */
  unplaced: Difference[];
}

interface Span {
  start: number;
  end: number;
}

/** Finds each quote in reading order, and looks again from the top for one that moved. */
function locate(text: string, quotes: ReadonlyArray<string | null>): Array<Span | null> {
  const taken: Span[] = [];
  let cursor = 0;
  return quotes.map((quote) => {
    if (!quote) return null;
    const free = (from: number): number => {
      let at = text.indexOf(quote, from);
      while (at >= 0 && taken.some((span) => at < span.end && at + quote.length > span.start)) at = text.indexOf(quote, at + 1);
      return at;
    };
    const after = free(cursor);
    const start = after >= 0 ? after : free(0);
    if (start < 0) return null;
    const span = { start, end: start + quote.length };
    taken.push(span);
    if (start >= cursor) cursor = span.end;
    return span;
  });
}

/** Where a position falls in the text that is left once all the changed passages are taken out. */
function commonOffset(position: number, spans: readonly Span[]): number {
  return spans.reduce((offset, span) => (span.end <= position ? offset - (span.end - span.start) : offset), position);
}

const withoutSpans = (text: string, spans: readonly Span[]): string => {
  let out = '';
  let at = 0;
  for (const span of [...spans].sort((a, b) => a.start - b.start)) {
    out += text.slice(at, span.start);
    at = Math.max(at, span.end);
  }
  return out + text.slice(at);
};

/**
 * One reading order for two documents: the unchanged text with each change in its place. Every word comes
 * from the documents and every change from the server. Unchanged text is the same on both sides by definition,
 * so a position in it is comparable between them.
 */
export function buildUnified(textA: string, textB: string, differences: readonly Difference[]): UnifiedDiff {
  const inA = locate(textA, differences.map((difference) => difference.a?.quote ?? null));
  const inB = locate(textB, differences.map((difference) => difference.b?.quote ?? null));
  const spansA = inA.filter((span): span is Span => span !== null);
  const spansB = inB.filter((span): span is Span => span !== null);
  const common = withoutSpans(textB, spansB);

  const unplaced: Difference[] = [];
  const events: Array<{ offset: number; order: number; difference: Difference }> = [];
  differences.forEach((difference, order) => {
    const b = inB[order];
    const a = inA[order];
    if (b) events.push({ offset: commonOffset(b.start, spansB), order, difference });
    else if (a) events.push({ offset: commonOffset(a.start, spansA), order, difference });
    else unplaced.push(difference);
  });
  events.sort((x, y) => x.offset - y.offset || x.order - y.order);

  const items: UnifiedItem[] = [];
  let at = 0;
  const pushSame = (end: number) => {
    const text = common.slice(at, end).trim();
    if (text) items.push({ kind: 'same', text });
    at = Math.max(at, end);
  };
  for (const event of events) {
    // Offsets from the two documents can differ by a few characters, so a cut never lands inside a word.
    const atBoundary = event.offset === 0 || common[event.offset - 1] === ' ' || common[event.offset] === ' ';
    const space = common.indexOf(' ', event.offset);
    const end = event.offset <= at ? at : atBoundary ? event.offset : space < 0 ? common.length : space;
    pushSame(end);
    items.push({ kind: 'change', difference: event.difference });
  }
  pushSame(common.length);
  return { items, unplaced };
}

export const countWords = (text: string): number => text.split(/\s+/).filter(Boolean).length;
