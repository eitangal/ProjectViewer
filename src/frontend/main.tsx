import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.js';
import './index.css';
import { useViewerStore, applyThemeToDom } from './store/useViewerStore.js';

// Ensure DOM matches persisted theme preference
applyThemeToDom(useViewerStore.getState().theme);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
