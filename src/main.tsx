import React from 'react';
import ReactDOM from 'react-dom/client';
import { Buffer } from 'buffer';
import App from './App';
import './styles.css';
import { AppProviders } from './providers/AppProviders';

if (!globalThis.Buffer) {
  globalThis.Buffer = Buffer;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppProviders>
      <App />
    </AppProviders>
  </React.StrictMode>,
);
