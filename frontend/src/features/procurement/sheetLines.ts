import { toMinor } from '@/lib/money';
import type { Decision, Part, PartOffers, QuoteRequestItem } from '@/types/procurement';

/** What the person decided for one line. The server keeps no sheet: it only calculates what it is sent. */
export interface SheetLine {
  included: boolean;
  quantity: number | null;
  offerId: string | null;
  note: string;
  confirmationId: string | null;
  decision: Decision | null;
}

export const NEW_LINE: SheetLine = { included: true, quantity: null, offerId: null, note: '', confirmationId: null, decision: null };

/** A line goes to the calculation only with a real quantity: from the document, or typed by the person. */
export function quoteItems(parts: readonly Part[], lines: Record<string, SheetLine>): { items: QuoteRequestItem[]; withoutQuantity: number } {
  const items: QuoteRequestItem[] = [];
  let withoutQuantity = 0;
  for (const part of parts) {
    const line = lines[part.id];
    if (line && !line.included) continue;
    const quantity = line?.quantity ?? part.quantity;
    if (quantity === null) {
      withoutQuantity += 1;
      continue;
    }
    items.push({ partId: part.id, quantity, offerId: line?.offerId ?? null, ...(line?.confirmationId ? { confirmationId: line.confirmationId } : {}) });
  }
  return { items, withoutQuantity };
}

/**
 * For the button a person presses. The cheapest exact match with a price, skipping what the file says is out of stock.
 * Similar part numbers are never chosen, and a line the person already chose for stays as it is.
 */
export function chooseExactOffers(offers: readonly PartOffers[], lines: Record<string, SheetLine>): Record<string, string> {
  const chosen: Record<string, string> = {};
  for (const { partId, offers: exact } of offers) {
    const line = lines[partId];
    if (line?.offerId || line?.included === false) continue;
    let best: { id: string; minor: bigint } | null = null;
    for (const offer of exact) {
      if (offer.match !== 'exact' || offer.stockStatus === 'unavailable') continue;
      const minor = offer.price === null ? null : toMinor(offer.price);
      if (minor !== null && (best === null || minor < best.minor)) best = { id: offer.id, minor };
    }
    if (best) chosen[partId] = best.id;
  }
  return chosen;
}

/** "Full" only when nothing is open: every included line has a quantity and a price. */
export const isSheetComplete = (quote: { unpriced: number; totals: readonly unknown[] } | undefined, withoutQuantity: number): boolean =>
  quote !== undefined && quote.totals.length > 0 && quote.unpriced === 0 && withoutQuantity === 0;

/** Some PDFs store the dash of a part number as a soft hyphen, which is invisible on screen: 6205-2RS would read 62052RS. */
export function readableQuote(quote: string, partNumber: string): string {
  const dashed = quote.replaceAll('­', '-');
  return dashed.includes(partNumber) ? dashed : quote;
}
