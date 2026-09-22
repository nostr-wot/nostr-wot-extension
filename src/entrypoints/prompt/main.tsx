import '@styles/tailwind.css';
import React from 'react';
import { initTheme } from '@services/appearance/theme.ts';
import ReactDOM from 'react-dom/client';
import { initI18n } from '@services/i18n/i18n.ts';
import PromptApp from './PromptApp';

Promise.all([initI18n(), initTheme()]).then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <PromptApp />
    </React.StrictMode>
  );
}).catch(console.error);
