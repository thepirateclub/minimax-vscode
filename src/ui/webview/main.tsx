import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import styles from './styles.css';

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };

const styleElement = document.createElement('style');
styleElement.textContent = styles;
document.head.appendChild(styleElement);

const container = document.getElementById('root');
if (!container) {
  throw new Error('root element is missing');
}

createRoot(container).render(
  <StrictMode>
    <App vscode={acquireVsCodeApi()} />
  </StrictMode>
);
