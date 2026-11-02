import { createRoot } from 'react-dom/client';
import { App } from './app';
import '../../../packages/ui/src/tokens.css';
import '../../../packages/ui/src/components.css';
import './style.css';
import './premium.css';
import './pos-redesign.css';
import './pos-workspace.css';
import '@fontsource/oswald/400.css';
import '@fontsource/oswald/500.css';
import '@fontsource/oswald/600.css';
import '@fontsource/oswald/700.css';
// The cashier screen styles come last so they win over the older global element rules.
import './cloud-pos.css';

createRoot(document.getElementById('root')!).render(<App />);
