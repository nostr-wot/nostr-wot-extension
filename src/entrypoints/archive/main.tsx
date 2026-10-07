import React from 'react';
import ReactDOM from 'react-dom/client';
import { initTheme } from '@services/appearance/theme';
import { ensureDefaultLocale, initI18n } from '@services/i18n/i18n';
import { startPopup } from '@services/appearance/popupStartup';
import ArchiveApp from './ArchiveApp';

const root = ReactDOM.createRoot(document.getElementById('root')!);
startPopup(() => Promise.allSettled([initI18n(), initTheme(window.location.search)]), () => {
  ensureDefaultLocale();
  root.render(<React.StrictMode><ArchiveApp /></React.StrictMode>);
});
