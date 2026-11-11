import { describe, expect, it } from 'vitest';
import { offerSource } from './offerSource';

describe('where an offer comes from', () => {
  it('names the three sources and lets test data win', () => {
    expect(offerSource({ demo: false, store: 'industrialmotion.kz', source: 'store_catalog' })).toBe('store');
    expect(offerSource({ demo: false, store: null, source: 'price_list' })).toBe('file');
    expect(offerSource({ demo: true, store: null, source: 'price_list' })).toBe('test');
    expect(offerSource({ demo: true, store: 'x.kz', source: 'store_catalog' })).toBe('test');
  });
});
