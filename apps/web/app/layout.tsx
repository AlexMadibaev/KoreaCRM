import type { Metadata } from 'next';
import './globals.css';
import { PwaRegister } from '../components/pwa-register';

export const metadata: Metadata = {
  title: 'Korea CRM',
  description: 'Управление сетью магазинов',
  applicationName: 'Korea CRM',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'Korea CRM' },
  icons: { apple: '/icons/apple-touch-icon.png', icon: '/icons/icon-192.png' },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru"><body>{children}<PwaRegister /></body></html>;
}
