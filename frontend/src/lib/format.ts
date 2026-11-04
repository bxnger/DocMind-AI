export function formatBytes(bytes: number, locale: string): string {
  const units = ['byte', 'kilobyte', 'megabyte', 'gigabyte'] as const;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: units[unit],
    unitDisplay: 'short',
    maximumFractionDigits: value >= 10 || unit === 0 ? 0 : 1,
  }).format(value);
}

/**
 * Chrome ships no Kazakh date data: Intl renders "2026 M11 4" and "-2 h". Kazakh is one of
 * the product's three languages, so these two formats are written out by hand.
 */
const KK_MONTHS = ['қаңтар', 'ақпан', 'наурыз', 'сәуір', 'мамыр', 'маусым', 'шілде', 'тамыз', 'қыркүйек', 'қазан', 'қараша', 'желтоқсан'];
const KK_UNITS: Partial<Record<Intl.RelativeTimeFormatUnit, string>> = { minute: 'минут', hour: 'сағат', day: 'күн' };

export function formatDate(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  if (locale === 'kk') return `${date.getDate()} ${KK_MONTHS[date.getMonth()]} ${date.getFullYear()}`;
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

const RELATIVE_STEPS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['minute', 60],
  ['hour', 3600],
  ['day', 86400],
];

export function formatRelative(iso: string, locale: string, now = Date.now()): string {
  const seconds = (new Date(iso).getTime() - now) / 1000;
  if (Number.isNaN(seconds)) return '';
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (Math.abs(seconds) < 60) return locale === 'kk' ? 'жаңа ғана' : format.format(0, 'minute');
  for (let i = RELATIVE_STEPS.length - 1; i >= 0; i -= 1) {
    const step = RELATIVE_STEPS[i];
    if (step && Math.abs(seconds) >= step[1]) {
      if (step[0] === 'day' && Math.abs(seconds) >= 7 * 86400) return formatDate(iso, locale);
      const value = Math.round(seconds / step[1]);
      return locale === 'kk' ? `${Math.abs(value)} ${KK_UNITS[step[0]]} бұрын` : format.format(value, step[0]);
    }
  }
  return formatDate(iso, locale);
}
