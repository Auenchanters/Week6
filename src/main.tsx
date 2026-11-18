/**
 * The browser entry: load the design tokens, set up zod and mount `App` on the page's root.
 * Never does: hold logic; it is excluded from coverage because it needs a real page.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// First, so the tokens and resets come before the feature CSS that `App` pulls in.
import './styles/base.css';
import './zod-setup.js';
import { App } from './app.js';

const container = document.getElementById('root');
if (container === null) throw new Error('Missing #root element in index.html');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
