import test from 'node:test';
import assert from 'node:assert/strict';
import { cabinetGroups, cabinetLinkActive, createLinks, visibleCabinetLinks } from '../lib/cabinet-navigation.ts';
import { firstCabinetPath } from '../lib/access.ts';

test('an employee restricted to orders lands on the orders page', () => {
  assert.equal(firstCabinetPath(['orders.view']), '/orders');
  const links = cabinetGroups.flatMap(group => visibleCabinetLinks(group.links, ['orders.view'], 'ORDER_VIEWER'));
  assert.deepEqual(links.map(link => link.href), ['/orders']);
});

test('cash-view-only employee can reach shifts without finance report permission', () => {
  const groups = cabinetGroups.flatMap(group => visibleCabinetLinks(group.links, ['finance.cash_view'], 'CASHIER'));
  assert.deepEqual(groups.map(link => link.href), ['/cash-shifts', '/registers']);
});

test('company audit link is restricted to the superuser role', () => {
  const links = cabinetGroups.flatMap(group => group.links);
  assert.ok(!visibleCabinetLinks(links, ['finance.view'], 'OWNER').some(link => link.href === '/audit'));
  assert.ok(visibleCabinetLinks(links, [], 'SUPERUSER').some(link => link.href === '/audit'));
});

test('finance and shifts have distinct active navigation states', () => {
  assert.equal(cabinetLinkActive('/cash-shifts', '/cash-shifts', ''), true);
  assert.equal(cabinetLinkActive('/finance', '/cash-shifts', ''), false);
  assert.equal(cabinetLinkActive('/finance', '/finance/categories', ''), false);
  assert.equal(cabinetLinkActive('/products', '/products/new', ''), true);
});

test('quick creation uses existing action permissions', () => {
  assert.deepEqual(visibleCabinetLinks(createLinks, ['sales.view'], 'CASHIER'), []);
  assert.deepEqual(visibleCabinetLinks(createLinks, ['inventory.start'], 'MANAGER').map(link => link.href), ['/inventories']);
});
