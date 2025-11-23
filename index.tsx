import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { v4 as uuidv4 } from 'uuid';

// Make uuid available globally for convenience if needed, or import where used
(window as any).uuidv4 = uuidv4;

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Kök eleman bulunamadı");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
