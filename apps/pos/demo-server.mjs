import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const host = '127.0.0.1';
const port = Number(process.env.KOREACRM_DEMO_PORT ?? 3001);
const store = { id: 'demo-store', code: 'DEMO', name: 'Демо-магазин' };
const brands = [{ id: 'demo-brand', name: 'K-Beauty Lab' }];
const categories = [{ id: 'demo-category', name: 'Уход за кожей', parentId: null }];
const products = [
  { id: 'demo-cream', name: 'Крем для лица Centella', sku: 'KR-001', status: 'ACTIVE', barcodes: [{ value: '4600000000011' }], priceMinor: 129000, quantity: 24 },
  { id: 'demo-serum', name: 'Сыворотка с ниацинамидом', sku: 'KR-002', status: 'ACTIVE', barcodes: [{ value: '4600000000028' }], priceMinor: 189000, quantity: 18 },
  { id: 'demo-cleanser', name: 'Очищающая пенка', sku: 'KR-003', status: 'ACTIVE', barcodes: [{ value: '4600000000035' }], priceMinor: 95000, quantity: 32 },
];
const customers = [
  { id: 'demo-customer-1', firstName: 'Анна', lastName: 'Иванова', phone: '+998901234567', email: null, birthday: '1995-04-12T00:00:00.000Z', gender: 'Женский', address: null, notes: 'Предпочитает уход для чувствительной кожи', discountPercent: '0', bonusBalanceMinor: '15000', debtBalanceMinor: '0', totalSpentMinor: '0', averageCheckMinor: '0', ordersCount: 0 },
  { id: 'demo-customer-2', firstName: 'Мария', lastName: 'Ким', phone: '+998909876543', email: null, birthday: null, gender: null, address: 'Ташкент, Чиланзар', notes: null, discountPercent: '0', bonusBalanceMinor: '0', debtBalanceMinor: '0', totalSpentMinor: '0', averageCheckMinor: '0', ordersCount: 0 },
];
const methods = [
  { id: 'demo-cash', code: 'CASH', name: 'Наличные', kind: 'CASH', active: true },
  { id: 'demo-card', code: 'CARD', name: 'Карта', kind: 'CARD', active: true },
  { id: 'demo-bonus', code: 'BONUS', name: 'Бонусы', kind: 'BONUS', active: true },
  { id: 'demo-qr', code: 'QR', name: 'QR', kind: 'QR', active: true },
  { id: 'demo-debt', code: 'DEBT', name: 'В долг', kind: 'DEBT', active: true },
];
const permissions = [
  'products.view', 'products.create', 'products.edit', 'brands.view', 'brands.create', 'brands.edit', 'categories.view', 'categories.create', 'categories.edit',
  'inventory.view', 'inventory.adjust', 'inventory.start', 'inventory.count', 'inventory.complete', 'inventory.cancel',
  'sales.view', 'sales.create', 'sales.return', 'customers.view', 'customers.create', 'customers.edit',
  'suppliers.view', 'suppliers.create', 'suppliers.edit', 'purchases.view', 'purchases.create', 'purchases.edit', 'purchases.submit', 'purchases.receive', 'purchases.cancel',
  'transfers.view', 'transfers.create', 'transfers.edit', 'transfers.request', 'transfers.approve', 'transfers.send', 'transfers.receive', 'transfers.cancel',
  'finance.view', 'finance.edit', 'finance.cash_view', 'finance.cash', 'finance.supplier_pay', 'finance.customer_pay',
  'employees.view', 'employees.create', 'employees.edit', 'reports.view', 'settings.edit',
];
const demoRoles = [
  { id: randomUUID(), code: 'OWNER', name: 'Владелец', system: true, permissions: permissions.map(code => ({ permission: { code } })) },
  { id: randomUUID(), code: 'MANAGER', name: 'Менеджер', system: true, permissions: ['sales.view', 'sales.create', 'sales.return', 'customers.view', 'inventory.adjust', 'employees.view'].map(code => ({ permission: { code } })) },
  { id: randomUUID(), code: 'CASHIER', name: 'Кассир', system: true, permissions: ['sales.view', 'sales.create', 'sales.return', 'customers.view', 'finance.cash_view', 'finance.cash'].map(code => ({ permission: { code } })) },
];
const demoEmployees = [
  { id: 'demo-user', name: 'Демо администратор', login: 'demo', active: true, allStores: true, roleId: demoRoles[0].id, role: demoRoles[0], stores: [], createdAt: new Date().toISOString() },
  { id: randomUUID(), name: 'Менеджер магазина', login: 'manager', active: true, allStores: false, roleId: demoRoles[1].id, role: demoRoles[1], stores: [{ storeId: store.id }], createdAt: new Date().toISOString() },
];
const demoPasswords = new Map([['demo-user', 'demo1234'], [demoEmployees[1].id, 'manager1234']]);
const demoSessions = new Map([['demo-local-token', 'demo-user']]);
const demoRefreshSessions = new Map([['demo-local-refresh', 'demo-user']]);
const demoAudit = [];
function recordAudit(userId, action, entityType, entityId, deviceId = null) {
  const employee = demoEmployees.find(value => value.id === userId);
  demoAudit.unshift({ id: randomUUID(), userId, action, entityType, entityId, createdAt: new Date().toISOString(), ip: null, deviceId, user: employee ? { id: employee.id, name: employee.name, login: employee.login } : null });
}
recordAudit('demo-user', 'EMPLOYEE_CREATED', 'User', demoEmployees[1].id);
const shifts = new Map();
const expenseCategories = [{ id: 'demo-expense-category', name: 'Хозяйственные расходы' }];
const expenses = new Map();
const cashOperations = new Map();
const sales = new Map();
const returns = new Map();
const customerPayments = new Map();
const customerDebtEntries = [];
const customerComments = [
  { id: randomUUID(), customerId: 'demo-customer-1', text: 'Клиент просил сообщить, когда снова появится крем Centella.', createdAt: new Date().toISOString(), author: { id: 'demo-user', name: demoEmployees[0].name, login: demoEmployees[0].login } },
];
const bonusTransactions = [
  { id: randomUUID(), operationId: randomUUID(), customerId: 'demo-customer-1', actorId: 'demo-user', actor: { name: demoEmployees[0].name }, type: 'CORRECTION', deltaMinor: '15000', balanceAfterMinor: '15000', reason: 'Начальный бонусный баланс для демо', createdAt: new Date().toISOString() },
];
function updateAverage(customer) { customer.averageCheckMinor = customer.ordersCount ? String((BigInt(customer.totalSpentMinor) + BigInt(Math.floor(customer.ordersCount / 2))) / BigInt(customer.ordersCount)) : '0'; }
const segmentDefinitions = {
  NEW: { label: 'Новый', description: 'Не более одной действующей покупки' },
  REGULAR: { label: 'Постоянный', description: 'Не менее трёх действующих покупок' },
  VIP: { label: 'VIP', description: 'Не менее пяти действующих покупок и 5 000 000 сум потрачено' },
  DORMANT: { label: 'Давно не покупал', description: 'Последняя покупка была более 90 дней назад' },
  HIGH_CHECK: { label: 'Высокий средний чек', description: 'Средний чек не ниже 500 000 сум' },
  FREQUENT: { label: 'Частые покупки', description: 'Не менее трёх покупок за последние 30 дней' },
};
function customerSegments(customer) {
  const purchases = [...sales.values()].filter(sale => sale.customer?.id === customer.id && sale.status === 'COMPLETED').sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const latest = purchases[0]?.createdAt ?? null;
  const dormantCutoff = new Date(Date.now() - 90 * 86400000).toISOString();
  const frequentCutoff = new Date(Date.now() - 30 * 86400000).toISOString();
  const codes = [];
  if (customer.ordersCount <= 1) codes.push('NEW');
  if (customer.ordersCount >= 3) codes.push('REGULAR');
  if (customer.ordersCount >= 5 && BigInt(customer.totalSpentMinor) >= 500000000n) codes.push('VIP');
  if (latest && latest < dormantCutoff) codes.push('DORMANT');
  if (customer.ordersCount > 0 && BigInt(customer.averageCheckMinor) >= 50000000n) codes.push('HIGH_CHECK');
  if (customer.ordersCount >= 3 && purchases.filter(sale => sale.createdAt >= frequentCutoff).length >= 3) codes.push('FREQUENT');
  return { items: codes.map(code => ({ code, ...segmentDefinitions[code] })), lastPurchaseAt: latest };
}
const stockMovements = [];
const writeOffs = new Map();
let saleNumber = 1;

