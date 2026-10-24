import { createRoot } from 'react-dom/client';
import { App } from './app';
import '../../../packages/ui/src/tokens.css';
import '../../../packages/ui/src/components.css';
import './style.css';
import './premium.css';
import './pos-redesign.css';

createRoot(document.getElementById('root')!).render(<App />);
