import { describe, expect, it } from 'vitest';
import { frequentTerms, queryTerms, retrievePassages, splitPassages } from './retrieval';
import type { DocumentText } from './textIndex';

const page = (n: number, text: string) => ({ page: n, items: [text], text });

const contract: DocumentText = [
  page(1, 'The Provider will send an invoice each month. Overdue amounts accrue late payment interest of 1.5 percent per month.'),
  page(2, 'Either party may terminate this Agreement by giving at least 60 days of written notice. The liability of each party is capped at the fees paid.'),
];

describe('retrievePassages', () => {
  it('returns the verbatim sentence and its real page', () => {
    const [first] = retrievePassages(contract, 'What is the notice period for termination?');
    expect(first?.page).toBe(2);
    expect(first?.quote).toBe('Either party may terminate this Agreement by giving at least 60 days of written notice.');
  });

  it('every returned quote exists on its page', () => {
    for (const passage of retrievePassages(contract, 'late payment interest and liability')) {
      expect(contract[passage.page - 1]?.text).toContain(passage.quote);
    }
  });

  it('returns nothing when the question is not covered', () => {
    expect(retrievePassages(contract, 'Does the agreement cover parental leave?')).toEqual([]);
  });

  it('returns nothing for a question made only of stopwords', () => {
    expect(retrievePassages(contract, 'what is the')).toEqual([]);
  });

  it('matches inflected Russian and Kazakh forms', () => {
    const ru: DocumentText = [page(1, 'Срок оплаты счёта составляет тридцать дней с момента выставления.')];
    expect(retrievePassages(ru, 'Какой срок оплаты?')).toHaveLength(1);
    const kk: DocumentText = [page(3, 'Команда құрамындағы қатысушылар саны үш адамнан аспауы тиіс.')];
    const [hit] = retrievePassages(kk, 'Команда құрамында қанша қатысушылар болады?');
    expect(hit?.page).toBe(3);
  });

  it('respects the limit and drops duplicate passages', () => {
    const repeated: DocumentText = [
      page(1, 'Confidential data must be protected at all times.'),
      page(2, 'Confidential data must be protected at all times.'),
    ];
    expect(retrievePassages(repeated, 'confidential data')).toHaveLength(1);
  });
});

describe('queryTerms', () => {
  it('removes stopwords in all three languages', () => {
    expect(queryTerms('what is the')).toEqual([]);
    expect(queryTerms('где в документе')).toEqual([]);
    expect(queryTerms('құжатта қай жерде аталады')).toEqual([]);
  });
});

describe('splitPassages', () => {
  it('splits long text without losing words', () => {
    const long = Array.from({ length: 200 }, (_, i) => `word${i}`).join(' ');
    const parts = splitPassages(long);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.join(' ')).toBe(long);
  });
});

describe('frequentTerms', () => {
  it('suggests only words present in the document', () => {
    const terms = frequentTerms(contract);
    expect(terms.length).toBeGreaterThan(0);
    const all = contract.map((p) => p.text.toLowerCase()).join(' ');
    for (const term of terms) expect(all).toContain(term);
  });
});
