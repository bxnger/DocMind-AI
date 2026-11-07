import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { onSessionReplaced } from '@/api/session';
import { useDocumentBlocks } from '@/features/documents/useDocumentContent';
import { useCapabilities } from '@/features/system/useSystem';
import { createDemoAdapter } from '@/services/procurement/demoAdapter';
import { createLiveAdapter } from '@/services/procurement/liveAdapter';
import type { ProcurementAdapter, SourceText } from '@/services/procurement/types';
import { isSampleDocument } from '@/services/sampleDocument';
import type { DocumentText } from '@/services/chat/demo/textIndex';
import type { Part, PartPatch } from '@/types/procurement';
import type { DocumentModel } from '@/types/document';

/** One demonstration per document, so edits survive switching tabs. It lives only in this page's memory. */
const demoAdapters = new Map<string, ProcurementAdapter>();
onSessionReplaced(() => demoAdapters.clear());

/** Real routes when the server says it has them. Otherwise the labelled demonstration. Never a silent mix of the two. */
export function useProcurementAdapter(doc: DocumentModel, pdfText: DocumentText | undefined): ProcurementAdapter | null {
  const capabilities = useCapabilities();
  const sample = isSampleDocument(doc.id);
  const decided = sample || !capabilities.isPending;
  const live = !sample && capabilities.data?.procurement === true;
  const isDocx = doc.kind === 'docx';
  const blocks = useDocumentBlocks(doc.id, decided && !live && isDocx && doc.status === 'ready');

  return useMemo(() => {
    if (!decided) return null;
    if (live) return createLiveAdapter(doc.id);
    const held = demoAdapters.get(doc.id);
    if (held) return held;
    let pages: SourceText[] | null = null;
    if (isDocx && blocks.data) pages = blocks.data.map((block) => ({ page: null, paragraph: block.index, location: block.section, text: block.text }));
    else if (!isDocx && pdfText) pages = pdfText.map((page) => ({ page: page.page, paragraph: null, location: null, text: page.text }));
    if (!pages) return null;
    const created = createDemoAdapter(pages);
    demoAdapters.set(doc.id, created);
    return created;
  }, [blocks.data, decided, doc.id, isDocx, live, pdfText]);
}

export function useProcurement(documentId: string, adapter: ProcurementAdapter | null, priceListId: string | null) {
  const client = useQueryClient();
  const scope = ['procurement', documentId, adapter?.isDemo ?? null] as const;
  const enabled = adapter !== null;
  const need = (): ProcurementAdapter => {
    if (!adapter) throw new Error('Procurement is not ready');
    return adapter;
  };
  const parts = useQuery({ queryKey: [...scope, 'parts'], queryFn: () => need().parts(), enabled, staleTime: Infinity });
  const sheet = useQuery({ queryKey: [...scope, 'sheet', priceListId], queryFn: ({ signal }) => need().sheet(priceListId, signal), enabled: enabled && parts.isSuccess });
  const priceLists = useQuery({ queryKey: [...scope, 'lists'], queryFn: ({ signal }) => need().priceLists(signal), enabled });
  const refresh = () => client.invalidateQueries({ queryKey: scope });

  const partsKey = [...scope, 'parts'];
  const updatePart = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: PartPatch }) => need().updatePart(id, patch),
    // The line changes at once. If the server refuses, it goes back and the panel says why.
    onMutate: ({ id, patch }) => {
      void client.cancelQueries({ queryKey: partsKey });
      const before = client.getQueryData<Part[]>(partsKey);
      client.setQueryData<Part[]>(partsKey, (list) => list?.map((part) => (part.id === id ? { ...part, ...patch } : part)));
      return { before };
    },
    onError: (_error, _variables, context) => client.setQueryData(partsKey, context?.before),
    onSettled: refresh,
  });
  const selectOffer = useMutation({ mutationFn: ({ partId, offerId }: { partId: string; offerId: string | null }) => need().selectOffer(partId, offerId), onSuccess: refresh });

  return { parts, sheet, priceLists, updatePart, selectOffer, refresh };
}
