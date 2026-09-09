import React from 'react';
import ReactDOM from 'react-dom/client';
import { initI18n } from '@services/i18n/i18n.ts';
import PopupApp from './PopupApp';

initI18n().then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <PopupApp />
    </React.StrictMode>
  );
}).catch(console.error);
