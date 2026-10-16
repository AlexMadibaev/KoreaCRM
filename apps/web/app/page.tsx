'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../lib/api';
import { firstCabinetPath } from '../lib/access';
import { accessToken, ensureAccessToken } from '../lib/session';

export default function Home() {
  const router = useRouter();
  useEffect(() => {
    ensureAccessToken()
      .then(token => token ? api<{ permissions: string[] }>('/auth/me') : null)
      .then(me => router.replace(me ? firstCabinetPath(me.permissions) : '/login'))
      .catch(() => router.replace(accessToken() ? '/offline' : '/login'));
  }, [router]);
  return <main className="crm-loading">Открываем кабинет…</main>;
}
