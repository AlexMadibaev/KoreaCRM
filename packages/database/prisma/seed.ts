import { PrismaClient } from '@prisma/client';
import { hash } from 'argon2';
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });

const prisma = new PrismaClient();
const permissionCodes = [
  'products.view', 'products.create', 'products.edit', 'products.delete',
  'brands.view', 'brands.create', 'brands.edit', 'brands.delete',
  'categories.view', 'categories.create', 'categories.edit', 'categories.delete',
  'sales.view', 'sales.create', 'sales.return',
  'customers.view', 'customers.create', 'customers.edit', 'customers.discount.edit', 'customers.delete',
  'finance.view', 'finance.edit', 'finance.cash_view', 'finance.cash', 'finance.supplier_pay', 'finance.customer_pay',
  'employees.view', 'employees.create', 'employees.edit',
  'inventory.view', 'inventory.adjust', 'inventory.start', 'inventory.count', 'inventory.complete', 'inventory.cancel',
  'suppliers.view', 'suppliers.create', 'suppliers.edit', 'suppliers.delete',
  'purchases.view', 'purchases.create', 'purchases.edit', 'purchases.submit', 'purchases.receive', 'purchases.cancel',
  'transfers.view', 'transfers.create', 'transfers.edit', 'transfers.request', 'transfers.approve', 'transfers.send', 'transfers.receive', 'transfers.cancel',
  'reports.view', 'settings.edit',
];
const roleCodes = ['OWNER', 'DIRECTOR', 'MANAGER', 'ADMIN', 'ACCOUNTANT', 'WAREHOUSE', 'CASHIER', 'SELLER'];
const roleGrants: Record<string, string[]> = {
  OWNER: permissionCodes,
  DIRECTOR: permissionCodes.filter((code) => code !== 'settings.edit'),
  MANAGER: ['customers.discount.edit', 'products.view', 'brands.view', 'categories.view', 'sales.view', 'sales.create', 'sales.return', 'customers.view', 'customers.create', 'customers.edit', 'employees.view', 'inventory.view', 'inventory.adjust', 'inventory.start', 'inventory.count', 'inventory.complete', 'inventory.cancel', 'suppliers.view', 'suppliers.create', 'suppliers.edit', 'purchases.view', 'purchases.create', 'purchases.edit', 'purchases.submit', 'purchases.receive', 'purchases.cancel', 'transfers.view', 'transfers.create', 'transfers.edit', 'transfers.request', 'transfers.approve', 'transfers.send', 'transfers.receive', 'transfers.cancel', 'finance.view', 'finance.edit', 'finance.cash_view', 'finance.cash', 'finance.supplier_pay', 'finance.customer_pay', 'reports.view'],
  ADMIN: ['customers.discount.edit', 'products.view', 'products.create', 'products.edit', 'brands.view', 'brands.create', 'brands.edit', 'categories.view', 'categories.create', 'categories.edit', 'sales.view', 'customers.view', 'customers.create', 'customers.edit', 'employees.view', 'employees.create', 'employees.edit', 'inventory.view', 'inventory.adjust', 'reports.view'],
  ACCOUNTANT: ['sales.view', 'customers.view', 'finance.view', 'finance.edit', 'finance.cash_view', 'finance.supplier_pay', 'finance.customer_pay', 'suppliers.view', 'purchases.view', 'reports.view'],
  WAREHOUSE: ['products.view', 'brands.view', 'categories.view', 'inventory.view', 'inventory.adjust', 'inventory.start', 'inventory.count', 'inventory.complete', 'inventory.cancel', 'suppliers.view', 'purchases.view', 'purchases.receive', 'transfers.view', 'transfers.create', 'transfers.edit', 'transfers.request', 'transfers.send', 'transfers.receive', 'transfers.cancel'],
  CASHIER: ['customers.discount.edit', 'products.view', 'brands.view', 'categories.view', 'sales.view', 'sales.create', 'sales.return', 'customers.view', 'customers.create', 'finance.cash_view', 'finance.cash', 'finance.customer_pay'],
  SELLER: ['customers.discount.edit', 'products.view', 'brands.view', 'categories.view', 'sales.view', 'sales.create', 'customers.view', 'customers.create'],
};

async function main() {
  const ownerLogin = process.env.SEED_OWNER_LOGIN;
  const ownerPassword = process.env.SEED_OWNER_PASSWORD;
  if (!ownerLogin || !ownerPassword || ownerPassword.length < 12) {
    throw new Error('Set SEED_OWNER_LOGIN and SEED_OWNER_PASSWORD (at least 12 characters)');
  }
  for (const code of permissionCodes) {
    await prisma.permission.upsert({ where: { code }, update: {}, create: { code } });
  }
  for (const code of roleCodes) {
    await prisma.role.upsert({ where: { code }, update: { name: code, system: true }, create: { code, name: code, system: true } });
  }
  for (const name of ['Аренда', 'Зарплата', 'Коммунальные', 'Реклама', 'Транспорт', 'Хозяйственные', 'Закупка', 'Прочее']) {
    await prisma.expenseCategory.upsert({ where: { name }, update: {}, create: { name } });
  }
  for (const method of [
    { code: 'CASH', name: 'Наличные', kind: 'CASH' },
    { code: 'CARD', name: 'Карта', kind: 'CARD' },
    { code: 'QR', name: 'QR', kind: 'QR' },
    { code: 'TRANSFER', name: 'Перевод', kind: 'TRANSFER' },
    { code: 'BONUS', name: 'Бонусы', kind: 'BONUS' },
    { code: 'DEBT', name: 'Долг', kind: 'DEBT' },
  ] as const) {
    await prisma.salePaymentMethod.upsert({ where: { code: method.code }, update: { name: method.name, kind: method.kind, system: true, active: true }, create: { ...method, system: true, active: true } });
  }
  const permissions = await prisma.permission.findMany();
  const permissionByCode = new Map(permissions.map((permission) => [permission.code, permission.id]));
  for (const code of roleCodes) {
    const role = await prisma.role.findUniqueOrThrow({ where: { code } });
    await prisma.rolePermission.createMany({
      data: roleGrants[code]!.map((permissionCode) => ({ roleId: role.id, permissionId: permissionByCode.get(permissionCode)! })),
      skipDuplicates: true,
    });
  }
  const ownerRole = await prisma.role.findUniqueOrThrow({ where: { code: 'OWNER' } });
  await prisma.store.upsert({
    where: { code: 'MAIN' },
    update: {},
    create: { code: 'MAIN', name: 'Основной магазин' },
  });
  await prisma.user.upsert({
    where: { login: ownerLogin },
    update: {},
    create: {
      login: ownerLogin,
      name: 'Владелец',
      passwordHash: await hash(ownerPassword),
      roleId: ownerRole.id,
      allStores: true,
    },
  });
}

main().finally(() => prisma.$disconnect());
