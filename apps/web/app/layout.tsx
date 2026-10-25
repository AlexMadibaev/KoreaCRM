import type { Metadata, Viewport } from 'next';
import '../../../packages/ui/src/tokens.css';
import '../../../packages/ui/src/components.css';
import './globals.css';
import './design-system.css';
import { PwaRegister } from '../components/pwa-register';

export const metadata: Metadata = {
  title: 'Korea CRM',
  description: 'Управление сетью магазинов',
  applicationName: 'Korea CRM',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'Korea CRM' },
  icons: {
    apple: '/icons/apple-touch-icon.png',
    icon: [{ url: '/icons/app-icon.svg?v=3', type: 'image/svg+xml' }, { url: '/icons/icon-32.png?v=3', type: 'image/png', sizes: '32x32' }, { url: '/favicon.ico?v=3', sizes: 'any' }],
  },
};

// The cabinet behaves like an installed app on phones: no pinch or double-tap zoom, content under the notch is padded with safe-area insets.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  interactiveWidget: 'resizes-content',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru"><body>{children}<PwaRegister /></body></html>;
}
