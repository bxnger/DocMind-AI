import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { deployEnvProblems } from './deployEnv';

describe('production build settings', () => {
  it('accepts an https origin', () => {
    expect(deployEnvProblems({ VITE_API_BASE_URL: 'https://api.example.com' })).toEqual([]);
    expect(deployEnvProblems({ VITE_API_BASE_URL: 'https://api.example.com/' })).toEqual([]);
  });
  it('rejects a missing, plain http or local address', () => {
    expect(deployEnvProblems({})).toHaveLength(1);
    expect(deployEnvProblems({ VITE_API_BASE_URL: 'http://api.example.com' })[0]).toContain('https');
    expect(deployEnvProblems({ VITE_API_BASE_URL: 'http://127.0.0.1:8000' })[0]).toContain('this computer');
    expect(deployEnvProblems({ VITE_API_BASE_URL: 'nonsense' })[0]).toContain('valid');
  });
  it('allows a local address only when asked to', () => {
    expect(deployEnvProblems({ VITE_API_BASE_URL: 'http://127.0.0.1:8012', DOCMIND_ALLOW_LOCAL_API: '1' })).toEqual([]);
  });
  it('rejects a path or embedded credentials', () => {
    expect(deployEnvProblems({ VITE_API_BASE_URL: 'https://a.example/api/v1' })).toHaveLength(1);
    expect(deployEnvProblems({ VITE_API_BASE_URL: 'https://u:p@a.example' })).toHaveLength(1);
  });
  it('rejects secret-looking public variables and never repeats their value', () => {
    const problems = deployEnvProblems({ VITE_API_BASE_URL: 'https://a.example', VITE_GROQ_API_KEY: 'hidden-value' });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('VITE_GROQ_API_KEY');
    expect(problems[0]).not.toContain('hidden-value');
  });
});

describe('vercel.json', () => {
  const config = JSON.parse(readFileSync('vercel.json', 'utf8')) as {
    rewrites: { source: string; destination: string }[];
    headers: { source: string; headers: { key: string; value: string }[] }[];
  };
  const rewrite = new RegExp(`^${config.rewrites[0]?.source ?? ''}$`);
  it('sends deep links to the app but not missing assets', () => {
    expect(config.rewrites[0]?.destination).toBe('/index.html');
    for (const path of ['/', '/documents/abc', '/compare', '/settings']) expect(rewrite.test(path)).toBe(true);
    for (const path of ['/assets/x.js', '/pdfjs/cmaps/a.bcmap', '/demo/sample-agreement.pdf', '/favicon.svg']) expect(rewrite.test(path)).toBe(false);
  });
  it('allows the inline theme script by its exact hash', () => {
    const csp = config.headers.flatMap((rule) => rule.headers).find((header) => header.key === 'Content-Security-Policy')?.value ?? '';
    const script = /<script>([\s\S]*?)<\/script>/.exec(readFileSync('index.html', 'utf8'))?.[1] ?? '';
    expect(csp).toContain(`'sha256-${createHash('sha256').update(script).digest('base64')}'`);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  });
});
