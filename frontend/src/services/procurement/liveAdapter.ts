import * as api from '@/api/procurement';
import type { ProcurementAdapter } from './types';

export function createLiveAdapter(documentId: string): ProcurementAdapter {
  return {
    isDemo: false,
    parts: () => api.extractParts(documentId),
    updatePart: api.patchPart,
    uploadMarking: (file) => api.uploadMarking(documentId, file),
    confirmMarking: api.confirmMarking,
    priceLists: api.listPriceLists,
    uploadPriceList: api.uploadPriceList,
    sheet: (priceListId, signal) => api.getSheet(documentId, priceListId, signal),
    selectOffer: api.selectOffer,
    exportSheet: (priceListId, format) => api.exportSheet(documentId, priceListId, format),
  };
}
