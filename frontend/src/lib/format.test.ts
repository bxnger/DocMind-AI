import { describe, expect, it } from 'vitest';
import { formatBytes, formatDate, formatRelative, shortFileName } from './format';

const NOW = new Date('2026-11-04T12:00:00Z').getTime();
const ago = (seconds: number) => new Date(NOW - seconds * 1000).toISOString();

describe('formatDate', () => {
  it('writes Kazakh dates out in full', () => {
    expect(formatDate('2026-11-04T12:00:00Z', 'kk')).toBe('4 қараша 2026');
  });
  it('returns nothing for an invalid date', () => {
    expect(formatDate('nonsense', 'en')).toBe('');
  });
});

describe('formatRelative', () => {
  it('handles Kazakh units', () => {
    expect(formatRelative(ago(10), 'kk', NOW)).toBe('жаңа ғана');
    expect(formatRelative(ago(300), 'kk', NOW)).toBe('5 минут бұрын');
    expect(formatRelative(ago(7200), 'kk', NOW)).toBe('2 сағат бұрын');
    expect(formatRelative(ago(172800), 'kk', NOW)).toBe('2 күн бұрын');
  });
  it('uses Intl for other languages', () => {
    expect(formatRelative(ago(7200), 'en', NOW)).toBe('2 hours ago');
  });
  it('falls back to a date after a week', () => {
    expect(formatRelative(ago(30 * 86400), 'en', NOW)).toMatch(/2026/);
  });
});

describe('formatBytes', () => {
  it('picks a readable unit', () => {
    expect(formatBytes(20 * 1024 * 1024, 'en')).toBe('20 MB');
    expect(formatBytes(1536, 'en')).toBe('1.5 kB');
  });
});

describe('shortFileName', () => {
  it('keeps short names', () => {
    expect(shortFileName('tv320_manual.pdf')).toBe('tv320_manual.pdf');
  });
  it('cuts the middle, keeps the start and the extension', () => {
    const long = 'Өте ұзын атауы бар құжат — очень длинное название файла версия 2026 финальная.pdf';
    const short = shortFileName(long);
    expect(Array.from(short).length).toBeLessThanOrEqual(40);
    expect(short.startsWith('Өте ұзын')).toBe(true);
    expect(short.endsWith('финальная.pdf')).toBe(true);
    expect(short).toContain('…');
  });
});
