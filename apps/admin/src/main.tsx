import '@blog/tokens/tokens.css';
import '@blog/tokens/prose.css';
import './admin.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { UiLanguageProvider } from './i18n/UiLanguage.tsx';

const container = document.getElementById('root');
if (!container) throw new Error('No se encontró #root');

createRoot(container).render(
  <StrictMode>
    <UiLanguageProvider>
      <App />
    </UiLanguageProvider>
  </StrictMode>,
);
