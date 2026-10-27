export interface AccessContext {
  userId: string;
  role?: string;
  primaryStoreId?: string | null;
  permissions: string[];
  allStores: boolean;
  storeIds: string[];
}

export function hasPermission(context: AccessContext, permission: string): boolean {
  return context.permissions.includes(permission);
}

export function canAccessStore(context: AccessContext, storeId: string): boolean {
  return context.allStores || context.storeIds.includes(storeId);
}
