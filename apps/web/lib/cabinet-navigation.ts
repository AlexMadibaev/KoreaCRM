export type CabinetLink = { href: string; label: string; permission?: string; superuser?: boolean };
export type CabinetGroup = { title: string; icon: string; links: CabinetLink[] };

export const cabinetGroups: CabinetGroup[] = [
  { title: 'Главная', icon: 'overview', links: [{ href: '/dashboard', label: 'Обзор бизнеса', permission: 'finance.view' }] },
  { title: 'Товары и склад', icon: 'catalog', links: [
    { href: '/products', label: 'Товары', permission: 'products.view' },
    { href: '/stock', label: 'Остатки', permission: 'inventory.view' },
    { href: '/brands', label: 'Бренды', permission: 'brands.view' },
    { href: '/categories', label: 'Категории', permission: 'categories.view' },
  ] },
  { title: 'Кассы и смены', icon: 'tills', links: [
    { href: '/finance#cash-shifts', label: 'Кассовые смены', permission: 'finance.cash_view' },
    { href: '/stores', label: 'Магазины и устройства', permission: 'stores.view' },
  ] },
  { title: 'Движение товара', icon: 'movement', links: [
    { href: '/sales', label: 'Продажи и возвраты', permission: 'sales.view' },
    { href: '/purchases', label: 'Закупки', permission: 'purchases.view' },
    { href: '/transfers', label: 'Перемещения', permission: 'transfers.view' },
    { href: '/inventories', label: 'Инвентаризации', permission: 'inventory.view' },
  ] },
  { title: 'Движение денег', icon: 'money', links: [
    { href: '/finance', label: 'Финансы и расходы', permission: 'finance.view' },
    { href: '/finance/categories', label: 'Категории расходов', permission: 'finance.view' },
  ] },
  { title: 'Отчёты', icon: 'overview', links: [{ href: '/reports', label: 'Отчёты', permission: 'reports.view' }] },
  { title: 'Контрагенты', icon: 'people', links: [
    { href: '/customers', label: 'Клиенты и долги', permission: 'customers.view' },
    { href: '/suppliers', label: 'Поставщики', permission: 'suppliers.view' },
  ] },
  { title: 'Компания', icon: 'company', links: [
    { href: '/employees', label: 'Сотрудники и роли', permission: 'employees.view' },
    { href: '/loyalty', label: 'Лояльность', permission: 'settings.edit' },
    { href: '/payment-methods', label: 'Способы оплаты', permission: 'settings.edit' },
    { href: '/audit', label: 'Журнал действий', superuser: true },
  ] },
];

export const createLinks: CabinetLink[] = [
  { href: '/sales#new-sale', label: 'Продажа', permission: 'sales.create' },
  { href: '/purchases', label: 'Закупка', permission: 'purchases.create' },
  { href: '/transfers', label: 'Перемещение', permission: 'transfers.create' },
  { href: '/inventories', label: 'Инвентаризация', permission: 'inventory.start' },
  { href: '/products/new', label: 'Товар', permission: 'products.create' },
];

export function visibleCabinetLinks(links: CabinetLink[], permissions: string[], role: string) {
  return links.filter(link => link.superuser ? role === 'SUPERUSER' : !link.permission || permissions.includes(link.permission));
}

export function cabinetLinkActive(href: string, pathname: string, hash: string) {
  const [path, anchor] = href.split('#');
  return (pathname === path || pathname.startsWith(`${path}/`) && path === '/products') && (anchor ? hash === `#${anchor}` : !hash || path !== '/finance');
}
