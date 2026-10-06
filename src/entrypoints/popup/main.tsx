import React from 'react';
import { initTheme } from '@services/appearance/theme.ts';
import ReactDOM from 'react-dom/client';
import { initI18n, ensureDefaultLocale } from '@services/i18n/i18n.ts';
import PopupApp from './PopupApp';
import { startPopup } from '@services/appearance/popupStartup.ts';

const root = ReactDOM.createRoot(document.getElementById('root')!);
startPopup(() => Promise.allSettled([initI18n(), initTheme(window.location.search)]), () => {
  ensureDefaultLocale();
  root.render(
    <React.StrictMode>
      <PopupApp />
    </React.StrictMode>
  );
});
