import { describe, expect, it } from 'vitest';
import type { AssistantMessage, ChatMessage, EvidenceSource } from '@/types/chat';
import { evidenceReducer, jumpFor, resolveEvidence, sourceJump, stepTarget, type EvidencePick } from './evidenceState';

const rect = { x: 0.1, y: 0.4, w: 0.5, h: 0.02 };
const pdf = (index: number, page: number, extra: Partial<EvidenceSource> = {}): EvidenceSource => ({
  index, documentId: 'doc', documentName: 'a.pdf', page, location: null, quote: `quote ${index}`, ...extra,
});
const docx: EvidenceSource = { index: 1, documentId: 'doc', documentName: 'a.docx', page: null, location: 'Termination', quote: 'Ends in sixty days.' };

const answer = (id: string, sources: EvidenceSource[], answerStatus: 'answered' | 'not_found' = 'answered'): AssistantMessage => ({
  id, role: 'assistant', question: 'q', mode: 'live', text: 'text', sources, status: 'done', answerStatus,
});
const three = answer('m1', [pdf(1, 3, { highlights: [rect] }), pdf(2, 7), pdf(3, 7, { highlights: [rect] })]);
const messages: ChatMessage[] = [{ id: 'u1', role: 'user', text: 'q' }, three];
const pick = (sourceIndex: number, nonce = 1): EvidencePick => ({ messageId: 'm1', sourceIndex, nonce });

describe('navigation between several sources', () => {
  it('opens the picked source of the right answer', () => {
    const resolved = resolveEvidence(pick(2), messages);
    expect(resolved?.source.page).toBe(7);
    expect(resolved?.position).toBe(1);
    expect(resolved?.sources).toHaveLength(3);
  });

  it('steps forward and backward and wraps around at both ends', () => {
    const at = (index: number) => resolveEvidence(pick(index), messages)!;
    expect(stepTarget(at(1), 1)?.index).toBe(2);
    expect(stepTarget(at(3), 1)?.index).toBe(1);
    expect(stepTarget(at(1), -1)?.index).toBe(3);
    expect(stepTarget(at(2), -1)?.index).toBe(1);
  });

  it('has nowhere to step with a single source', () => {
    const single = resolveEvidence(pick(1), [answer('m1', [pdf(1, 2)])])!;
    expect(stepTarget(single, 1)).toBeNull();
    expect(stepTarget(single, -1)).toBeNull();
  });

  it('every pick gets a new nonce, so the same source can be shown again', () => {
    let state = evidenceReducer(null, { type: 'open', messageId: 'm1', sourceIndex: 2, nonce: 1 });
    state = evidenceReducer(state, { type: 'select', sourceIndex: 2, nonce: 2 });
    expect(state).toEqual({ messageId: 'm1', sourceIndex: 2, nonce: 2 });
    state = evidenceReducer(state, { type: 'refocus', nonce: 3 });
    expect(state?.nonce).toBe(3);
    expect(sourceJump(resolveEvidence(state, messages)!.source, state!.nonce, 'doc')?.nonce).toBe(3);
  });

  it('selecting or refocusing with nothing open does nothing, and close clears it', () => {
    expect(evidenceReducer(null, { type: 'select', sourceIndex: 1, nonce: 1 })).toBeNull();
    expect(evidenceReducer(null, { type: 'refocus', nonce: 1 })).toBeNull();
    expect(evidenceReducer(pick(1), { type: 'close' })).toBeNull();
  });
});

describe('the pick against the live conversation', () => {
  it('is gone when nothing is picked, the answer was cleared, or it is not an answer', () => {
    expect(resolveEvidence(null, messages)).toBeNull();
    expect(resolveEvidence(pick(1), [])).toBeNull();
    expect(resolveEvidence({ messageId: 'u1', sourceIndex: 1, nonce: 1 }, messages)).toBeNull();
  });

  it('is gone when a retried answer no longer has that source', () => {
    expect(resolveEvidence(pick(3), [answer('m1', [pdf(1, 3)])])).toBeNull();
  });

  it('is gone for a not_found answer, which has no sources to show', () => {
    expect(resolveEvidence(pick(1), [answer('m1', [pdf(1, 3)], 'not_found')])).toBeNull();
  });
});

describe('what the viewer is asked to do', () => {
  it('jumps to the page with the backend coordinates and the verbatim quote', () => {
    const jump = jumpFor(resolveEvidence(pick(1, 5), messages), 'doc');
    expect(jump).toEqual({ page: 3, quote: 'quote 1', highlights: [rect], nonce: 5 });
  });

  it('jumps to the page without highlights when the backend sent no coordinates', () => {
    const jump = jumpFor(resolveEvidence(pick(2), messages), 'doc');
    expect(jump?.page).toBe(7);
    expect(jump?.highlights).toBeUndefined();
    expect(jump?.quote).toBe('quote 2');
  });

  it('never makes up a page for a DOCX source', () => {
    expect(jumpFor(resolveEvidence(pick(1), [answer('m1', [docx])]), 'doc')).toBeNull();
  });

  it('does not jump for a source of another document', () => {
    expect(jumpFor(resolveEvidence(pick(1), [answer('m1', [pdf(1, 2, { documentId: 'other' })])]), 'doc')).toBeNull();
  });

  it('has no jump when nothing is picked', () => {
    expect(jumpFor(null, 'doc')).toBeNull();
    expect(sourceJump(null, 0, 'doc')).toBeNull();
  });
});
