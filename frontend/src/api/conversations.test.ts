import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@/types/chat';
import { tidyHistory, toSource } from './conversations';

const base = { index: 2, documentId: 'd', documentName: 'n', quote: 'q' };

describe('toSource', () => {
  it('keeps PDF page and highlights', () => {
    const rect = { x: 0.1, y: 0.2, w: 0.3, h: 0.01 };
    expect(toSource({ ...base, page: 4, highlights: [rect] })).toMatchObject({ index: 2, page: 4, location: null, highlights: [rect] });
  });
  it('keeps a null page and the location for DOCX', () => {
    const source = toSource({ ...base, page: null, location: 'Terms' });
    expect(source.page).toBeNull();
    expect(source.location).toBe('Terms');
    expect(source.highlights).toBeUndefined();
  });
  it('rejects the old marker field', () => {
    expect(() => toSource({ marker: 1, documentId: 'd', documentName: 'n', quote: 'q' })).toThrow();
  });
});

describe('history after failed attempts', () => {
  const user = (id: string, text: string): ChatMessage => ({ id, role: 'user', text });
  const answer = (id: string, question: string): ChatMessage => ({ id, role: 'assistant', question, mode: 'live', text: 'a', sources: [], status: 'done', answerStatus: 'answered' });
  it('shows a retried question once', () => {
    const tidy = tidyHistory([user('1', 'q'), user('2', 'q'), user('3', 'q'), answer('4', 'q')]);
    expect(tidy.map((message) => message.id)).toEqual(['3', '4']);
  });
  it('gives an unanswered question a reply that can be retried', () => {
    const tidy = tidyHistory([user('1', 'first'), user('2', 'second'), answer('3', 'second'), user('4', 'last')]);
    expect(tidy.map((message) => message.id)).toEqual(['1', '1:unanswered', '2', '3', '4', '4:unanswered']);
    const last = tidy.at(-1);
    expect(last).toMatchObject({ role: 'assistant', status: 'stopped', question: 'last', text: '' });
  });
  it('leaves a normal conversation alone, including the same question asked again later', () => {
    const list = [user('1', 'q'), answer('2', 'q'), user('3', 'q'), answer('4', 'q')];
    expect(tidyHistory(list)).toEqual(list);
  });
});
