import { describe, expect, it } from 'vitest';
import { toHrMatch } from '@/api/hr';
import en from '@/i18n/locales/en.json';
import kk from '@/i18n/locales/kk.json';
import ru from '@/i18n/locales/ru.json';
import { compareTexts } from './demoMatch';

const block = (index: number, text: string, page: number | null = 1) => ({ index, kind: 'paragraph' as const, section: null, page, text });
const vacancy = { id: 'v', name: 'vacancy.pdf', blocks: [block(0, 'Требуется опыт работы Python и FastAPI от трёх лет. Желательно знание английского языка. Возраст от 25 до 35 лет, требуется опыт. Мы дружный коллектив в центре города.')] };
const resume = { id: 'r', name: 'resume.docx', blocks: [block(3, 'Работал с Python и FastAPI три года в компании.', null)] };

describe('the demonstration comparison', () => {
  const match = compareTexts(resume, vacancy);
  it('reads requirements from the vacancy, word for word', () => {
    expect(match.requirements.map((item) => item.requirement)).toContain('Требуется опыт работы Python и FastAPI от трёх лет.');
  });
  it('tells required from desirable', () => {
    expect(match.requirements.find((item) => item.requirement.startsWith('Желательно'))?.kind).toBe('nice');
    expect(match.requirements.find((item) => item.requirement.startsWith('Требуется'))?.kind).toBe('must');
  });
  it('never takes a personal trait for a requirement', () => {
    expect(match.requirements.some((item) => /Возраст/.test(item.requirement))).toBe(false);
  });
  it('supports a status only with a real quote and its place', () => {
    const python = match.requirements.find((item) => item.requirement.startsWith('Требуется'));
    expect(python?.status).not.toBe('not_found');
    expect(python?.evidence[0]).toMatchObject({ documentId: 'r', page: null, paragraph: 3, quote: 'Работал с Python и FastAPI три года в компании.' });
    expect(python?.vacancySource).toMatchObject({ documentId: 'v', page: 1 });
  });
  it('a requirement without a match has no evidence', () => {
    const language = match.requirements.find((item) => item.requirement.startsWith('Желательно'));
    expect(language).toMatchObject({ status: 'not_found', evidence: [] });
  });
  it('counts, and gives no score of any kind', () => {
    const total = match.coverage.must.confirmed + match.coverage.must.partial + match.coverage.must.notFound + match.coverage.nice.confirmed + match.coverage.nice.partial + match.coverage.nice.notFound;
    expect(total).toBe(match.requirements.length);
    expect(Object.keys(match)).not.toContain('score');
    expect(JSON.stringify(Object.keys(match.coverage.must))).not.toMatch(/percent|score/);
  });
});

describe('answers of the real API', () => {
  const source = { index: 1, documentId: 'r', documentName: 'n', page: 1, quote: 'q' };
  it('reads a result', () => {
    const match = toHrMatch({ id: 'm1', status: 'ready', requirements: [{ requirement: 'R', kind: 'must', status: 'confirmed', explanation: 'e', evidence: [source], vacancySource: source }], skills: [{ name: 'S', evidence: [source] }, { name: 'none', evidence: [] }], coverage: { must: { confirmed: 1, partial: 0, notFound: 0 }, nice: { confirmed: 0, partial: 0, notFound: 2 } }, notice: 'n' });
    expect(match.requirements[0]).toMatchObject({ status: 'confirmed', kind: 'must' });
    expect(match.coverage.nice.notFound).toBe(2);
    expect(match.skills.map((skill) => skill.name)).toEqual(['S']);
  });
  it('does not show "confirmed" without a quote from the resume', () => {
    const match = toHrMatch({ id: 'm', status: 'ready', requirements: [{ requirement: 'R', status: 'confirmed', evidence: [] }] });
    expect(match.requirements[0]?.status).toBe('not_found');
  });
  it('drops any score the server might send', () => {
    expect(Object.keys(toHrMatch({ id: 'm', status: 'ready', score: 90, recommendation: 'hire' }))).not.toContain('score');
    expect(Object.keys(toHrMatch({ id: 'm', status: 'ready', score: 90, recommendation: 'hire' }))).not.toContain('recommendation');
  });
});

describe('the wording', () => {
  it.each([['en', en], ['ru', ru], ['kk', kk]])('%s says a person decides', (_name, locale) => {
    expect(locale.hr.notice.length).toBeGreaterThan(40);
  });
});
