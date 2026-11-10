import type { EvidenceSource } from './chat';

/** Mirrors section 5 of backend/docs/API-PROCUREMENT.md. There is deliberately no score and no hiring recommendation. */
export type RequirementStatus = 'confirmed' | 'partial' | 'not_found';

export interface HrRequirement {
  requirement: string;
  kind: 'must' | 'nice';
  status: RequirementStatus;
  explanation: string;
  evidence: EvidenceSource[];
  vacancySource: EvidenceSource | null;
}

export interface HrCoverage {
  confirmed: number;
  partial: number;
  notFound: number;
}

export interface HrMatch {
  id: string;
  status: 'processing' | 'ready' | 'failed';
  errorCode: string | null;
  requirements: HrRequirement[];
  skills: Array<{ name: string; evidence: EvidenceSource[] }>;
  coverage: { must: HrCoverage; nice: HrCoverage };
  notice: string | null;
}
