/** Exact money: decimal strings on the wire, whole minor units for arithmetic, so 0.1 + 0.2 stays 0.30. */
const AMOUNT = /^\d+(?:\.\d{1,2})?$/;

export function toMinor(amount: string): bigint | null {
  const clean = amount.trim().replace(/\s/g, '').replace(',', '.');
  if (!AMOUNT.test(clean)) return null;
  const [whole = '0', fraction = ''] = clean.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}

export function fromMinor(minor: bigint): string {
  const fraction = (minor % 100n).toString().padStart(2, '0');
  return `${minor / 100n}.${fraction}`;
}

export function formatMoney(amount: string, currency: string, language: string): string {
  const value = Number(amount);
  if (!Number.isFinite(value)) return `${amount} ${currency}`;
  try {
    return new Intl.NumberFormat(language, { style: 'currency', currency, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${new Intl.NumberFormat(language, { minimumFractionDigits: 2 }).format(value)} ${currency}`; // not an ISO code
  }
}
