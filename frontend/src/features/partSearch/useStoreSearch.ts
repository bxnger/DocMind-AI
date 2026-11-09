import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { lookupBarcode, searchStores } from '@/api/procurement';
import { AppError } from '@/api/client';
import type { BarcodeLookup, StoreSearchInput, StoreSearchResult } from '@/types/procurement';

/** The catalogue is still being built after the server started. It asks for 10–20 s, so 15 s, and only twice. */
export const BUILD_RETRY_MS = 15_000;
export const BUILD_RETRIES = 2;

export const isBuilding = (result: StoreSearchResult): boolean =>
  result.offers.length === 0 && result.similar.length === 0 && result.sources.some((source) => source.reason === 'index_building');

export type SearchState =
  | { status: 'idle' }
  | { status: 'loading'; input: StoreSearchInput; attempt: number }
  | { status: 'done'; input: StoreSearchInput; result: StoreSearchResult; codes?: BarcodeLookup['codes'] }
  /** Still building after the last automatic try: the person decides whether to try again. */
  | { status: 'building'; input: StoreSearchInput; result: StoreSearchResult; attempt: number; retryAt: number | null }
  /** 429: said, never repeated by itself. */
  | { status: 'limit'; input: StoreSearchInput; retryAfter: number | null; busy: boolean }
  | { status: 'error'; input: StoreSearchInput; error: unknown };

type Attempt = (input: StoreSearchInput, count: number, call: () => Promise<StoreSearchResult & { codes?: BarcodeLookup['codes'] }>) => Promise<void>;

const isLimit = (error: unknown): error is AppError => error instanceof AppError && error.status === 429;

/**
 * One store search at a time. A search for a document part also refreshes that document's offers, where the server has
 * put what it found. Nothing here polls: a building catalogue gets at most two delayed tries, a limit none.
 */
export function useStoreSearch() {
  const client = useQueryClient();
  const [state, setState] = useState<SearchState>({ status: 'idle' });
  const timer = useRef<number | undefined>(undefined);
  const generation = useRef(0);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  // Kept in a ref: a delayed retry calls the same function again.
  const attempt = useRef<Attempt>(async () => {});
  useEffect(() => {
    attempt.current = async (input, count, call) => {
    window.clearTimeout(timer.current);
    const mine = ++generation.current;
    setState({ status: 'loading', input, attempt: count });
    try {
      const result = await call();
      if (mine !== generation.current) return;
      if ('documentId' in input) await client.invalidateQueries({ queryKey: ['procurement', input.documentId] });
      if (isBuilding(result)) {
        const more = count < BUILD_RETRIES;
        setState({ status: 'building', input, result, attempt: count, retryAt: more ? Date.now() + BUILD_RETRY_MS : null });
        if (more) timer.current = window.setTimeout(() => void attempt.current(input, count + 1, call), BUILD_RETRY_MS);
        return;
      }
      setState({ status: 'done', input, result, ...(result.codes ? { codes: result.codes } : {}) });
    } catch (error) {
      if (mine !== generation.current) return;
      setState(isLimit(error) ? { status: 'limit', input, retryAfter: error.retryAfter, busy: error.code === 'SEARCH_BUSY' } : { status: 'error', input, error });
    }
    };
  }, [client]);

  const search = useCallback((input: StoreSearchInput) => attempt.current(input, 0, () => searchStores(input)), []);

  /** A code the phone read, or a photo it could not read. The server reads the photo only then. */
  const barcode = useCallback((source: { text: string } | { image: File }) => {
    const input: StoreSearchInput = { query: 'text' in source ? source.text : '', kind: 'barcode' };
    return attempt.current(input, 0, async () => {
      const found = await lookupBarcode(source);
      const lookup = found.lookup ?? { query: input.query, searchedAs: null, kind: 'barcode', reason: null, offers: [], similar: [], unconfirmed: [], sources: [], searchedAt: null };
      return { ...lookup, codes: found.codes };
    });
  }, []);

  const reset = useCallback(() => {
    window.clearTimeout(timer.current);
    generation.current += 1;
    setState({ status: 'idle' });
  }, []);

  /** The person's own "try again", also after the automatic tries ran out. */
  const retry = useCallback(() => {
    if (state.status === 'idle' || state.status === 'loading') return;
    void search(state.input);
  }, [search, state]);

  return { state, search, barcode, retry, reset };
}
