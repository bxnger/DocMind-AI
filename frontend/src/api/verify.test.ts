import { describe, expect, it } from 'vitest';
import { toClaimCheck } from './verify';

const source = { index: 1, documentId: 'd', documentName: 'n', page: 2, location: null, quote: 'q' };

describe('a claim check answer', () => {
  it.each(['supported', 'partly', 'contradicted'])('keeps %s with its explanation and source', (verdict) => {
    expect(toClaimCheck({ verdict, explanation: 'e', sources: [source] })).toMatchObject({ verdict, explanation: 'e', sources: [{ page: 2, quote: 'q' }] });
  });
  it('never shows a verdict without a source', () => {
    expect(toClaimCheck({ verdict: 'supported', explanation: 'trust me', sources: [] })).toEqual({ verdict: 'not_found', explanation: '', sources: [] });
    expect(toClaimCheck({ verdict: 'contradicted', explanation: 'x' }).verdict).toBe('not_found');
  });
  it('not found carries no invented text, and keeps a known reason', () => {
    expect(toClaimCheck({ verdict: 'not_found', explanation: 'made up', sources: [source], reason: 'model_refused' })).toEqual({ verdict: 'not_found', explanation: '', sources: [], reason: 'model_refused' });
    expect(toClaimCheck({ verdict: 'not_found', reason: 'whatever' })).not.toHaveProperty('reason');
  });
  it('refuses an unknown verdict', () => {
    expect(() => toClaimCheck({ verdict: 'true' })).toThrow();
    expect(() => toClaimCheck(null)).toThrow();
  });
});
