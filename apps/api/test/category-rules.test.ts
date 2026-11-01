import assert from 'node:assert/strict';
import test from 'node:test';
import { suggestCategory } from '../src/catalog/category-rules';
import { CatalogService } from '../src/catalog/catalog.service';
import type { DatabaseService } from '../src/database.service';

test('product names map to categories with specific types first', () => {
  const cases: [string, string | null][] = [
    ['Round Lab Birch Juice Moisturizing Sunscreen SPF50+', 'Солнцезащита'],
    ['Солнцезащитный крем Round Lab 1025 Dokdo', 'Солнцезащита'],
    ['LADOR WONDER BUBBLE SHAMPOO', 'Волосы'],
    ['TIRTIR MASK FIT RUBY MESHCUSHION', 'Макияж'],
    ['ВВ-крем Missha M Perfect Cover BB Cream', 'Макияж'],
    ['ETUDE Baking Powder B.B Deep Cleansing Foam', 'Очищение'],
    ['MEDIPEEL Peptide 9 Volume Tox Cream PRO', 'Кремы'],
    ['MEDIHEAL PHYTO ENZYMEPEELING PAD', 'Пэды'],
    ['Biodance Caviar PDRN Eye Patches', 'Патчи и пластыри'],
    ['Numbuzin No.5 Vitamin Sheet Mask (4ea)', 'Маски'],
    ['ANUA RETINOL 0.3% Серум', 'Сыворотки и ампулы'],
    ['ROUND LAB MUGWORT TONER', 'Тонеры и мисты'],
    ['FARMSTAY VISIBLE HAND CREAM', 'Тело и уход'],
    ['Гиф карта Адиба Зиёева', 'Подарочные карты'],
    ['БАД ГЛЮКОЗАМИН 3000IU', 'БАДы и коллаген'],
    ['Спонжи в футляре', 'Аксессуары'],
    ['Celimax dual barrier trial kit', 'Наборы'],
    ['Bosnic', null],
  ];
  for (const [name, category] of cases) assert.equal(suggestCategory(name), category, name);
});

test('auto categorize previews without writing and applies only to uncategorized products', async () => {
  const writes: string[] = [];
  const tx = {
    category: {
      findFirst: async ({ where }: { where: { name: { equals: string } } }) => where.name.equals === 'Кремы' ? { id: 'creams' } : null,
      create: async ({ data }: { data: { name: string } }) => { writes.push(`create:${data.name}`); return { id: `new-${data.name}` }; },
    },
    product: { updateMany: async ({ where, data }: { where: { id: { in: string[] }; categoryId: null }; data: { categoryId: string } }) => { assert.equal(where.categoryId, null); writes.push(`assign:${data.categoryId}:${where.id.in.join(',')}`); } },
    auditLog: { create: async () => { writes.push('audit'); } },
  };
  const db = {
    product: { findMany: async ({ where }: { where: { categoryId: null } }) => { assert.equal(where.categoryId, null); return [{ id: 'p1', name: 'Snail Cream' }, { id: 'p2', name: 'Sun Stick SPF50' }, { id: 'p3', name: 'Bosnic' }]; } },
    $transaction: async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
  } as unknown as DatabaseService;
  const service = new CatalogService(db);
  const preview = await service.autoCategorize(false, 'user-1');
  assert.equal(preview.applied, false);
  assert.equal(preview.total, 3);
  assert.equal(preview.matched, 2);
  assert.deepEqual(writes, []);
  const result = await service.autoCategorize(true, 'user-1');
  assert.equal(result.applied, true);
  assert.deepEqual(writes, ['assign:creams:p1', 'create:Солнцезащита', 'assign:new-Солнцезащита:p2', 'audit']);
});
