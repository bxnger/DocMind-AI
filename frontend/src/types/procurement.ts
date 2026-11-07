import type { EvidenceRect } from './chat';

export type MarkingStatus = 'exact' | 'possible' | 'conflict' | 'insufficient';

export interface Part {
  id: string;
  rawCode: string;
  normalizedCode: string;
  brand: string | null;
  description: string | null;
  quantity: number | null;
  unit: string | null;
  quantityStatus: 'found' | 'missing';
  quantitySource: 'document' | 'user';
  included: boolean;
  note: string;
  page: number | null;
  location: string | null;
  paragraph: number | null;
  /** Null only in demonstration data that has no place in this document. The real API always sends a quote. */
  quote: string | null;
  highlights: EvidenceRect[];
  extraction: string;
}

export interface PartPatch {
  quantity?: number;
  included?: boolean;
  note?: string;
}

export interface MarkingCandidate {
  partId: string;
  status: MarkingStatus;
  differences: Array<{ document: string; marking: string }>;
}

export interface Marking {
  id: string;
  readText: string | null;
  readBy: 'model' | null;
  confirmed: boolean;
  confirmedText: string | null;
  status: MarkingStatus | null;
  matchedPartId: string | null;
  candidates: MarkingCandidate[];
}

export interface PriceList {
  id: string;
  fileName: string;
  supplier: string;
  sourceNote: string;
  uploadedAt: string;
  rowCount: number;
  skippedRows: Array<{ row: number; reason: string }>;
}

export interface Offer {
  id: string;
  priceListId: string;
  supplier: string;
  sku: string;
  sourceRow: number;
  unitPrice: string;
  currency: string;
  checkedAt: string;
  stock: number | null;
  url: string | null;
  match: 'exact' | 'needs_review';
}

export interface SheetItem {
  partId: string;
  markingStatus: MarkingStatus | null;
  markingId: string | null;
  selectedOfferId: string | null;
  lineTotal: string | null;
  offers: Offer[];
}

export interface Sheet {
  items: SheetItem[];
  totals: Array<{ currency: string; amount: string; lines: number }>;
  unpricedParts: number;
  complete: boolean;
}
