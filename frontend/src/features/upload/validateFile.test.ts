import { describe, expect, it } from 'vitest';
import { validateFile } from './validateFile';

const MB = 1024 * 1024;

describe('validateFile', () => {
  it('accepts PDF and DOCX in any letter case', () => {
    expect(validateFile({ name: 'a.pdf', size: 10 }, MB)).toBeNull();
    expect(validateFile({ name: 'ЕРЕЖЕ.DOCX', size: 10 }, MB)).toBeNull();
  });
  it('rejects other types by extension', () => {
    expect(validateFile({ name: 'a.txt', size: 10 }, MB)).toEqual({ code: 'unsupported' });
    expect(validateFile({ name: 'pdf', size: 10 }, MB)).toEqual({ code: 'unsupported' });
  });
  it('rejects empty files', () => {
    expect(validateFile({ name: 'a.pdf', size: 0 }, MB)).toEqual({ code: 'empty' });
  });
  it('rejects files above the limit but not at it', () => {
    expect(validateFile({ name: 'a.pdf', size: MB }, MB)).toBeNull();
    expect(validateFile({ name: 'a.pdf', size: MB + 1 }, MB)).toEqual({ code: 'too-large', limitBytes: MB });
  });
});
