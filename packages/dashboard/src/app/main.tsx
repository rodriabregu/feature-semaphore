import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('#root element not found — index.html is missing <div id="root">');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
