import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { access as fileAccess, mkdir, rm, writeFile } from 'node:fs/promises';

const url = new URL(process.env.DATABASE_URL);
assert.ok(['localhost', '127.0.0.1'].includes(url.hostname) && /^\/koreacrm_deploy_check_/.test(url.pathname), 'An isolated local deploy-check database is required');
process.env.JWT_SECRET = randomBytes(32).toString('hex');
const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
const { PrismaClient } = require('@prisma/client');
const { hash } = require('argon2');
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('./dist/app.module.js');
const { FinanceService } = require('./dist/finance/finance.service.js');
const db = new PrismaClient();
const suffix = randomBytes(5).toString('hex');
const password = randomBytes(24).toString('base64url');
const storeIds = [], customerIds = [], userIds = [], roleIds = [];
let app;
try {
  const role = await db.role.findUniqueOrThrow({ where: { code: 'SUPERUSER' } });
  for (const [index, name] of ['Магазин Айни — проверка рейтинга клиентов', 'Другой магазин', 'Архивный магазин'].entries()) {
    const store = await db.store.create({ data: { code: `TOP_${suffix.toUpperCase()}_${index}`, name, status: index === 2 ? 'ARCHIVED' : 'ACTIVE' } });
    storeIds.push(store.id);
  }
  const passwordHash = await hash(password);
  const owner = await db.user.create({ data: { name: 'Тест рейтинга', login: `top-owner-${suffix}`, passwordHash, roleId: role.id, allStores: true } });
  userIds.push(owner.id);
  const limited = await db.user.create({ data: { name: 'Только первый магазин', login: `top-limited-${suffix}`, passwordHash, roleId: role.id, stores: { create: { storeId: storeIds[0] } }, primaryStoreId: storeIds[0] } });
  userIds.push(limited.id);
  const noCustomers = await db.role.create({ data: { code: `TOP_FIN_${suffix.toUpperCase()}`, name: 'Finance without customer access', permissions: { create: { permission: { connect: { code: 'finance.view' } } } } } });
  roleIds.push(noCustomers.id);
  const restricted = await db.user.create({ data: { name: 'Без доступа к клиентам', login: `top-restricted-${suffix}`, passwordHash, roleId: noCustomers.id, allStores: true } });
  userIds.push(restricted.id);
  for (const [index, name] of ['Альфа', 'Бета', 'Гамма', 'Дельта', 'Эпсилон', 'Зета', 'Удалённый клиент', 'Клиент большого чека', 'Полный возврат'].entries()) {
    const customer = await db.customer.create({ data: { firstName: name, lastName: index === 0 ? 'с очень длинным именем для проверки переноса на телефоне' : '', phone: `+992${String((BigInt('0x' + suffix) + BigInt(index)) % 1000000000n).padStart(9, '0')}`, deletedAt: index === 6 ? new Date() : null } });
    customerIds.push(customer.id);
  }
  const shift = await db.cashShift.create({ data: { storeId: storeIds[0], deviceId: `WEB-TOP-${suffix}`, openedById: owner.id, openingCashMinor: 0, expectedCashMinor: 0 } });
  let sequence = 0;
  async function sale(customer, amount, store = 0, createdAt = '2026-11-07T12:00:00.000Z', status = 'COMPLETED') {
    const number = ++sequence;
    return db.sale.create({ data: { operationId: randomUUID(), requestHash: `top-${suffix}-${number}`, number: String(number), sequence: number, storeId: storeIds[store], deviceId: shift.deviceId, employeeId: owner.id, customerId: customer === null ? null : customerIds[customer], subtotalMinor: amount, discountMinor: 0, totalMinor: amount, costMinor: 0, profitMinor: amount, createdAt: new Date(createdAt), status } });
  }
  await sale(0, '100000');
  const oldSale = await sale(0, '200000', 0, '2026-10-01T12:00:00.000Z');
  const beta = await sale(1, '80000');
  for (const [index, amount] of [[2, '50000'], [3, '45000'], [4, '40000'], [5, '35000']]) await sale(index, amount);
  await sale(2, '500000', 1);
  await sale(5, '1000000', 2);
  await sale(5, '999999', 0, '2026-11-07T12:00:00.000Z', 'VOIDED');
  await sale(6, '1000000');
  await sale(7, '9007199254740993', 1);
  await sale(null, '999999');
  await sale(5, '999999', 0, '2026-11-10T00:00:00.000Z');
  await sale(5, '1000', 0, '2026-11-07T22:00:00.000Z');
  const fullReturn = await sale(8, '10000');
  for (const [record, amount, createdAt] of [[oldSale, '40000', '2026-11-08T12:00:00.000Z'], [beta, '70000', '2026-11-10T00:00:00.000Z'], [fullReturn, '10000', '2026-11-08T12:00:00.000Z']]) {
    await db.saleReturn.create({ data: { operationId: randomUUID(), saleId: record.id, storeId: storeIds[0], cashShiftId: shift.id, deviceId: shift.deviceId, employeeId: owner.id, amountMinor: amount, costMinor: 0, profitMinor: amount, reason: 'Isolated query fixture', createdAt: new Date(createdAt) } });
  }
  const input = { from: '2026-11-05', to: '2026-11-09', storeId: storeIds[0] };
  const access = { userId: owner.id, allStores: true, storeIds: [], permissions: ['finance.view', 'customers.view'] };
  const service = new FinanceService(db);
  const top = await service.topCustomers(input, access);
  assert.deepEqual(top.items.map(row => [row.customerId, row.revenueMinor, row.checksCount]), [[1, '80000', 1], [0, '60000', 1], [2, '50000', 1], [3, '45000', 1], [4, '40000', 1]].map(([index, ...values]) => [customerIds[index], ...values]));
  assert.equal((await service.topCustomers({ ...input, storeId: storeIds[1] }, access)).items[0].revenueMinor, '9007199254740993');
  const archived = await service.topCustomers({ ...input, storeId: undefined, scope: 'all' }, access);
  assert.ok(archived.items.some(row => row.customerId === customerIds[5] && row.revenueMinor === '1036000'));
  const limitedAccess = { ...access, allStores: false, storeIds: [storeIds[0]] };
  assert.deepEqual((await service.topCustomers({ ...input, storeId: undefined, scope: 'all' }, limitedAccess)).items, top.items);
  await assert.rejects(service.topCustomers({ ...input, storeId: storeIds[1] }, limitedAccess));
  assert.deepEqual((await service.topCustomers({ ...input, from: '2027-01-01', to: '2027-01-01' }, access)).items, []);
  for (const timezone of ['UTC', 'Asia/Tashkent']) await db.$transaction(async tx => {
    await tx.$executeRawUnsafe(`SET LOCAL TIME ZONE '${timezone}'`);
    const service = new FinanceService(tx);
    assert.deepEqual((await service.topCustomers(input, access)).items, top.items);
    const trend = await service.salesTrend(input, access);
    assert.equal(trend.days.find(day => day.date === '2026-11-07').salesMinor, '2360999');
    assert.equal(trend.days.find(day => day.date === '2026-11-08').returnsMinor, '50000');
    assert.equal(trend.days.find(day => day.date === '2026-11-09').salesMinor, '0');
  });
  assert.equal((await service.summary(input, access)).revenueMinor, '2310999');
  app = await NestFactory.create(AppModule, { logger: false });
  app.enableCors({ origin: 'http://127.0.0.1:3015' });
  await app.listen(process.argv.includes('--serve') ? 3024 : 0, '127.0.0.1');
  const base = await app.getUrl();
  const login = async user => {
    const response = await fetch(base + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: user.login, password }) });
    assert.equal(response.status, 201);
    return (await response.json()).accessToken;
  };
  for (const [user, query, status] of [[owner, input, 200], [limited, { ...input, storeId: storeIds[1] }, 403], [restricted, input, 403]]) {
    const token = await login(user);
    const response = await fetch(base + '/finance/top-customers?' + new URLSearchParams(query), { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(response.status, status);
    if (status === 200) assert.deepEqual((await response.json()).items, top.items);
  }
  console.log('TOP_CUSTOMERS_REAL_DB_HTTP_PASS: ranking, returns, dates, top five, precision, stores, archive and permissions');
  if (process.argv.includes('--serve')) {
    await mkdir('.mvp-local/top-customers-check', { recursive: true });
    const stopFile = '.mvp-local/top-customers-check/stop';
    await rm(stopFile, { force: true });
    await writeFile('.mvp-local/top-customers-check/session.json', JSON.stringify({ base: 'http://127.0.0.1:3015', api: base, login: owner.login, restrictedLogin: restricted.login, password, storeId: storeIds[0] }), { mode: 0o600 });
    console.log('LOCAL_BROWSER_FIXTURES_READY');
    await new Promise(resolve => {
      const stop = () => { clearInterval(timer); process.stdin.pause(); resolve(); };
      const timer = setInterval(() => { fileAccess(stopFile).then(stop).catch(() => {}); }, 500);
      process.once('SIGINT', stop);
      process.stdin.resume();
      process.stdin.on('data', chunk => { if (chunk.toString().trim() === 'stop') stop(); });
    });
    await rm(stopFile, { force: true });
  }
} finally {
  await app?.close();
  const sales = await db.sale.findMany({ where: { storeId: { in: storeIds } }, select: { id: true } });
  await db.saleReturn.deleteMany({ where: { saleId: { in: sales.map(sale => sale.id) } } });
  await db.sale.deleteMany({ where: { storeId: { in: storeIds } } });
  await db.cashShift.deleteMany({ where: { storeId: { in: storeIds } } });
  await db.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
  await db.auditLog.deleteMany({ where: { userId: { in: userIds } } });
  await db.userStore.deleteMany({ where: { userId: { in: userIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  await db.rolePermission.deleteMany({ where: { roleId: { in: roleIds } } });
  await db.role.deleteMany({ where: { id: { in: roleIds } } });
  await db.customer.deleteMany({ where: { id: { in: customerIds } } });
  await db.store.deleteMany({ where: { id: { in: storeIds } } });
  await db.$disconnect();
}
