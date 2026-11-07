import type { Marking, Part, PartPatch, PriceList, Sheet } from '@/types/procurement';

/** What the panel needs. The real API and the labelled demonstration data both provide it. */
export interface ProcurementAdapter {
  /** True: nothing from this adapter may be presented as a real offer. */
  readonly isDemo: boolean;
  parts(): Promise<Part[]>;
  updatePart(id: string, patch: PartPatch): Promise<Part>;
  uploadMarking(file: File): Promise<Marking>;
  confirmMarking(id: string, text: string): Promise<Marking>;
  priceLists(signal?: AbortSignal): Promise<PriceList[]>;
  uploadPriceList(file: File, supplier: string): Promise<PriceList>;
  sheet(priceListId: string | null, signal?: AbortSignal): Promise<Sheet>;
  selectOffer(partId: string, offerId: string | null): Promise<void>;
  exportSheet(priceListId: string | null, format: 'csv' | 'xlsx'): Promise<Blob>;
}

/** The document's real text, wherever it comes from. */
export interface SourceText {
  page: number | null;
  paragraph: number | null;
  location: string | null;
  text: string;
}
