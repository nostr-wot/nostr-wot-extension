import React from 'react';
import { initTheme } from '@services/appearance/theme.ts';
import ReactDOM from 'react-dom/client';
import { initI18n, ensureDefaultLocale } from '@services/i18n/i18n.ts';
import PopupApp from './PopupApp';
import { startPopup } from '@services/appearance/popupStartup.ts';
import { rpcNotify } from '@services/rpc.ts';

// Start waking the background now. A cold worker evaluates its whole bundle
// before it answers anything, and the providers only ask once React mounts;
// this lets that start overlap preference loading and the first render.
// vault_exists is a read with no gate in front of it.
rpcNotify('vault_exists');

const root = ReactDOM.createRoot(document.getElementById('root')!);
startPopup(() => Promise.allSettled([initI18n(), initTheme(window.location.search)]), () => {
  ensureDefaultLocale();
  root.render(
    <React.StrictMode>
      <PopupApp />
    </React.StrictMode>
  );
});
