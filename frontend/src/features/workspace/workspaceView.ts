export type Pane = 'document' | 'assistant';
export type LeftView = 'document' | 'map' | 'facts' | 'procurement';
export type Segment = LeftView | 'assistant';

export const SEGMENTS: readonly Segment[] = ['document', 'map', 'facts', 'procurement', 'assistant'];
/** The sample is not on the backend, so it has no facts to read. */
export const LEFT_VIEWS = (isSample: boolean, mode: string = 'general'): readonly LeftView[] => [
  'document',
  'map',
  ...(isSample ? [] : (['facts'] as const)),
  ...(mode === 'procurement' ? (['procurement'] as const) : []),
];

/** On narrow screens Document, Map, Facts and Assistant are one choice. Internally they stay two independent settings. */
export function segmentOf(pane: Pane, view: LeftView): Segment {
  return pane === 'assistant' ? 'assistant' : view;
}

export function applySegment(segment: Segment, view: LeftView): { pane: Pane; view: LeftView } {
  return segment === 'assistant' ? { pane: 'assistant', view } : { pane: 'document', view: segment };
}

/**
 * Hidden panes stay laid out but invisible, instead of display:none. That keeps scroll positions, the
 * measured PDF size and unsent text, and avoids re-rendering pages when switching.
 */
export const HIDDEN_PANE = 'pointer-events-none invisible absolute inset-0';
