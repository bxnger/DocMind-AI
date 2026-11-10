import { AppError } from '@/api/client';
import * as api from '@/api/procurement';
import type { ProcurementAdapter } from './types';

export function createLiveAdapter(documentId: string, language: string, canReadPhotos: boolean, canCheckPrices: boolean): ProcurementAdapter {
  return {
    isDemo: false,
    canReadPhotos,
    parts: async (signal) => {
      try {
        return await api.getParts(documentId, signal);
      } catch (error) {
        if (!(error instanceof AppError) || error.code !== 'PARTS_NOT_STARTED') throw error;
        // Starting twice is safe: the server returns the current result.
        await api.startParts(documentId, language);
        return api.getParts(documentId, signal);
      }
    },
    identify: (image) => api.identifyPart(documentId, image, language),
    confirm: (partId, input) => api.confirmPart(documentId, partId, input),
    priceLists: api.listPriceLists,
    uploadPriceList: api.uploadPriceList,
    deletePriceList: api.deletePriceList,
    offers: (partIds) => api.getOffers(documentId, partIds),
    ...(canCheckPrices ? { checkPrice: (offerId: string) => api.checkOfferPrices([offerId]) } : {}),
    quote: (items) => api.getQuote(documentId, items),
    exportQuote: (items, format) => api.exportQuote(documentId, items, format),
  };
}
