/** Build-time rules for a production bundle. Used by vite.config.ts, so a wrong setting fails the build. */

const SECRET_NAME = /KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL/i;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Returns what is wrong with the environment. An empty list means the build may go on. */
export function deployEnvProblems(env: Record<string, string | undefined>): string[] {
  const problems: string[] = [];
  // Everything named VITE_* ends up in public JavaScript. Only the name is reported, never the value.
  for (const name of Object.keys(env)) {
    if (name.startsWith('VITE_') && SECRET_NAME.test(name)) problems.push(`${name} looks like a secret, and VITE_ variables are public. Keep it on the backend.`);
  }
  const url = env.VITE_API_BASE_URL?.trim();
  if (!url) return [...problems, 'VITE_API_BASE_URL is not set. Set it to the backend origin, such as https://api.example.com.'];
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return [...problems, 'VITE_API_BASE_URL is not a valid URL.'];
  }
  const local = LOCAL_HOSTS.has(parsed.hostname);
  // Only for trying the production bundle on this computer.
  if (local && env.DOCMIND_ALLOW_LOCAL_API !== '1') problems.push('VITE_API_BASE_URL points to this computer, which visitors cannot reach.');
  if (!local && parsed.protocol !== 'https:') problems.push('VITE_API_BASE_URL must use https.');
  if (parsed.username || parsed.password) problems.push('VITE_API_BASE_URL must not contain credentials.');
  if (parsed.pathname.replace(/\/+$/, '') !== '' || parsed.search) problems.push('VITE_API_BASE_URL must be only the origin, without /api/v1.');
  return problems;
}
