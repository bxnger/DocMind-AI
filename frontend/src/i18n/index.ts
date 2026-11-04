import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { readStored, writeStored } from '@/lib/storage';
import en from './locales/en.json';
import kk from './locales/kk.json';
import ru from './locales/ru.json';

export const LANGUAGES = [
  { code: 'en', name: 'English', short: 'EN' },
  { code: 'ru', name: 'Русский', short: 'RU' },
  { code: 'kk', name: 'Қазақша', short: 'KZ' },
] as const;

export type Language = (typeof LANGUAGES)[number];

const STORAGE_KEY = 'docmind.language';
const saved = readStored<string>('local', STORAGE_KEY, 'en');

declare module 'i18next' {
  interface CustomTypeOptions {
    resources: { translation: typeof en };
    returnNull: false;
  }
}

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, ru: { translation: ru }, kk: { translation: kk } },
  lng: LANGUAGES.some((language) => language.code === saved) ? saved : 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  // Report any key that is missing from a locale instead of showing it silently.
  saveMissing: import.meta.env.DEV,
  missingKeyHandler: (_languages, _namespace, key) => console.error(`Missing translation: ${key}`),
});

i18n.on('languageChanged', (language) => writeStored('local', STORAGE_KEY, language));

export default i18n;
