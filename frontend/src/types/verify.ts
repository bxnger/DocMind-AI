import type { EvidenceSource, NotFoundReason } from './chat';

export type Verdict = 'supported' | 'partly' | 'contradicted' | 'not_found';

export interface ClaimCheck {
  verdict: Verdict;
  explanation: string;
  sources: EvidenceSource[];
  reason?: NotFoundReason;
}
