export const loyaltyEditPermissions = ['settings.edit', 'loyalty.edit'] as const;
export type PermissionRequirement = string | readonly string[];

export function meetsPermission(permissions: string[], requirement?: PermissionRequirement) {
  if (!requirement) return true;
  return typeof requirement === 'string' ? permissions.includes(requirement) : requirement.some(code => permissions.includes(code));
}

export const routePermission: Record<string, PermissionRequirement> = {
  '/orders': 'orders.view',
  '/dashboard': 'finance.view',
  '/reports': 'reports.view',
  '/products': 'products.view',
  '/stock': 'inventory.view',
  '/notifications': 'inventory.view',
  '/sales': 'sales.view',
  '/customers': 'customers.view',
  '/loyalty': loyaltyEditPermissions,
  '/payment-methods': 'settings.edit',
  '/brands': 'brands.view',
  '/categories': 'categories.view',
  '/suppliers': 'suppliers.view',
  '/purchases': 'purchases.view',
  '/transfers': 'transfers.view',
  '/inventories': 'inventory.view',
  '/employees': 'employees.view',
  '/stores': 'stores.view',
  '/finance': 'finance.view',
  '/finance/categories': 'finance.view',
};

export function firstCabinetPath(permissions: string[]) {
  return ['/dashboard', '/sales', '/orders', '/products', '/stock', '/customers', '/stores', '/employees', '/account'].find(path => meetsPermission(permissions, routePermission[path])) ?? '/account';
}
