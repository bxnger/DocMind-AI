import { describe, expect, it } from 'vitest';
import { CAN_SHOW_ON_PAGE, evidenceStatus } from './status';

const ready = { viewer: 'ready', foreign: false } as const;

describe('evidenceStatus', () => {
  it('reports how the passage was found when the viewer is ready', () => {
    expect(evidenceStatus({ ...ready, kind: 'coordinates' })).toBe('coordinates');
    expect(evidenceStatus({ ...ready, kind: 'text' })).toBe('text');
    expect(evidenceStatus({ ...ready, kind: 'page' })).toBe('page');
    expect(evidenceStatus({ ...ready, kind: 'unknown' })).toBe('unknown');
  });

  it('never claims a highlight when there are no coordinates and no text match', () => {
    const status = evidenceStatus({ ...ready, kind: 'page' });
    expect(status).not.toBe('coordinates');
    expect(status).not.toBe('text');
  });

  it('describes loading, errors and a missing preview instead of a location', () => {
    expect(evidenceStatus({ kind: 'coordinates', viewer: 'loading', foreign: false })).toBe('viewerLoading');
    expect(evidenceStatus({ kind: 'text', viewer: 'error', foreign: false })).toBe('viewerError');
    expect(evidenceStatus({ kind: 'page', viewer: 'unavailable', foreign: false })).toBe('viewerUnavailable');
  });

  it('describes DOCX as a section, whatever the viewer is doing', () => {
    for (const viewer of ['ready', 'loading', 'error', 'unavailable'] as const) {
      expect(evidenceStatus({ kind: 'section', viewer, foreign: false })).toBe('section');
    }
  });

  it('puts a source of another document first', () => {
    expect(evidenceStatus({ kind: 'coordinates', viewer: 'ready', foreign: true })).toBe('otherDocument');
  });

  it('offers "show on page" only when there is a page on screen to show', () => {
    expect(CAN_SHOW_ON_PAGE.has('coordinates')).toBe(true);
    for (const status of ['section', 'viewerError', 'viewerLoading', 'viewerUnavailable', 'otherDocument'] as const) {
      expect(CAN_SHOW_ON_PAGE.has(status)).toBe(false);
    }
  });
});
