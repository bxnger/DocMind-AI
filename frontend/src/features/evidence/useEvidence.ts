import { useCallback, useMemo, useReducer, useRef } from 'react';
import type { ChatMessage, EvidenceSource } from '@/types/chat';
import { evidenceReducer, resolveEvidence, stepTarget } from './evidenceState';

/** Which source of which answer is being inspected, resolved against the live conversation. */
export function useEvidence(messages: readonly ChatMessage[]) {
  const [pick, dispatch] = useReducer(evidenceReducer, null);
  const counter = useRef(0);
  const next = () => (counter.current += 1);

  const selection = useMemo(() => resolveEvidence(pick, messages), [pick, messages]);

  const open = useCallback((messageId: string, source: EvidenceSource) => {
    dispatch({ type: 'open', messageId, sourceIndex: source.index, nonce: next() });
  }, []);
  const select = useCallback((sourceIndex: number) => dispatch({ type: 'select', sourceIndex, nonce: next() }), []);
  const refocus = useCallback(() => dispatch({ type: 'refocus', nonce: next() }), []);
  const close = useCallback(() => dispatch({ type: 'close' }), []);
  const step = useCallback(
    (delta: 1 | -1) => {
      const target = selection && stepTarget(selection, delta);
      if (target) dispatch({ type: 'select', sourceIndex: target.index, nonce: next() });
    },
    [selection],
  );

  return { selection, open, select, step, refocus, close };
}
