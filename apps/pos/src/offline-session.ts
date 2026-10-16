import { invoke } from '@tauri-apps/api/core';
import type { PosPaymentMethod, PosShift, PosStore } from '@koreacrm/types';

const iterations = 600_000;
const encoder = new TextEncoder();
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const decode = (value: string) => Uint8Array.from(atob(value), char => char.charCodeAt(0));

export type OfflineSession = { userId: string; storeId: string; storeJson: string; methodsJson: string; permissionsJson: string; salt: string; verifier: string; shiftJson: string | null };

export async function passwordVerifier(password: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: decode(salt), iterations }, key, 256);
  return encode(new Uint8Array(bits));
}

export function sameVerifier(left: string, right: string): boolean {
  const a = decode(left), b = decode(right);
  let difference = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  return difference === 0;
}

export async function saveOfflineSession(input: { deviceId: string; apiUrl: string; login: string; password: string; userId: string; store: PosStore; methods: PosPaymentMethod[]; permissions: string[] }): Promise<void> {
  const salt = encode(crypto.getRandomValues(new Uint8Array(16)));
  const verifier = await passwordVerifier(input.password, salt);
  await invoke('save_offline_session', { input: { deviceId: input.deviceId, apiUrl: input.apiUrl, login: input.login, userId: input.userId, storeId: input.store.id, storeJson: JSON.stringify(input.store), methodsJson: JSON.stringify(input.methods), permissionsJson: JSON.stringify(input.permissions), salt, verifier } });
}

export function readOfflineSession(deviceId: string, apiUrl: string, login: string): Promise<OfflineSession | null> {
  return invoke<OfflineSession | null>('read_offline_session', { deviceId, apiUrl, login });
}

export function markOfflineSessionReady(deviceId: string, apiUrl: string, login: string, store: PosStore, shift: PosShift | null): Promise<void> {
  return invoke('mark_offline_session_ready', { deviceId, apiUrl, login, storeId: store.id, storeJson: JSON.stringify(store), shiftJson: shift ? JSON.stringify(shift) : null });
}

export function clearOfflineSession(deviceId: string, apiUrl: string, login: string): Promise<void> {
  return invoke('clear_offline_session', { deviceId, apiUrl, login });
}
