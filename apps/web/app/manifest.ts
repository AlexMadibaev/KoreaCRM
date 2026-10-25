import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Korea CRM',
    short_name: 'Korea CRM',
    description: 'Управление магазином',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#f7f8fc',
    theme_color: '#424242',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
