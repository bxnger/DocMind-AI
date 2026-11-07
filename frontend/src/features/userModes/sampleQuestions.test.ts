import { describe, expect, it } from 'vitest';
import en from '@/i18n/locales/en.json';
import kk from '@/i18n/locales/kk.json';
import ru from '@/i18n/locales/ru.json';
import { USER_MODES } from './modes';
import { MODE_SAMPLE_QUESTIONS, sampleQuestionAliases } from './sampleQuestions';

describe('sample questions follow the professional mode', () => {
  it('switches visible questions between Business and Student, rather than merely reordering them', () => {
    const business = MODE_SAMPLE_QUESTIONS.business.slice(0, 3).map(({ key }) => ru.home.sample[key as keyof typeof ru.home.sample]);
    const student = MODE_SAMPLE_QUESTIONS.student.slice(0, 3).map(({ key }) => ru.home.sample[key as keyof typeof ru.home.sample]);
    expect(business).not.toEqual(student);
    expect(business[0]).not.toBe(student[0]);
  });

  it('provides three distinct, translated questions for every mode', () => {
    for (const locale of [en, ru, kk]) {
      for (const mode of USER_MODES) {
        const questions = MODE_SAMPLE_QUESTIONS[mode];
        expect(questions.length).toBeGreaterThanOrEqual(3);
        const labels = questions.map(({ key }) => locale.home.sample[key as keyof typeof locale.home.sample]);
        expect(labels.every(Boolean)).toBe(true);
        expect(new Set(labels).size).toBe(labels.length);
      }
    }
  });

  it('maps every specialized question back to a documented sample fact in the same language', () => {
    for (const locale of [en, ru, kk]) {
      const tr = (path: string) => locale.home.sample[path.replace('home.sample.', '') as keyof typeof locale.home.sample];
      const aliases = sampleQuestionAliases(tr);
      for (const mode of USER_MODES) {
        for (const { key, source } of MODE_SAMPLE_QUESTIONS[mode]) {
          if (key !== source) expect(aliases.get(tr(`home.sample.${key}`))).toBe(tr(`home.sample.${source}`));
        }
      }
    }
  });
});