function send(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS' });
  response.end(JSON.stringify(value));
}

function page(items) { return { items, total: items.length, page: 1, limit: 100 }; }
function error(response, status, message) { send(response, status, { message }); }

const server = createServer(async (request, response) => {
  if (request.method === 'OPTIONS') return send(response, 204, null);
  const url = new URL(request.url ?? '/', `http://${host}:${port}`);
  const path = url.pathname;
  let body = {};
  if (request.method === 'POST' || request.method === 'PATCH') {
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    } catch { return error(response, 400, 'Неверный JSON'); }
  }

  if (request.method === 'GET' && path === '/health') return send(response, 200, { status: 'ok', service: 'koreacrm-pos-demo' });
  if (request.method === 'POST' && path === '/auth/login') {
    const employee = demoEmployees.find(value => value.login === body.login && value.active && demoPasswords.get(value.id) === body.password);
    if (!employee) return error(response, 401, 'Неверный логин или пароль');
    const accessToken = employee.id === 'demo-user' ? 'demo-local-token' : `demo-${randomUUID()}`;
    const refreshToken = employee.id === 'demo-user' ? 'demo-local-refresh' : `demo-${randomUUID()}`;
    demoSessions.set(accessToken, employee.id); demoRefreshSessions.set(refreshToken, employee.id);
    recordAudit(employee.id, 'LOGIN', 'User', employee.id);
    return send(response, 200, { accessToken, refreshToken });
  }
  if (request.method === 'POST' && path === '/auth/refresh') {
    const id = demoRefreshSessions.get(body.refreshToken);
    if (!id) return error(response, 401, 'Войдите в демо-режим');
    const accessToken = `demo-${randomUUID()}`, refreshToken = `demo-${randomUUID()}`;
    demoRefreshSessions.delete(body.refreshToken); demoSessions.set(accessToken, id); demoRefreshSessions.set(refreshToken, id);
    return send(response, 200, { accessToken, refreshToken });
  }
  if (request.method === 'POST' && path === '/auth/logout') { demoRefreshSessions.delete(body.refreshToken); return send(response, 200, { ok: true }); }
  const sessionId = demoSessions.get(request.headers.authorization?.slice(7));
  const sessionEmployee = demoEmployees.find(value => value.id === sessionId && value.active);
  if (!request.headers.authorization?.startsWith('Bearer ') || !sessionEmployee) return error(response, 401, 'Войдите в демо-режим');
  const canDemo = code => sessionEmployee.id === 'demo-user' || sessionEmployee.role.permissions.some(item => item.permission.code === code);

  if (request.method === 'GET' && path === '/auth/me') return send(response, 200, { userId: sessionEmployee.id, login: sessionEmployee.login, name: sessionEmployee.name, role: sessionEmployee.role.code, permissions: sessionEmployee.id === 'demo-user' ? [...permissions, 'finance.view'] : sessionEmployee.role.permissions.map(item => item.permission.code), allStores: sessionEmployee.allStores, storeIds: sessionEmployee.stores.map(item => item.storeId) });
  if (request.method === 'GET' && path === '/stores') return send(response, 200, [store]);
  if (request.method === 'GET' && path === '/finance/stores') return send(response, 200, [store]);
  if (path === '/expense-categories') {
    if (request.method === 'GET') return send(response, 200, expenseCategories);
    if (request.method === 'POST') {
      if (!canDemo('finance.edit')) return error(response, 403, 'Недостаточно прав');
      const name = String(body.name ?? '').trim();
      if (!name) return error(response, 400, 'Укажите название категории');
      const category = { id: randomUUID(), name };
      expenseCategories.push(category);
      return send(response, 201, category);
    }
  }
  if (request.method === 'GET' && path === '/roles') return canDemo('employees.view') ? send(response, 200, demoRoles) : error(response, 403, 'Недостаточно прав');
  if (request.method === 'GET' && path === '/roles/permissions') return canDemo('employees.view') ? send(response, 200, [...new Set([...permissions, 'finance.view'])].sort().map(code => ({ code }))) : error(response, 403, 'Недостаточно прав');
  if (request.method === 'POST' && path === '/roles') {
    if (!canDemo('settings.edit')) return error(response, 403, 'Недостаточно прав');
    if (demoRoles.some(role => role.code === body.code)) return error(response, 409, 'Код роли уже используется');
    const role = { id: randomUUID(), code: body.code, name: body.name, system: false, permissions: (body.permissions ?? []).map(code => ({ permission: { code } })) };
    demoRoles.push(role); recordAudit(sessionEmployee.id, 'ROLE_CREATED', 'Role', role.id); return send(response, 201, role);
  }
  const roleEdit = path.match(/^\/roles\/([^/]+)$/);
  if (request.method === 'PATCH' && roleEdit) {
    if (!canDemo('settings.edit')) return error(response, 403, 'Недостаточно прав');
    const role = demoRoles.find(value => value.id === roleEdit[1]);
    if (!role) return error(response, 404, 'Роль не найдена');
    if (role.system) return error(response, 409, 'Системную роль нельзя изменить');
    if (body.name) role.name = body.name;
    if (body.permissions) role.permissions = body.permissions.map(code => ({ permission: { code } }));
    recordAudit(sessionEmployee.id, 'ROLE_UPDATED', 'Role', role.id);
    return send(response, 200, role);
  }
  const employeeActivity = path.match(/^\/employees\/([^/]+)\/activity$/);
  if (request.method === 'GET' && employeeActivity) {
    if (!canDemo('employees.view')) return error(response, 403, 'Недостаточно прав');
    const employee = demoEmployees.find(value => value.id === employeeActivity[1]);
    if (!employee) return error(response, 404, 'Сотрудник не найден');
    if (!sessionEmployee.allStores && (employee.allStores || employee.stores.some(item => !sessionEmployee.stores.some(allowed => allowed.storeId === item.storeId)))) return error(response, 403, 'Нет доступа к истории');
    const pageNumber = Math.max(1, Number(url.searchParams.get('page') ?? 1));
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? 20)));
    const found = demoAudit.filter(record => record.userId === employee.id || record.entityType === 'User' && record.entityId === employee.id);
    return send(response, 200, { items: found.slice((pageNumber - 1) * limit, pageNumber * limit), total: found.length, page: pageNumber, limit });
  }
  if (request.method === 'GET' && path === '/employees') {
    if (!canDemo('employees.view')) return error(response, 403, 'Недостаточно прав');
    const search = (url.searchParams.get('search') ?? '').trim().toLocaleLowerCase('ru');
    const pageNumber = Math.max(1, Number(url.searchParams.get('page') ?? 1));
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? 20)));
    const found = demoEmployees.filter(employee => (sessionEmployee.allStores || !employee.allStores && employee.stores.some(item => sessionEmployee.stores.some(allowed => allowed.storeId === item.storeId))) && `${employee.name} ${employee.login}`.toLocaleLowerCase('ru').includes(search));
    return send(response, 200, { items: found.slice((pageNumber - 1) * limit, pageNumber * limit), total: found.length, page: pageNumber, limit });
  }
  if (request.method === 'POST' && path === '/employees') {
    if (!canDemo('employees.create')) return error(response, 403, 'Недостаточно прав');
    if (demoEmployees.some(employee => employee.login === body.login)) return error(response, 409, 'Логин уже используется');
    const role = demoRoles.find(value => value.id === body.roleId);
    if (!role) return error(response, 404, 'Роль не найдена');
    const employee = { id: randomUUID(), name: body.name, login: body.login, active: true, allStores: Boolean(body.allStores), roleId: role.id, role, stores: body.allStores ? [] : (body.storeIds ?? []).map(storeId => ({ storeId })), createdAt: new Date().toISOString() };
    demoEmployees.unshift(employee); demoPasswords.set(employee.id, body.password); recordAudit(sessionEmployee.id, 'EMPLOYEE_CREATED', 'User', employee.id); return send(response, 201, employee);
  }
  const employeeEdit = path.match(/^\/employees\/([^/]+)$/);
  if (request.method === 'PATCH' && employeeEdit) {
    if (!canDemo('employees.edit')) return error(response, 403, 'Недостаточно прав');
    const employee = demoEmployees.find(value => value.id === employeeEdit[1]);
    if (!employee) return error(response, 404, 'Сотрудник не найден');
    if (employee.id === 'demo-user') return error(response, 409, 'Свой профиль нельзя изменить здесь');
    const role = body.roleId ? demoRoles.find(value => value.id === body.roleId) : employee.role;
    if (!role) return error(response, 404, 'Роль не найдена');
    Object.assign(employee, { name: body.name ?? employee.name, login: body.login ?? employee.login, active: body.active ?? employee.active, allStores: body.allStores ?? employee.allStores, roleId: role.id, role, stores: body.allStores ? [] : body.storeIds ? body.storeIds.map(storeId => ({ storeId })) : employee.stores });
    if (body.password) demoPasswords.set(employee.id, body.password);
    recordAudit(sessionEmployee.id, 'EMPLOYEE_UPDATED', 'User', employee.id);
    return send(response, 200, employee);
  }
  if (request.method === 'GET' && path === '/brands') return send(response, 200, page(brands));
  if (request.method === 'GET' && path === '/categories') return send(response, 200, page(categories));
  if (request.method === 'GET' && path === '/finance/summary') {
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const revenueMinor = [...sales.values()].filter(sale => (!from || sale.createdAt.slice(0, 10) >= from) && (!to || sale.createdAt.slice(0, 10) <= to)).reduce((sum, sale) => sum + BigInt(sale.totalMinor), 0n) - [...returns.values()].filter(record => (!from || record.createdAt.slice(0, 10) >= from) && (!to || record.createdAt.slice(0, 10) <= to)).reduce((sum, record) => sum + BigInt(record.amountMinor), 0n);
    const expensesMinor = [...expenses.values()].filter(expense => (!from || expense.date >= from) && (!to || expense.date <= to)).reduce((sum, expense) => sum + BigInt(expense.amountMinor), 0n);
    const customerDebtMinor = customers.reduce((sum, customer) => sum + BigInt(customer.debtBalanceMinor), 0n);
    const openCashMinor = [...shifts.values()].filter(shift => shift.status === 'OPEN').reduce((sum, shift) => sum + BigInt(shift.expectedCashMinor), 0n);
    const cashDrawerFlowMinor = [...shifts.values()].filter(shift => shift.status === 'OPEN').reduce((sum, shift) => sum + BigInt(shift.expectedCashMinor) - BigInt(shift.openingCashMinor), 0n);
    return send(response, 200, { revenueMinor: String(revenueMinor), cogsMinor: null, grossProfitMinor: null, expensesMinor: String(expensesMinor), operationalResultMinor: null, customerDebtMinor: String(customerDebtMinor), supplierDebtMinor: '0', supplierPaymentsMinor: '0', cashDrawerFlowMinor: String(cashDrawerFlowMinor), openCashMinor: String(openCashMinor), cashFlowMinor: null, salesMetricsAvailable: false });
  }
  if (request.method === 'GET' && path === '/sale-payment-methods') return send(response, 200, methods);
  if (request.method === 'GET' && path === `/stores/${store.id}/sales`) {
    const search = (url.searchParams.get('search') ?? '').trim().toLocaleLowerCase('ru');
    const pageNumber = Math.max(1, Number(url.searchParams.get('page') ?? 1));
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? 20)));
    const found = [...sales.values()].filter(sale => `${sale.number} ${sale.customer?.phone ?? ''}`.toLocaleLowerCase('ru').includes(search)).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    return send(response, 200, { items: found.slice((pageNumber - 1) * limit, pageNumber * limit), total: found.length, page: pageNumber, limit });
  }
  if (request.method === 'GET' && path === `/stores/${store.id}/sales/returns`) {
    const search = (url.searchParams.get('search') ?? '').trim().toLocaleLowerCase('ru');
    const pageNumber = Math.max(1, Number(url.searchParams.get('page') ?? 1));
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? 20)));
    const found = [...returns.values()].map(record => { const sale = [...sales.values()].find(value => value.id === record.saleId); return { ...record, sale: { id: sale.id, number: sale.number, createdAt: sale.createdAt, totalMinor: sale.totalMinor, customer: sale.customer }, items: record.items.map(item => ({ ...item, saleItem: { product: sale.items.find(line => line.id === item.saleItemId)?.product } })) }; }).filter(record => `${record.sale.number} ${record.sale.customer?.phone ?? ''}`.toLocaleLowerCase('ru').includes(search)).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    return send(response, 200, { items: found.slice((pageNumber - 1) * limit, pageNumber * limit), total: found.length, page: pageNumber, limit });
  }
  const saleDetail = path.match(/^\/stores\/demo-store\/sales\/([^/]+)$/);
  if (request.method === 'GET' && saleDetail) {
    const sale = [...sales.values()].find(value => value.id === saleDetail[1]);
    return sale ? send(response, 200, sale) : error(response, 404, 'Продажа не найдена');
  }
  const saleReturn = path.match(/^\/stores\/demo-store\/sales\/([^/]+)\/return$/);
  if (request.method === 'POST' && saleReturn) {
    const sale = [...sales.values()].find(value => value.id === saleReturn[1]);
    if (!sale) return error(response, 404, 'Продажа не найдена');
    const previous = returns.get(body.operationId);
    if (previous) {
      const sameItems = !body.items || body.items.length === previous.items.length && body.items.every(item => previous.items.some(saved => saved.saleItemId === item.saleItemId && saved.quantity === item.quantity));
      return previous.saleId === sale.id && previous.deviceId === body.deviceId && previous.cashShiftId === body.cashShiftId && previous.reason === body.reason && sameItems ? send(response, 200, sale) : error(response, 409, 'Номер операции уже использован');
    }
    if (!sale.payments.length || sale.payments.some(payment => payment.paymentMethod?.kind !== 'CASH')) return error(response, 409, 'Доступен возврат только наличной продажи');
    if (!body.reason?.trim() || body.reason.trim().length < 5) return error(response, 400, 'Укажите причину возврата');
    const already = id => sale.returns.reduce((total, record) => total + record.items.filter(item => item.saleItemId === id).reduce((sum, item) => sum + item.quantity, 0), 0);
    const requested = body.items ?? sale.items.map(item => ({ saleItemId: item.id, quantity: item.quantity - already(item.id) })).filter(item => item.quantity > 0);
    if (!requested.length) return error(response, 409, 'Все товары уже возвращены');
    if (new Set(requested.map(item => item.saleItemId)).size !== requested.length) return error(response, 400, 'Повтор позиции в возврате');
    const lines = [];
    for (const requestItem of requested) {
      const item = sale.items.find(value => value.id === requestItem.saleItemId);
      if (!item || !Number.isInteger(requestItem.quantity) || requestItem.quantity <= 0) return error(response, 400, 'Некорректная позиция возврата');
      const returned = already(item.id);
      if (returned + requestItem.quantity > item.quantity) return error(response, 409, 'Количество возврата превышает остаток по чеку');
      const amountMinor = BigInt(item.totalMinor) * BigInt(returned + requestItem.quantity) / BigInt(item.quantity) - BigInt(item.totalMinor) * BigInt(returned) / BigInt(item.quantity);
      lines.push({ id: randomUUID(), saleItemId: item.id, quantity: requestItem.quantity, amountMinor: String(amountMinor), productId: item.productId });
    }
    const amountMinor = lines.reduce((total, item) => total + BigInt(item.amountMinor), 0n);
    if (amountMinor < 0n) return error(response, 409, 'Сумма возврата не может быть отрицательной');
    const shift = shifts.get(body.cashShiftId);
    if (!shift || shift.status !== 'OPEN' || shift.deviceId !== body.deviceId) return error(response, 409, 'Откройте кассовую смену');
    if (BigInt(shift.expectedCashMinor) < amountMinor) return error(response, 409, 'В кассе недостаточно наличных');
    const record = { id: randomUUID(), saleId: sale.id, operationId: body.operationId, deviceId: body.deviceId, cashShiftId: body.cashShiftId, amountMinor: String(amountMinor), reason: body.reason.trim(), items: lines, createdAt: new Date().toISOString() };
    for (const item of lines) {
      const product = products.find(value => value.id === item.productId);
      if (product) { const previousQuantity = product.quantity; product.quantity += item.quantity; stockMovements.unshift({ id: randomUUID(), productId: product.id, type: 'RETURN', quantity: item.quantity, previousQuantity, newQuantity: product.quantity, sourceType: 'SALE_RETURN_ITEM', sourceId: item.id, comment: record.reason, createdAt: record.createdAt, product: { name: product.name, sku: product.sku } }); }
    }
    shift.expectedCashMinor = String(BigInt(shift.expectedCashMinor) - amountMinor);
    sale.returns.push(record);
    returns.set(body.operationId, record);
    if (sale.customer) {
      sale.customer.totalSpentMinor = String(BigInt(sale.customer.totalSpentMinor) - amountMinor);
      if (sale.items.every(item => already(item.id) === item.quantity)) sale.customer.ordersCount -= 1;
      updateAverage(sale.customer);
    }
    recordAudit(sessionEmployee.id, 'SALE_RETURNED', 'SaleReturn', record.id, body.deviceId);
    return send(response, 201, sale);
  }
  if (request.method === 'POST' && path === `/stores/${store.id}/pos-devices`) return send(response, 200, { id: body.deviceId });
  if (request.method === 'GET' && path === `/stores/${store.id}/purchases`) return send(response, 200, page([]));
  if (request.method === 'GET' && path === `/stores/${store.id}/finance/supplier-payments`) return send(response, 200, page([]));
  if (path === `/stores/${store.id}/finance/expenses`) {
    if (request.method === 'GET') return send(response, 200, page([...expenses.values()].reverse()));
    if (request.method === 'POST') {
      if (!canDemo('finance.edit')) return error(response, 403, 'Недостаточно прав');
      const prior = expenses.get(body.operationId);
      if (prior) return send(response, 200, prior);
      if (!/^\d+$/.test(body.amountMinor ?? '') || BigInt(body.amountMinor) <= 0n) return error(response, 400, 'Укажите положительную сумму');
      const category = expenseCategories.find(item => item.id === body.categoryId);
      if (!category) return error(response, 404, 'Категория не найдена');
      const shift = body.paymentMethod === 'CASH' ? shifts.get(body.cashShiftId) : null;
      if (body.paymentMethod === 'CASH' && (!shift || shift.status !== 'OPEN' || BigInt(shift.expectedCashMinor) < BigInt(body.amountMinor))) return error(response, 409, 'Проверьте открытую смену и остаток наличных');
      const expense = { id: randomUUID(), operationId: body.operationId, amountMinor: body.amountMinor, paymentMethod: body.paymentMethod, date: body.date, description: body.description ?? null, category };
      if (shift) shift.expectedCashMinor = String(BigInt(shift.expectedCashMinor) - BigInt(body.amountMinor));
      expenses.set(body.operationId, expense);
      return send(response, 201, expense);
    }
  }
  if (request.method === 'GET' && path === `/stores/${store.id}/finance/cash-shifts`) return send(response, 200, page([...shifts.values()]));
  if (request.method === 'POST' && path === `/stores/${store.id}/finance/cash-shifts`) {
    if (!/^\d+$/.test(body.openingCashMinor ?? '')) return error(response, 400, 'Некорректная начальная наличность');
    const shift = { id: randomUUID(), deviceId: body.deviceId, status: 'OPEN', openingCashMinor: body.openingCashMinor, expectedCashMinor: body.openingCashMinor, actualCashMinor: null, openedAt: new Date().toISOString() };
    shifts.set(shift.id, shift);
    return send(response, 201, shift);
  }
  const cashOperation = path.match(/^\/stores\/demo-store\/finance\/cash-shifts\/([^/]+)\/operations$/);
  if (request.method === 'POST' && cashOperation) {
    if (!canDemo('finance.cash')) return error(response, 403, 'Недостаточно прав');
    if (cashOperations.has(body.operationId)) return send(response, 200, cashOperations.get(body.operationId));
    const shift = shifts.get(cashOperation[1]);
    if (!shift || shift.status !== 'OPEN') return error(response, 404, 'Открытая смена не найдена');
    if (!/^-?\d+$/.test(body.amountMinor ?? '') || BigInt(body.amountMinor) === 0n) return error(response, 400, 'Укажите сумму операции');
    const amount = BigInt(body.amountMinor);
    if (body.type !== 'CORRECTION' && amount < 0n) return error(response, 400, 'Для внесения и изъятия сумма должна быть положительной');
    const delta = body.type === 'WITHDRAWAL' ? -amount : amount;
    if (BigInt(shift.expectedCashMinor) + delta < 0n) return error(response, 409, 'В кассе недостаточно наличных');
    shift.expectedCashMinor = String(BigInt(shift.expectedCashMinor) + delta);
    const record = { id: randomUUID(), operationId: body.operationId, type: body.type, amountMinor: body.amountMinor, comment: body.comment, createdAt: new Date().toISOString() };
    cashOperations.set(body.operationId, record);
    return send(response, 201, record);
  }
  const closeShift = path.match(/^\/stores\/demo-store\/finance\/cash-shifts\/([^/]+)\/close$/);
  if (request.method === 'POST' && closeShift) {
    const shift = shifts.get(closeShift[1]);
    if (!shift) return error(response, 404, 'Смена не найдена');
    if (shift.status !== 'OPEN') return error(response, 409, 'Смена уже закрыта');
    if (!/^\d+$/.test(body.actualCashMinor ?? '')) return error(response, 400, 'Укажите фактическую наличность');
    shift.actualCashMinor = body.actualCashMinor;
    shift.status = 'CLOSED';
    shift.closedAt = new Date().toISOString();
    return send(response, 200, shift);
  }
  if (request.method === 'GET' && path === '/customers') {
    const search = (url.searchParams.get('search') ?? '').toLocaleLowerCase('ru');
    const segment = url.searchParams.get('segment');
    if (segment && !segmentDefinitions[segment]) return error(response, 400, 'Неизвестный сегмент');
    const found = customers.filter(customer => `${customer.firstName} ${customer.lastName} ${customer.phone} ${customer.id}`.toLocaleLowerCase('ru').includes(search) && (!segment || customerSegments(customer).items.some(item => item.code === segment)));
    const currentPage = Math.max(1, Number(url.searchParams.get('page')) || 1);
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 20));
    return send(response, 200, { items: found.slice((currentPage - 1) * limit, currentPage * limit), total: found.length, page: currentPage, limit });
  }
  const customerPaymentsRoute = path.match(/^\/stores\/demo-store\/customers\/([^/]+)\/payments$/);
  if (request.method === 'GET' && customerPaymentsRoute) return send(response, 200, [...customerPayments.values()].filter(payment => payment.customerId === customerPaymentsRoute[1]));
  if (request.method === 'POST' && customerPaymentsRoute) {
    const customer = customers.find(value => value.id === customerPaymentsRoute[1]);
    if (!customer) return error(response, 404, 'Клиент не найден');
    if (customerPayments.has(body.operationId)) return send(response, 200, customerPayments.get(body.operationId));
    const amount = BigInt(body.amountMinor ?? '0');
    const method = methods.find(value => value.id === body.paymentMethodId && !['DEBT', 'BONUS'].includes(value.kind));
    if (!method || amount <= 0n || amount > BigInt(customer.debtBalanceMinor)) return error(response, 400, 'Некорректное погашение долга');
    const payment = { id: randomUUID(), operationId: body.operationId, customerId: customer.id, amountMinor: String(amount), createdAt: new Date().toISOString(), paymentMethod: method, employee: { name: sessionEmployee.name } };
    customer.debtBalanceMinor = String(BigInt(customer.debtBalanceMinor) - amount);
    customerPayments.set(body.operationId, payment);
    customerDebtEntries.unshift({ id: randomUUID(), customerId: customer.id, type: 'PAYMENT', amountMinor: String(-amount), createdAt: payment.createdAt, sale: null, customerPayment: { paymentMethod: { name: method.name } } });
    recordAudit(sessionEmployee.id, 'CUSTOMER_PAYMENT_CREATED', 'CustomerPayment', payment.id);
    return send(response, 201, payment);
  }
  const customerHistory = path.match(/^\/customers\/([^/]+)\/history$/);
  if (request.method === 'GET' && customerHistory) {
    if (!customers.some(customer => customer.id === customerHistory[1])) return error(response, 404, 'Клиент не найден');
    const kind = url.searchParams.get('kind');
    if (!['sales', 'returns', 'debts'].includes(kind)) return error(response, 400, 'Выберите вид истории');
    const currentPage = Math.max(1, Number(url.searchParams.get('page')) || 1);
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit')) || 10));
    const entries = kind === 'sales' ? [...sales.values()].filter(sale => sale.customer?.id === customerHistory[1]).map(sale => ({ id: sale.id, number: sale.number, createdAt: sale.createdAt, totalMinor: sale.totalMinor, status: sale.status, store: { name: store.name }, items: sale.items.map(item => ({ id: item.id, quantity: item.quantity, totalMinor: item.totalMinor, product: { name: item.product.name } })) })) : kind === 'returns' ? [...returns.values()].filter(record => [...sales.values()].find(value => value.id === record.saleId)?.customer?.id === customerHistory[1]).map(record => { const sale = [...sales.values()].find(value => value.id === record.saleId); return { id: record.id, createdAt: record.createdAt, amountMinor: record.amountMinor, reason: record.reason, sale: { id: sale.id, number: sale.number }, items: record.items.map(item => ({ id: item.id, quantity: item.quantity, amountMinor: item.amountMinor, saleItem: { product: { name: sale.items.find(line => line.id === item.saleItemId)?.product.name ?? 'Товар' } } })) }; }) : customerDebtEntries.filter(entry => entry.customerId === customerHistory[1]);
    entries.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    return send(response, 200, { items: entries.slice((currentPage - 1) * limit, currentPage * limit), total: entries.length, page: currentPage, limit });
  }
  const customerCommentsRoute = path.match(/^\/customers\/([^/]+)\/comments$/);
  if (customerCommentsRoute && ['GET', 'POST'].includes(request.method)) {
    if (!canDemo(request.method === 'GET' ? 'customers.view' : 'customers.edit')) return error(response, 403, 'Недостаточно прав');
    if (!customers.some(customer => customer.id === customerCommentsRoute[1])) return error(response, 404, 'Клиент не найден');
    if (request.method === 'GET') {
      const currentPage = Math.max(1, Number(url.searchParams.get('page')) || 1);
      const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit')) || 10));
      const entries = customerComments.filter(comment => comment.customerId === customerCommentsRoute[1]).sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id));
      return send(response, 200, { items: entries.slice((currentPage - 1) * limit, currentPage * limit), total: entries.length, page: currentPage, limit });
    }
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text || text.length > 2000) return error(response, 400, 'Комментарий должен содержать от 1 до 2000 символов');
    const comment = { id: randomUUID(), customerId: customerCommentsRoute[1], text, createdAt: new Date().toISOString(), author: { id: sessionEmployee.id, name: sessionEmployee.name, login: sessionEmployee.login } };
    customerComments.push(comment);
    recordAudit(sessionEmployee.id, 'CUSTOMER_COMMENT_CREATED', 'CustomerComment', comment.id);
    return send(response, 201, comment);
  }
  const customerActivityRoute = path.match(/^\/customers\/([^/]+)\/activity$/);
  if (request.method === 'GET' && customerActivityRoute) {
    if (!canDemo('customers.view')) return error(response, 403, 'Недостаточно прав');
    if (!customers.some(customer => customer.id === customerActivityRoute[1])) return error(response, 404, 'Клиент не найден');
    const customerId = customerActivityRoute[1];
    const currentPage = Math.max(1, Number(url.searchParams.get('page')) || 1);
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit')) || 10));
    const entries = [
      ...[...sales.values()].filter(sale => sale.customer?.id === customerId).map(sale => ({ id: sale.id, kind: 'SALE', title: `Покупка · чек №${sale.number}`, detail: store.name, amountMinor: sale.totalMinor, createdAt: sale.createdAt, actorName: sale.employee.name })),
      ...[...returns.values()].filter(record => [...sales.values()].find(sale => sale.id === record.saleId)?.customer?.id === customerId).map(record => ({ id: record.id, kind: 'RETURN', title: `Возврат · чек №${[...sales.values()].find(sale => sale.id === record.saleId)?.number ?? ''}`, detail: record.reason, amountMinor: record.amountMinor, createdAt: record.createdAt, actorName: null })),
      ...[...customerPayments.values()].filter(payment => payment.customerId === customerId).map(payment => ({ id: payment.id, kind: 'PAYMENT', title: 'Погашение долга', detail: payment.paymentMethod.name, amountMinor: payment.amountMinor, createdAt: payment.createdAt, actorName: payment.employee.name })),
      ...customerComments.filter(comment => comment.customerId === customerId).map(comment => ({ id: comment.id, kind: 'COMMENT', title: 'Комментарий', detail: comment.text, amountMinor: null, createdAt: comment.createdAt, actorName: comment.author.name })),
      ...bonusTransactions.filter(item => item.customerId === customerId).map(item => ({ id: item.id, kind: 'BONUS', title: item.type === 'CORRECTION' ? 'Корректировка бонусов' : item.type === 'EARN' ? 'Начисление бонусов' : item.type === 'SPEND' ? 'Списание бонусов' : 'Сгорание бонусов', detail: item.reason, amountMinor: item.deltaMinor, createdAt: item.createdAt, actorName: item.actor.name })),
      ...demoAudit.filter(audit => audit.entityType === 'Customer' && audit.entityId === customerId && ['CUSTOMER_CREATED', 'CUSTOMER_UPDATED'].includes(audit.action)).map(audit => ({ id: audit.id, kind: 'PROFILE', title: audit.action === 'CUSTOMER_CREATED' ? 'Карточка создана' : 'Карточка изменена', detail: '', amountMinor: null, createdAt: audit.createdAt, actorName: audit.user?.name ?? null })),
    ].sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id));
    return send(response, 200, { items: entries.slice((currentPage - 1) * limit, currentPage * limit), total: entries.length, page: currentPage, limit });
  }
  const customerSegmentsRoute = path.match(/^\/customers\/([^/]+)\/segments$/);
  if (request.method === 'GET' && customerSegmentsRoute) {
    if (!canDemo('customers.view')) return error(response, 403, 'Недостаточно прав');
    const customer = customers.find(value => value.id === customerSegmentsRoute[1]);
    return customer ? send(response, 200, customerSegments(customer)) : error(response, 404, 'Клиент не найден');
  }
  const customerBonusesRoute = path.match(/^\/customers\/([^/]+)\/bonuses$/);
  if (request.method === 'GET' && customerBonusesRoute) {
    if (!canDemo('customers.view')) return error(response, 403, 'Недостаточно прав');
    const customer = customers.find(value => value.id === customerBonusesRoute[1]);
    if (!customer) return error(response, 404, 'Клиент не найден');
    const currentPage = Math.max(1, Number(url.searchParams.get('page')) || 1);
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit')) || 10));
    const entries = bonusTransactions.filter(item => item.customerId === customer.id).sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id));
    return send(response, 200, { items: entries.slice((currentPage - 1) * limit, currentPage * limit), total: entries.length, page: currentPage, limit, balanceMinor: customer.bonusBalanceMinor });
  }
  const customerBonusCorrectionRoute = path.match(/^\/customers\/([^/]+)\/bonuses\/corrections$/);
  if (request.method === 'POST' && customerBonusCorrectionRoute) {
    if (!canDemo('settings.edit')) return error(response, 403, 'Недостаточно прав');
    const existing = bonusTransactions.find(item => item.operationId === body.operationId);
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (!/^-?[1-9]\d{0,15}$/.test(body.deltaMinor ?? '') || reason.length < 5 || reason.length > 500 || !/^[0-9a-f-]{36}$/i.test(body.operationId ?? '')) return error(response, 400, 'Некорректная корректировка бонусов');
    if (existing) return existing.customerId === customerBonusCorrectionRoute[1] && existing.deltaMinor === body.deltaMinor && existing.reason === reason ? send(response, 200, existing) : error(response, 409, 'Номер операции уже использован');
    const customer = customers.find(value => value.id === customerBonusCorrectionRoute[1]);
    if (!customer) return error(response, 404, 'Клиент не найден');
    const balance = BigInt(customer.bonusBalanceMinor) + BigInt(body.deltaMinor);
    if (balance < 0n) return error(response, 409, 'Бонусный баланс не может быть отрицательным');
    if (balance >= 1000000000000000000n) return error(response, 409, 'Превышен лимит бонусного баланса');
    const record = { id: randomUUID(), operationId: body.operationId, customerId: customer.id, actorId: sessionEmployee.id, actor: { name: sessionEmployee.name }, type: 'CORRECTION', deltaMinor: body.deltaMinor, balanceAfterMinor: String(balance), reason, createdAt: new Date().toISOString() };
    customer.bonusBalanceMinor = String(balance);
    bonusTransactions.push(record);
    recordAudit(sessionEmployee.id, 'CUSTOMER_BONUS_CORRECTED', 'BonusTransaction', record.id);
    return send(response, 201, record);
  }
  const customerDetail = path.match(/^\/customers\/([^/]+)$/);
  if (customerDetail) {
    const customer = customers.find(value => value.id === customerDetail[1]);
    if (!customer) return error(response, 404, 'Клиент не найден');
    if (request.method === 'GET') return send(response, 200, customer);
    if (request.method === 'PATCH') { Object.assign(customer, body); recordAudit(sessionEmployee.id, 'CUSTOMER_UPDATED', 'Customer', customer.id); return send(response, 200, customer); }
    if (request.method === 'DELETE') { customers.splice(customers.indexOf(customer), 1); return send(response, 200, customer); }
  }
  if (request.method === 'POST' && path === '/customers') {
    const customer = { id: randomUUID(), ...body, birthday: body.birthday ?? null, gender: body.gender ?? null, address: body.address ?? null, notes: body.notes ?? null, discountPercent: body.discountPercent ?? '0', bonusBalanceMinor: '0', debtBalanceMinor: '0', totalSpentMinor: '0', averageCheckMinor: '0', ordersCount: 0 };
    customers.push(customer);
    recordAudit(sessionEmployee.id, 'CUSTOMER_CREATED', 'Customer', customer.id);
    return send(response, 201, customer);
  }
  function catalogProduct(product) {
    return { ...product, brandId: product.brandId ?? brands[0].id, categoryId: product.categoryId ?? categories[0].id, brand: brands.find(item => item.id === (product.brandId ?? brands[0].id)) ?? null, category: categories.find(item => item.id === (product.categoryId ?? categories[0].id)) ?? null, unit: product.unit ?? 'шт.', description: product.description ?? null, country: product.country ?? null, shade: product.shade ?? null, volume: product.volume ?? null, weight: product.weight ?? null, line: product.line ?? null, collection: product.collection ?? null, gender: product.gender ?? null, skinType: product.skinType ?? null, productType: product.productType ?? null, images: product.images ?? [] };
  }
  if (request.method === 'GET' && path === '/products') {
    const search = (url.searchParams.get('search') ?? '').toLocaleLowerCase('ru');
    const brandId = url.searchParams.get('brandId');
    const categoryId = url.searchParams.get('categoryId');
    return send(response, 200, page(products.filter(product => `${product.name} ${product.sku} ${product.barcodes.map(code => code.value).join(' ')}`.toLocaleLowerCase('ru').includes(search) && (!brandId || (product.brandId ?? brands[0].id) === brandId) && (!categoryId || (product.categoryId ?? categories[0].id) === categoryId)).map(catalogProduct)));
  }
  if (request.method === 'GET' && path === `/stores/${store.id}/pos-products`) {
    const search = (url.searchParams.get('search') ?? '').toLocaleLowerCase('ru');
    return send(response, 200, page(products.filter(product => product.status === 'ACTIVE' && `${product.name} ${product.sku} ${product.barcodes.map(code => code.value).join(' ')}`.toLocaleLowerCase('ru').includes(search)).map(product => ({ id: product.id, name: product.name, sku: product.sku, status: product.status, barcodes: product.barcodes, images: product.images ?? [], priceMinor: product.priceMinor, availableQuantity: Math.max(0, product.quantity), active: true }))));
  }
  if (request.method === 'POST' && path === '/products') {
    if (!body.name?.trim() || !body.sku?.trim()) return error(response, 400, 'Укажите название и SKU');
    if (products.some(product => product.sku === body.sku)) return error(response, 409, 'SKU уже используется');
    const product = { ...body, id: randomUUID(), name: body.name.trim(), sku: body.sku.trim(), status: body.status ?? 'ACTIVE', barcodes: (body.barcodes ?? []).map(value => ({ id: randomUUID(), value })), images: [], priceMinor: 0, quantity: 0 };
    products.push(product);
    return send(response, 201, catalogProduct(product));
  }
  const productDetail = path.match(/^\/products\/([^/]+)$/);
  if (productDetail) {
    const index = products.findIndex(product => product.id === productDetail[1]);
    if (index < 0) return error(response, 404, 'Товар не найден');
    if (request.method === 'GET') return send(response, 200, catalogProduct(products[index]));
    if (request.method === 'PATCH') {
      if (!body.name?.trim() || !body.sku?.trim()) return error(response, 400, 'Укажите название и SKU');
      if (products.some((product, position) => position !== index && product.sku === body.sku)) return error(response, 409, 'SKU уже используется');
      const updated = { ...products[index], ...body, name: body.name.trim(), sku: body.sku.trim(), barcodes: (body.barcodes ?? []).map(value => ({ id: randomUUID(), value })) };
      products[index] = updated;
      return send(response, 200, catalogProduct(updated));
    }
    if (request.method === 'DELETE') { products.splice(index, 1); return send(response, 200, { ok: true }); }
  }
  const barcode = path.match(/^\/products\/lookup\/barcode\/(.+)$/);
  if (request.method === 'GET' && barcode) {
    const product = products.find(item => item.barcodes.some(code => code.value === decodeURIComponent(barcode[1])));
    return product ? send(response, 200, product) : error(response, 404, 'Штрихкод не найден');
  }
  const settings = path.match(/^\/stores\/demo-store\/products\/([^/]+)\/settings$/);
  if (request.method === 'GET' && settings) {
    const product = products.find(item => item.id === settings[1]);
    return product ? send(response, 200, { active: true, priceMinor: product.priceMinor, minStock: product.minStock ?? 0 }) : error(response, 404, 'Товар не найден');
  }
  if (request.method === 'PATCH' && settings) {
    const product = products.find(item => item.id === settings[1]);
    if (!product) return error(response, 404, 'Товар не найден');
    if (!Number.isInteger(body.minStock) || body.minStock < 0) return error(response, 400, 'Укажите корректный минимум');
    product.minStock = body.minStock;
    return send(response, 200, { active: true, priceMinor: product.priceMinor, minStock: product.minStock });
  }
  if (request.method === 'GET' && path === `/stores/${store.id}/stock`) {
    const search = (url.searchParams.get('search') ?? '').toLocaleLowerCase('ru');
    const filter = url.searchParams.get('filter') ?? 'all';
    const rows = products.filter(product => `${product.name} ${product.sku} ${product.barcodes.map(code => code.value).join(' ')}`.toLocaleLowerCase('ru').includes(search)).map(product => ({ productId: product.id, name: product.name, sku: product.sku, quantity: product.quantity, reservedQuantity: 0, minStock: product.minStock ?? 0, negative: product.quantity < 0, low: product.quantity <= (product.minStock ?? 0) }));
    return send(response, 200, page(rows.filter(row => filter === 'all' || (filter === 'zero' && row.quantity === 0) || (filter === 'negative' && row.negative) || (filter === 'low' && row.low))));
  }
  if (request.method === 'GET' && path === `/stores/${store.id}/stock/movements`) {
    const productId = url.searchParams.get('productId');
    return send(response, 200, page(stockMovements.filter(movement => !productId || movement.productId === productId)));
  }
  if (request.method === 'POST' && path === `/stores/${store.id}/stock/adjustments`) {
    const product = products.find(item => item.id === body.productId);
    if (!product) return error(response, 404, 'Товар не найден');
    if (!['CORRECTION', 'INVENTORY'].includes(body.type) || !Number.isInteger(body.delta) || body.delta === 0 || !body.comment?.trim() || body.comment.trim().length < 3) return error(response, 400, 'Укажите количество и причину (не менее 3 символов)');
    const previousQuantity = product.quantity;
    product.quantity += body.delta;
    const movement = { id: randomUUID(), productId: product.id, type: body.type, quantity: body.delta, previousQuantity, newQuantity: product.quantity, sourceType: 'MANUAL_ADJUSTMENT', sourceId: randomUUID(), comment: body.comment.trim(), createdAt: new Date().toISOString(), product: { name: product.name, sku: product.sku } };
    stockMovements.unshift(movement);
    return send(response, 201, movement);
  }
  if (request.method === 'POST' && path === `/stores/${store.id}/stock/write-offs`) {
    if (!canDemo('inventory.adjust')) return error(response, 403, 'Недостаточно прав');
    const prior = writeOffs.get(body.operationId);
    if (prior) return prior.productId === body.productId && prior.quantity === -body.quantity && prior.comment === body.comment?.trim() ? send(response, 200, prior) : error(response, 409, 'Номер операции уже использован с другими данными');
    const product = products.find(item => item.id === body.productId);
    if (!product) return error(response, 404, 'Товар не найден');
    if (!Number.isSafeInteger(body.quantity) || body.quantity < 1 || !body.comment?.trim() || body.comment.trim().length < 3) return error(response, 400, 'Укажите количество и причину списания');
    if (body.quantity > product.quantity) return error(response, 409, 'Недостаточно товара для списания');
    const previousQuantity = product.quantity;
    product.quantity -= body.quantity;
    const movement = { id: randomUUID(), productId: product.id, type: 'WRITE_OFF', quantity: -body.quantity, previousQuantity, newQuantity: product.quantity, sourceType: 'MANUAL_WRITE_OFF', sourceId: body.operationId, comment: body.comment.trim(), createdAt: new Date().toISOString(), product: { name: product.name, sku: product.sku } };
    stockMovements.unshift(movement);
    writeOffs.set(body.operationId, movement);
    recordAudit(sessionEmployee.id, 'STOCK_CHANGED', 'Stock', `${store.id}:${product.id}`);
    return send(response, 201, movement);
  }
  const offlineSync = path === `/stores/${store.id}/sales/sync`;
  if (request.method === 'POST' && (path === `/stores/${store.id}/sales` || offlineSync)) {
    if (sales.has(body.operationId)) return send(response, 200, sales.get(body.operationId));
    const items = [];
    for (const line of body.items ?? []) {
      const product = products.find(item => item.id === line.productId);
      if (!product || !Number.isInteger(line.quantity) || line.quantity < 1 || (!offlineSync && line.quantity > product.quantity)) return error(response, 400, 'Недостаточно товара');
      const unitPrice = offlineSync && line.priceMinor !== undefined ? BigInt(line.priceMinor) : BigInt(product.priceMinor);
      const gross = unitPrice * BigInt(line.quantity);
      const discount = BigInt(line.discountMinor ?? '0');
      if (discount < 0n || discount > gross) return error(response, 400, 'Неверная скидка');
      items.push({ id: randomUUID(), productId: product.id, quantity: line.quantity, priceMinor: String(unitPrice), discountMinor: String(discount), totalMinor: String(gross - discount), product: { name: product.name, sku: product.sku } });
    }
    if (!items.length) return error(response, 400, 'Добавьте товар');
    const total = items.reduce((sum, item) => sum + BigInt(item.totalMinor), 0n);
    if ((body.payments ?? []).some(payment => !methods.some(method => method.id === payment.paymentMethodId && method.active) || !/^[1-9]\d*$/.test(String(payment.amountMinor ?? '')))) return error(response, 400, 'Неверный способ оплаты или сумма');
    const paid = (body.payments ?? []).reduce((sum, payment) => sum + BigInt(payment.amountMinor ?? '0'), 0n);
    if (paid !== total) return error(response, 400, 'Сумма оплаты не совпадает с чеком');
    const debtMinor = (body.payments ?? []).filter(payment => methods.find(method => method.id === payment.paymentMethodId)?.kind === 'DEBT').reduce((sum, payment) => sum + BigInt(payment.amountMinor ?? '0'), 0n);
    const saleCustomer = customers.find(customer => customer.id === body.customerId) ?? null;
    if (debtMinor > 0n && !saleCustomer) return error(response, 400, 'Для продажи в долг нужен клиент');
    const bonusMinor = (body.payments ?? []).filter(payment => methods.find(method => method.id === payment.paymentMethodId)?.kind === 'BONUS').reduce((sum, payment) => sum + BigInt(payment.amountMinor), 0n);
    if (bonusMinor > 0n && (!saleCustomer || offlineSync)) return error(response, 400, 'Для оплаты бонусами нужен клиент и онлайн-продажа');
    if (bonusMinor > BigInt(saleCustomer?.bonusBalanceMinor ?? '0')) return error(response, 409, 'Недостаточно бонусов у клиента');
    const cashMinor = (body.payments ?? []).filter(payment => methods.find(method => method.id === payment.paymentMethodId)?.kind === 'CASH').reduce((sum, payment) => sum + BigInt(payment.amountMinor ?? '0'), 0n);
    if (cashMinor > 0n !== Boolean(body.cashShiftId)) return error(response, 400, 'Для наличной продажи нужна открытая смена');
    const cashShift = body.cashShiftId ? shifts.get(body.cashShiftId) : null;
    if (cashMinor > 0n && (!cashShift || cashShift.deviceId !== body.deviceId || cashShift.status !== 'OPEN')) return error(response, 409, 'Кассовая смена не найдена');
    for (const item of items) products.find(product => product.sku === item.product.sku).quantity -= item.quantity;
    if (cashShift) cashShift.expectedCashMinor = String(BigInt(cashShift.expectedCashMinor) + cashMinor);
    const sale = { id: randomUUID(), number: `DEMO-${String(saleNumber++).padStart(4, '0')}`, status: 'COMPLETED', returns: [], totalMinor: String(total), discountMinor: String(items.reduce((sum, item) => sum + BigInt(item.discountMinor), 0n)), createdAt: new Date().toISOString(), store: { ...store, address: 'Тестовый адрес', phone: null }, employee: { name: 'Демо' }, items, payments: (body.payments ?? []).map(payment => ({ id: randomUUID(), amountMinor: payment.amountMinor, paymentMethod: methods.find(method => method.id === payment.paymentMethodId) })), customer: saleCustomer };
    if (sale.customer) { sale.customer.totalSpentMinor = String(BigInt(sale.customer.totalSpentMinor) + total); sale.customer.ordersCount += 1; sale.customer.debtBalanceMinor = String(BigInt(sale.customer.debtBalanceMinor) + debtMinor); updateAverage(sale.customer); }
    if (bonusMinor > 0n) {
      saleCustomer.bonusBalanceMinor = String(BigInt(saleCustomer.bonusBalanceMinor) - bonusMinor);
      bonusTransactions.unshift({ id: randomUUID(), operationId: body.operationId, customerId: saleCustomer.id, actorId: sessionEmployee.id, actor: { name: sessionEmployee.name }, type: 'SPEND', deltaMinor: String(-bonusMinor), balanceAfterMinor: saleCustomer.bonusBalanceMinor, reason: `Оплата бонусами по чеку ${sale.number}`, createdAt: sale.createdAt });
      recordAudit(sessionEmployee.id, 'CUSTOMER_BONUS_SPENT', 'BonusTransaction', bonusTransactions[0].id, body.deviceId);
    }
    if (debtMinor > 0n) customerDebtEntries.unshift({ id: randomUUID(), customerId: sale.customer.id, type: 'SALE', amountMinor: String(debtMinor), createdAt: sale.createdAt, sale: { number: sale.number }, customerPayment: null });
    sales.set(body.operationId, sale);
    recordAudit(sessionEmployee.id, 'SALE_CREATED', 'Sale', sale.id, body.deviceId);
    return send(response, 201, sale);
  }
  return error(response, 404, 'Демо-маршрут не найден');
});

server.listen(port, host, () => console.log(`Korea CRM POS demo: http://${host}:${port} (login: demo)`));
