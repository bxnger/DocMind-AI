export type DifferenceType = 'changed' | 'added' | 'removed';

export interface Evidence {
  page: number | null;
  quote: string;
}

export interface Difference {
  id: string;
  type: DifferenceType;
  explanation: string;
  /** Null for `added`. */
  a: Evidence | null;
  /** Null for `removed`. */
  b: Evidence | null;
}

export interface Comparison {
  id: string;
  documentAId: string;
  documentBId: string;
  status: 'processing' | 'ready' | 'failed';
  /** Fraction reported by the backend, or null. */
  progress: number | null;
  differences: Difference[];
  errorCode: string | null;
}
