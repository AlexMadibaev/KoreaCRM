import { invoke } from '@tauri-apps/api/core';

export type QueueStatus = 'PENDING' | 'SYNCING' | 'SYNCED' | 'ERROR' | 'CONFLICT';
export type QueueEntry = { operationId: string; storeId: string; entityType: 'SALE'; entityId: string; payloadJson: string; createdAt: string; attempts: number; status: QueueStatus; error: string | null };
export type QueueSummary = { pending: number; syncing: number; synced: number; errors: number; conflicts: number; lastSyncedAt: string | null };

export function enqueueSale(userId: string, storeId: string, operationId: string, payload: unknown) {
  return invoke<void>('enqueue_sale', { userId, storeId, operationId, payloadJson: JSON.stringify(payload) });
}

export function listSyncQueue(userId: string, storeId: string) {
  return invoke<QueueEntry[]>('list_sync_queue', { userId, storeId });
}

export function syncQueueSummary(userId: string, storeId: string) {
  return invoke<QueueSummary>('sync_queue_summary', { userId, storeId });
}

export function setSyncStatus(userId: string, storeId: string, operationId: string, status: Exclude<QueueStatus, 'PENDING'>, error: string | null = null) {
  return invoke<void>('set_sync_status', { userId, storeId, operationId, status, error });
}

export function retryConflictSale(userId: string, storeId: string, operationId: string) {
  return invoke<void>('retry_conflict_sale', { userId, storeId, operationId });
}
