import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'katex/dist/katex.min.css';
import './index.css';
import App from './App.jsx'
import { enforceSessionPersistence } from './utils/auth';

// Log out users who opted out of "remember me" once the browser session ends.
enforceSessionPersistence();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
