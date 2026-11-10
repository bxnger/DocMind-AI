import type { Confirmation, ConfirmationInput, PartList, PartOffers, PhotoMatch, PriceList, PriceListInput, Quote, QuoteRequestItem } from '@/types/procurement';

/** What the panel needs. The real API and the labelled demonstration data both provide it. */
export interface ProcurementAdapter {
  /** True: nothing from this adapter may be presented as real. */
  readonly isDemo: boolean;
  /** False hides the photo step: the server has no vision configured. */
  readonly canReadPhotos: boolean;
  parts(signal?: AbortSignal): Promise<PartList>;
  identify(image: File): Promise<PhotoMatch>;
  /** Only the demonstration has it: it reads no photos, so a person types the marking. */
  identifyText?(text: string): Promise<PhotoMatch>;
  confirm(partId: string, input: ConfirmationInput): Promise<Confirmation>;
  priceLists(signal?: AbortSignal): Promise<PriceList[]>;
  uploadPriceList(file: File, input: PriceListInput): Promise<PriceList>;
  deletePriceList(id: string): Promise<void>;
  offers(partIds: string[]): Promise<PartOffers[]>;
  /** Only when the server offers it. The demonstration never checks a site. */
  checkPrice?(offerId: string): Promise<void>;
  quote(items: QuoteRequestItem[]): Promise<Quote>;
  exportQuote(items: QuoteRequestItem[], format: 'csv' | 'xlsx'): Promise<Blob>;
}

/** The document's real text, wherever it comes from. */
export interface SourceText {
  page: number | null;
  paragraph: number | null;
  location: string | null;
  text: string;
}
