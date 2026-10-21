import React from 'react';
import ReactDOM from 'react-dom/client';
import { initTheme } from '@services/appearance/theme.ts';
import { initI18n } from '@services/i18n/i18n.ts';
import EntropyApp from './EntropyApp';
import '@styles/tailwind.css';

Promise.all([initI18n(), initTheme('')]).then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><EntropyApp /></React.StrictMode>);
}).catch(console.error);
