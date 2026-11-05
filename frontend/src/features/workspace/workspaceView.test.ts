import { describe, expect, it } from 'vitest';
import { trapTarget } from '@/lib/focusTrap';
import { SEGMENTS, applySegment, segmentOf } from './workspaceView';

describe('narrow-screen view switching', () => {
  it('shows the assistant whatever the left view is', () => {
    expect(segmentOf('assistant', 'map')).toBe('assistant');
    expect(segmentOf('document', 'map')).toBe('map');
    expect(segmentOf('document', 'document')).toBe('document');
  });
  it('going to the assistant remembers document or map', () => {
    expect(applySegment('assistant', 'map')).toEqual({ pane: 'assistant', view: 'map' });
    expect(applySegment('document', 'map')).toEqual({ pane: 'document', view: 'document' });
  });
  it('every segment round-trips', () => {
    for (const segment of SEGMENTS) {
      const { pane, view } = applySegment(segment, 'document');
      expect(segmentOf(pane, view)).toBe(segment);
    }
  });
});

describe('menu focus trap', () => {
  const items = ['a', 'b', 'c'];
  it('wraps at both ends and leaves the middle to the browser', () => {
    expect(trapTarget(items, 'c', false)).toBe('a');
    expect(trapTarget(items, 'a', true)).toBe('c');
    expect(trapTarget(items, 'b', false)).toBeNull();
  });
  it('pulls focus back in when it is outside', () => {
    expect(trapTarget(items, 'x', false)).toBe('a');
    expect(trapTarget(items, null, true)).toBe('c');
  });
  it('does nothing with nothing focusable', () => {
    expect(trapTarget([], null, false)).toBeNull();
  });
});
