import type { PosStore } from '@koreacrm/types';

const connectionKey = (apiUrl: string) => `koreacrm-pos-store-connection-v1:${apiUrl.trim().replace(/\/+$/, '')}`;

export function readStoreConnection(storage: Pick<Storage, 'getItem'>, apiUrl: string): PosStore | null {
  try {
    const raw = storage.getItem(connectionKey(apiUrl));
    const store: unknown = raw ? JSON.parse(raw) : null;
    if (!store || typeof store !== 'object' || !('id' in store) || !('name' in store) || !('code' in store)) return null;
    if (typeof store.id !== 'string' || !store.id || typeof store.name !== 'string' || typeof store.code !== 'string' || !store.code) return null;
    return { id: store.id, name: store.name, code: store.code };
  } catch { return null; }
}

export function saveStoreConnection(storage: Pick<Storage, 'setItem'>, apiUrl: string, store: PosStore) {
  storage.setItem(connectionKey(apiUrl), JSON.stringify(store));
}

export function requireMatchingStore(connection: PosStore | null, storeId: string) {
  if (!connection || connection.id !== storeId) throw new Error('Эта касса настроена для другой точки. Обратитесь к администратору.');
}
