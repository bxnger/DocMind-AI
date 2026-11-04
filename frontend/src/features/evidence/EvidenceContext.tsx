import { createContext, useContext, type ReactNode } from 'react';
import type { EvidenceSource } from '@/types/chat';

export interface EvidenceApi {
  /** The source being inspected, if any. */
  selected: { messageId: string; sourceIndex: number } | null;
  open: (messageId: string, source: EvidenceSource) => void;
}

const EvidenceContext = createContext<EvidenceApi | null>(null);

export function EvidenceProvider({ value, children }: { value: EvidenceApi; children: ReactNode }) {
  return <EvidenceContext.Provider value={value}>{children}</EvidenceContext.Provider>;
}

export function useEvidenceApi(): EvidenceApi {
  const context = useContext(EvidenceContext);
  if (!context) throw new Error('useEvidenceApi must be used inside EvidenceProvider');
  return context;
}
