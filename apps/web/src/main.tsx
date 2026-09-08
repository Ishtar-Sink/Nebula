import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { initIdentity } from './identity.ts';
import './styles.css';

// The server address and the device label can come from a file the desktop shell owns, so
// they must be resolved before anything opens a connection. Rendering from the callback
// instead of a top-level await keeps the entry chunk free of it.
void initIdentity().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
