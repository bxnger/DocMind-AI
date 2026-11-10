import { useCallback, useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { onSessionReplaced } from '@/api/session';
import { useDocumentBlocks } from '@/features/documents/useDocumentContent';
import { useCapabilities } from '@/features/system/useSystem';
import { readStored, writeStored } from '@/lib/storage';
import { createDemoAdapter } from '@/services/procurement/demoAdapter';
import { createLiveAdapter } from '@/services/procurement/liveAdapter';
import type { ProcurementAdapter, SourceText } from '@/services/procurement/types';
import { isSampleDocument } from '@/services/sampleDocument';
import type { DocumentText } from '@/services/chat/demo/textIndex';
import type { DocumentModel } from '@/types/document';
import { NEW_LINE, quoteItems, type SheetLine } from './sheetLines';

const POLL_MS = 1500;

/** One demonstration per document, so choices survive switching tabs. It lives only in this page's memory. */
const demoAdapters = new Map<string, ProcurementAdapter>();
onSessionReplaced(() => demoAdapters.clear());

/** Real routes when the server says it has all of them. Otherwise the labelled demonstration. Never a silent mix. */
export function useProcurementAdapter(doc: DocumentModel, pdfText: DocumentText | undefined): ProcurementAdapter | null {
  const { i18n } = useTranslation();
  const capabilities = useCapabilities();
  const sample = isSampleDocument(doc.id);
  const decided = sample || !capabilities.isPending;
  const features = capabilities.data?.features;
  const live = !sample && features?.procurement === true && features.parts && features.priceLists;
  const isDocx = doc.kind === 'docx';
  const blocks = useDocumentBlocks(doc.id, decided && !live && isDocx && doc.status === 'ready');
  const language = i18n.language;
  const canReadPhotos = features?.photoIdentify === true;
  const canCheckPrices = features?.priceCheck === true;

  return useMemo(() => {
    if (!decided) return null;
    if (live) return createLiveAdapter(doc.id, language, canReadPhotos, canCheckPrices);
    const held = demoAdapters.get(doc.id);
    if (held) return held;
    let pages: SourceText[] | null = null;
    if (isDocx && blocks.data) pages = blocks.data.map((block) => ({ page: null, paragraph: block.index, location: block.section, text: block.text }));
    else if (!isDocx && pdfText) pages = pdfText.map((page) => ({ page: page.page, paragraph: null, location: null, text: page.text }));
    if (!pages) return null;
    const created = createDemoAdapter(pages, doc.id, doc.name);
    demoAdapters.set(doc.id, created);
    return created;
  }, [blocks.data, canCheckPrices, canReadPhotos, decided, doc.id, doc.name, isDocx, language, live, pdfText]);
}

export const sheetStorageKey = (documentId: string): string => `docmind.chat.procurement.${documentId}`;

export function useSheetLines(documentId: string) {
  const key = sheetStorageKey(documentId);
  const [lines, setLines] = useState<Record<string, SheetLine>>(() => readStored('session', key, {}));
  const updateMany = useCallback((changes: Record<string, Partial<SheetLine>>) => {
    setLines((current) => {
      const next = { ...current };
      for (const [partId, change] of Object.entries(changes)) next[partId] = { ...NEW_LINE, ...current[partId], ...change };
      writeStored('session', key, next);
      return next;
    });
  }, [key]);
  const update = useCallback((partId: string, change: Partial<SheetLine>) => updateMany({ [partId]: change }), [updateMany]);
  return { lines, update, updateMany };
}

/** The document must be ready first: asking earlier only earns an error from the server. */
export function useProcurement(documentId: string, adapter: ProcurementAdapter | null, lines: Record<string, SheetLine>, documentReady: boolean) {
  const scope = useMemo(() => ['procurement', documentId, adapter?.isDemo ?? null] as const, [adapter?.isDemo, documentId]);
  const need = (): ProcurementAdapter => {
    if (!adapter) throw new Error('Procurement is not ready');
    return adapter;
  };
  const partList = useQuery({
    queryKey: [...scope, 'parts'],
    queryFn: ({ signal }) => need().parts(signal),
    enabled: adapter !== null && documentReady,
    refetchInterval: (query) => (query.state.data?.status === 'processing' ? POLL_MS : false),
  });
  const ready = partList.data?.status === 'ready';
  const parts = useMemo(() => (ready ? (partList.data?.parts ?? []) : []), [partList.data, ready]);
  const priceLists = useQuery({ queryKey: [...scope, 'lists'], queryFn: ({ signal }) => need().priceLists(signal), enabled: adapter !== null });
  const partIds = parts.map((part) => part.id);
  const offers = useQuery({
    queryKey: [...scope, 'offers', partIds.join(), priceLists.data?.map((list) => list.id).join()],
    queryFn: () => need().offers(partIds),
    enabled: ready && partIds.length > 0 && priceLists.isSuccess,
  });
  const { items, withoutQuantity } = quoteItems(parts, lines);
  const quote = useQuery({
    queryKey: [...scope, 'quote', JSON.stringify(items), priceLists.data?.map((list) => list.id).join()],
    queryFn: () => need().quote(items),
    enabled: ready && items.length > 0,
    placeholderData: keepPreviousData,
  });
  return { partList, parts, priceLists, offers, quote, items, withoutQuantity };
}
