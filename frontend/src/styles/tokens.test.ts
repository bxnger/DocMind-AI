import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/styles/index.css', 'utf8');
const scope = (start: string) => css.slice(css.indexOf(start));
const color = (block: string, name: string) => {
  const hex = new RegExp(`--color-${name}: (#[0-9a-f]{6})`).exec(block)?.[1];
  if (!hex) throw new Error(`no token ${name}`);
  return hex;
};
const luminance = (hex: string) => {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

describe('design tokens meet WCAG AA text contrast', () => {
  const light = scope('@theme');
  it.each([
    ['fg', 'bg'], ['muted', 'bg'], ['muted', 'sidebar'], ['muted', 'card'], ['accent', 'bg'], ['accent', 'card'],
    ['on-accent', 'accent'], ['fg', 'accent-2-tint'], ['accent-2', 'card'], ['success', 'card'], ['warning', 'card'], ['danger', 'card'],
  ])('%s on %s', (text, surface) => {
    expect(contrast(color(light, text), color(light, surface))).toBeGreaterThanOrEqual(4.5);
  });

  const ink = scope('.theme-ink');
  it.each([['fg', 'sidebar'], ['muted', 'sidebar'], ['muted', 'card'], ['accent', 'sidebar'], ['on-accent', 'accent']])('navigation: %s on %s', (text, surface) => {
    expect(contrast(color(ink, text), color(ink, surface))).toBeGreaterThanOrEqual(4.5);
  });
});
