export const routePermission: Record<string, string> = {
  '/orders': 'orders.view',
  '/dashboard': 'finance.view',
  '/reports': 'reports.view',
  '/products': 'products.view',
  '/stock': 'inventory.view',
  '/notifications': 'inventory.view',
  '/sales': 'sales.view',
  '/customers': 'customers.view',
  '/loyalty': 'settings.edit',
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
  return ['/dashboard', '/sales', '/orders', '/products', '/stock', '/customers', '/stores', '/employees', '/account'].find(path => !routePermission[path] || permissions.includes(routePermission[path])) ?? '/account';
}
