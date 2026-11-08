import type { CapacitorConfig } from '@capacitor/cli';

/**
 * appId is provisional: it becomes permanent once the app is published to a store, so choose the final one before that.
 * The API address is not set here. It is built into the web code from VITE_API_BASE_URL, which production builds
 * require to be an https origin (see src/lib/deployEnv.ts), so no localhost reaches a release.
 */
const config: CapacitorConfig = {
  appId: 'kz.docmind.industry',
  appName: 'DOCMIND INDUSTRY',
  webDir: 'dist',
  android: {
    // Plain http from inside the app is refused, and WebView debugging stays off in release builds.
    allowMixedContent: false,
  },
};

export default config;
