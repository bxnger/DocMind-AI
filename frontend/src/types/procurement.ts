import type { EvidenceSource } from './chat';

/** Mirrors backend/docs/API-PROCUREMENT.md, revision 2, on the backend/procurement-mvp branch. */
export type PartCategory = 'bearing' | 'seal' | 'belt' | 'filter' | 'fastener' | 'motor' | 'electrical' | 'hydraulic' | 'other';

export interface PartSpec {
  name: string;
  value: string;
  unit: string | null;
  /** document: stated in the document. standard: worked out by code from the standard designation. */
  origin: 'document' | 'standard';
}

export interface Part {
  id: string;
  category: PartCategory;
  name: string;
  partNumber: string;
  manufacturer: string | null;
  quantity: number | null;
  unit: string | null;
  specs: PartSpec[];
  location: string | null;
  /** False: the part number was not found word for word in the document. */
  verified: boolean;
  sources: EvidenceSource[];
}

export interface PartList {
  documentId: string;
  status: 'processing' | 'ready' | 'failed';
  progress: number | null;
  errorCode: string | null;
  equipment: { name: string | null; model: string | null; manufacturer: string | null; sources: EvidenceSource[] } | null;
  parts: Part[];
  summary: { total: number; unverified: number };
}

export type MatchStatus = 'matched' | 'needs_confirmation' | 'no_match' | 'type_only' | 'unreadable';
export type PartType = PartCategory | 'unknown';
export type PhotoIssue = 'glare' | 'blur' | 'angle' | 'partial' | 'dark' | 'far' | 'no_marking' | 'not_a_part';

export interface PhotoCandidate {
  partId: string;
  partNumber: string;
  name: string;
  /** `type`: only the kind of part agrees. It is a candidate, never a match of part numbers. */
  match: 'exact' | 'close' | 'partial' | 'type';
  difference: string | null;
  sources: EvidenceSource[];
}

export interface PhotoMatch {
  matchStatus: MatchStatus;
  recognized: {
    text: string | null;
    partNumber: string | null;
    manufacturer: string | null;
    markings: string[];
    readability: string | null;
    /** Every inscription the model read, as written. Older answers have none. */
    visibleMarkings: string[];
    /** The model's estimate from the shape of the part, not a fact. */
    partType: PartType | null;
    /** About partType only. How far to trust a part number is `readability`. */
    confidence: 'high' | 'medium' | 'low' | null;
    issues: PhotoIssue[];
  };
  matches: PhotoCandidate[];
  message: string | null;
  /** How to retake the photo, in the language of the answer. */
  tips: string[];
}

export type Decision = 'confirmed' | 'rejected';

export interface ConfirmationInput {
  recognizedText: string;
  /** Null when no part number was read and the person chose by the kind of part. */
  recognizedPartNumber: string | null;
  decision: Decision;
}

export interface Confirmation {
  id: string;
  partId: string;
  decision: Decision;
  recognizedPartNumber: string | null;
  documentPartNumber: string;
  confirmedBy: string;
  createdAt: string;
}

export type CheckedAtOrigin = 'file' | 'upload_form' | 'import_date' | 'site';

export interface PriceList {
  id: string;
  supplier: string;
  fileName: string;
  rows: number;
  skipped: Array<{ row: number; reason: string }>;
  checkedAt: string | null;
  checkedAtOrigin: CheckedAtOrigin;
  demo: boolean;
  importedAt: string;
}

export interface PriceListInput {
  supplier: string;
  checkedAt: string;
  demo: boolean;
}

export interface SiteCheck {
  status: 'checked' | 'failed';
  /** Why a check failed. The server's list is long and may grow, so this stays a plain string. */
  reason: string | null;
  price: string | null;
  currency: string | null;
  checkedAt: string | null;
}

export interface Offer {
  id: string;
  supplier: string;
  title: string;
  partNumber: string;
  match: 'exact' | 'close';
  /** Null when unknown, never 0. */
  price: string | null;
  currency: string | null;
  stockStatus: 'available' | 'unavailable' | 'unknown';
  stockQuantity: number | null;
  url: string | null;
  source: string;
  priceListId: string;
  sourceRow: number;
  checkedAt: string | null;
  checkedAtOrigin: CheckedAtOrigin;
  demo: boolean;
  /** From the price file's own column, never guessed. */
  manufacturer: string | null;
  priceListFile: string | null;
  /** `site_checked` only after the supplier's page was really read. A link, or a failed check, leaves it `file`. */
  priceOrigin: 'file' | 'site_checked';
  filePrice: string | null;
  siteCheck: SiteCheck | null;
}

export interface PartOffers {
  partId: string;
  partNumber: string;
  /** Same part number only. */
  offers: Offer[];
  /** Similar part numbers: never compatible by default, and never chosen automatically. */
  similar: Offer[];
}

export interface QuoteRequestItem {
  partId: string;
  quantity: number;
  offerId: string | null;
  confirmationId?: string;
}

export type LineStatus = 'priced' | 'no_price' | 'offer_missing';

export interface QuoteItem {
  partId: string;
  quantity: number;
  offer: Offer | null;
  unitPrice: string | null;
  currency: string | null;
  lineTotal: string | null;
  status: LineStatus;
  matchWarning: boolean;
  identification: { status: 'user_confirmed' | 'user_rejected' | 'document_only'; confirmationId: string | null };
}

export interface Quote {
  items: QuoteItem[];
  totals: Array<{ currency: string; amount: string; items: number }>;
  unpriced: number;
  warnings: string[];
  calculatedAt: string;
}
