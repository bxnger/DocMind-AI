import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/features/settings/theme';
import '@/i18n';
import '@/styles/index.css';
import { App } from '@/app/App';
import { isNativeApp } from '@/features/native/platform';

// The app draws under the system bars, so its frame needs their insets. The website is untouched.
if (isNativeApp()) document.documentElement.classList.add('native-app');

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
