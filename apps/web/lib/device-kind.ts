export type DeviceKind = 'pos' | 'web' | 'other';

export function deviceKind(deviceId: string): DeviceKind {
  if (deviceId.startsWith('WEB-')) return 'web';
  if (deviceId.startsWith('POS-')) return 'pos';
  return 'other';
}

export function shortDeviceCode(deviceId: string) {
  return deviceId.replace(/^(?:WEB|POS)-/, '').slice(0, 8).toUpperCase();
}
