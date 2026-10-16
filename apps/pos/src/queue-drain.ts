export type DrainEntry = { operationId: string; payloadJson: string; status: string };

export async function drainQueue(
  entries: DrainEntry[],
  send: (entry: DrainEntry) => Promise<void>,
  mark: (entry: DrainEntry, status: 'SYNCING' | 'SYNCED' | 'ERROR' | 'CONFLICT', error?: string) => Promise<void>,
  isConflict: (error: unknown) => boolean,
): Promise<{ synced: number; conflicts: number; stopped: boolean }> {
  let synced = 0;
  let conflicts = 0;
  for (const entry of entries) {
    if (entry.status === 'CONFLICT') continue;
    try {
      await mark(entry, 'SYNCING');
      await send(entry);
      await mark(entry, 'SYNCED');
      synced += 1;
    } catch (error) {
      if (isConflict(error)) {
        await mark(entry, 'CONFLICT', error instanceof Error ? error.message : String(error));
        conflicts += 1;
      } else {
        await mark(entry, 'ERROR', error instanceof Error ? error.message : String(error));
        return { synced, conflicts, stopped: true };
      }
    }
  }
  return { synced, conflicts, stopped: false };
}
