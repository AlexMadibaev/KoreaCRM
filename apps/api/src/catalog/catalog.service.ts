import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DatabaseService } from '../database.service';
import type { z } from 'zod';
import { brandSchema, categorySchema, productQuerySchema, productSchema, productUpdateSchema, storeSettingsSchema } from './catalog.schemas';

type BrandInput = z.infer<typeof brandSchema>;
type CategoryInput = z.infer<typeof categorySchema>;
type ProductInput = z.infer<typeof productSchema>;
type ProductUpdate = z.infer<typeof productUpdateSchema>;
type ProductQuery = z.infer<typeof productQuerySchema>;
type StoreSettingsInput = z.infer<typeof storeSettingsSchema>;

function databaseError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') throw new ConflictException('Value already exists');
    if (error.code === 'P2003') throw new BadRequestException('Referenced record does not exist');
  }
  throw error;
}

function auditValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

@Injectable()
export class CatalogService {
  constructor(private readonly db: DatabaseService) {}

  async brands(page: number, limit: number, search?: string) {
    const where: Prisma.BrandWhereInput = { deletedAt: null, name: search ? { contains: search, mode: 'insensitive' } : undefined };
    const [items, total] = await this.db.$transaction([
      this.db.brand.findMany({ where, orderBy: { name: 'asc' }, skip: (page - 1) * limit, take: limit }),
      this.db.brand.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  async brand(id: string) {
    const item = await this.db.brand.findFirst({ where: { id, deletedAt: null } });
    if (!item) throw new NotFoundException('Brand not found');
    return item;
  }

  async createBrand(input: BrandInput, userId: string) {
    try {
      return await this.db.$transaction(async (tx) => {
        const item = await tx.brand.create({ data: input });
        await tx.auditLog.create({ data: { userId, action: 'BRAND_CREATED', entityType: 'Brand', entityId: item.id, newValue: { name: item.name } } });
        return item;
      });
    } catch (error) { return databaseError(error); }
  }

  async updateBrand(id: string, input: BrandInput, userId: string) {
    const old = await this.brand(id);
    try {
      return await this.db.$transaction(async (tx) => {
        const item = await tx.brand.update({ where: { id }, data: input });
        await tx.auditLog.create({ data: { userId, action: 'BRAND_UPDATED', entityType: 'Brand', entityId: id, oldValue: { name: old.name }, newValue: { name: item.name } } });
        return item;
      });
    } catch (error) { return databaseError(error); }
  }

  async deleteBrand(id: string, userId: string) {
    const old = await this.brand(id);
    await this.db.$transaction([
      this.db.brand.update({ where: { id }, data: { deletedAt: new Date() } }),
      this.db.auditLog.create({ data: { userId, action: 'BRAND_DELETED', entityType: 'Brand', entityId: id, oldValue: { name: old.name } } }),
    ]);
    return { success: true };
  }

  async categories(page: number, limit: number, search?: string) {
    const where: Prisma.CategoryWhereInput = { deletedAt: null, name: search ? { contains: search, mode: 'insensitive' } : undefined };
    const [items, total] = await this.db.$transaction([
      this.db.category.findMany({ where, orderBy: { name: 'asc' }, skip: (page - 1) * limit, take: limit }),
      this.db.category.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  async category(id: string) {
    const item = await this.db.category.findFirst({ where: { id, deletedAt: null } });
    if (!item) throw new NotFoundException('Category not found');
    return item;
  }

  private async validateParent(parentId: string | null | undefined, ownId?: string) {
    let current = parentId;
    const visited = new Set<string>();
    while (current) {
      if (current === ownId || visited.has(current)) throw new BadRequestException('Category cycle');
      visited.add(current);
      const parent = await this.category(current);
      current = parent.parentId;
    }
  }

  async createCategory(input: CategoryInput, userId: string) {
    await this.validateParent(input.parentId);
    try {
      return await this.db.$transaction(async (tx) => {
        const item = await tx.category.create({ data: input });
        await tx.auditLog.create({ data: { userId, action: 'CATEGORY_CREATED', entityType: 'Category', entityId: item.id, newValue: { name: item.name, parentId: item.parentId } } });
        return item;
      });
    } catch (error) { return databaseError(error); }
  }

  async updateCategory(id: string, input: CategoryInput, userId: string) {
    const old = await this.category(id);
    await this.validateParent(input.parentId, id);
    try {
      return await this.db.$transaction(async (tx) => {
        const item = await tx.category.update({ where: { id }, data: input });
        await tx.auditLog.create({ data: { userId, action: 'CATEGORY_UPDATED', entityType: 'Category', entityId: id, oldValue: { name: old.name, parentId: old.parentId }, newValue: { name: item.name, parentId: item.parentId } } });
        return item;
      });
    } catch (error) { return databaseError(error); }
  }

  async deleteCategory(id: string, userId: string) {
    const old = await this.category(id);
    if (await this.db.category.count({ where: { parentId: id, deletedAt: null } })) throw new ConflictException('Category has child categories');
    await this.db.$transaction([
      this.db.category.update({ where: { id }, data: { deletedAt: new Date() } }),
      this.db.auditLog.create({ data: { userId, action: 'CATEGORY_DELETED', entityType: 'Category', entityId: id, oldValue: { name: old.name, parentId: old.parentId } } }),
    ]);
    return { success: true };
  }

  async products(query: ProductQuery) {
    const where: Prisma.ProductWhereInput = {
      deletedAt: null,
      status: query.status,
      brandId: query.brandId,
      categoryId: query.categoryId,
      sku: query.sku,
      barcodes: query.barcode ? { some: { value: query.barcode } } : undefined,
      OR: query.search ? [
        { name: { contains: query.search, mode: 'insensitive' } },
        { sku: { contains: query.search, mode: 'insensitive' } },
        { barcodes: { some: { value: query.search } } },
      ] : undefined,
    };
    const [items, total] = await this.db.$transaction([
      this.db.product.findMany({ where, include: { brand: true, category: true, barcodes: true, images: { orderBy: { sortOrder: 'asc' } } }, orderBy: { createdAt: 'desc' }, skip: (query.page - 1) * query.limit, take: query.limit }),
      this.db.product.count({ where }),
    ]);
    return { items, total, page: query.page, limit: query.limit };
  }

  async posProducts(storeId: string, query: ProductQuery) {
    const store = await this.db.store.findFirst({ where: { id: storeId, deletedAt: null }, select: { id: true } });
    if (!store) throw new NotFoundException('Store not found');
    const where: Prisma.ProductWhereInput = {
      deletedAt: null,
      status: 'ACTIVE',
      OR: query.search ? [
        { name: { contains: query.search, mode: 'insensitive' } },
        { sku: { contains: query.search, mode: 'insensitive' } },
        { barcodes: { some: { value: query.search } } },
      ] : undefined,
    };
    const [products, total] = await this.db.$transaction([
      this.db.product.findMany({
        where,
        select: {
          id: true, name: true, sku: true, status: true,
          barcodes: { select: { value: true } },
          images: { orderBy: { sortOrder: 'asc' }, select: { storageKey: true } },
          storeSettings: { where: { storeId }, select: { priceMinor: true, active: true } },
          stocks: { where: { storeId }, select: { quantity: true, reservedQuantity: true } },
        },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.limit, take: query.limit,
      }),
      this.db.product.count({ where }),
    ]);
    return {
      items: products.map(product => {
        const settings = product.storeSettings[0];
        const stock = product.stocks[0];
        return {
          id: product.id, name: product.name, sku: product.sku, status: product.status,
          barcodes: product.barcodes, images: product.images,
          priceMinor: settings?.priceMinor ?? null,
          availableQuantity: Math.max(0, (stock?.quantity ?? 0) - (stock?.reservedQuantity ?? 0)),
          active: settings?.active ?? false,
        };
      }),
      total, page: query.page, limit: query.limit,
    };
  }

  async product(id: string) {
    const item = await this.db.product.findFirst({ where: { id, deletedAt: null }, include: { brand: true, category: true, barcodes: true, images: { orderBy: { sortOrder: 'asc' } } } });
    if (!item) throw new NotFoundException('Product not found');
    return item;
  }

  private async validateReferences(input: { brandId?: string | null; categoryId?: string | null }) {
    if (input.brandId && !await this.db.brand.findFirst({ where: { id: input.brandId, deletedAt: null } })) throw new BadRequestException('Brand not found');
    if (input.categoryId && !await this.db.category.findFirst({ where: { id: input.categoryId, deletedAt: null } })) throw new BadRequestException('Category not found');
  }

  private validateBarcodes(barcodes?: string[]) {
    if (barcodes && new Set(barcodes).size !== barcodes.length) throw new BadRequestException('Duplicate barcodes');
  }

  async createProduct(input: ProductInput, userId: string) {
    await this.validateReferences(input);
    this.validateBarcodes(input.barcodes);
    const { barcodes, imageKeys, ...data } = input;
    try {
      return await this.db.$transaction(async (tx) => {
        const item = await tx.product.create({ data: {
          ...data,
          barcodes: { create: barcodes.map((value, index) => ({ value, primary: index === 0 })) },
          images: { create: imageKeys.map((storageKey, sortOrder) => ({ storageKey, sortOrder })) },
        }, include: { brand: true, category: true, barcodes: true, images: true } });
        await tx.auditLog.create({ data: { userId, action: 'PRODUCT_CREATED', entityType: 'Product', entityId: item.id, newValue: auditValue(item) } });
        return item;
      });
    } catch (error) { return databaseError(error); }
  }

  async updateProduct(id: string, input: ProductUpdate, userId: string) {
    const old = await this.product(id);
    await this.validateReferences(input);
    this.validateBarcodes(input.barcodes);
    const { barcodes, imageKeys, ...data } = input;
    try {
      return await this.db.$transaction(async (tx) => {
        if (barcodes) {
          await tx.productBarcode.deleteMany({ where: { productId: id } });
          if (barcodes.length) await tx.productBarcode.createMany({ data: barcodes.map((value, index) => ({ productId: id, value, primary: index === 0 })) });
        }
        if (imageKeys) {
          await tx.productImage.deleteMany({ where: { productId: id } });
          if (imageKeys.length) await tx.productImage.createMany({ data: imageKeys.map((storageKey, sortOrder) => ({ productId: id, storageKey, sortOrder })) });
        }
        const item = await tx.product.update({ where: { id }, data, include: { brand: true, category: true, barcodes: true, images: true } });
        await tx.auditLog.create({ data: { userId, action: 'PRODUCT_UPDATED', entityType: 'Product', entityId: id, oldValue: auditValue(old), newValue: auditValue(item) } });
        return item;
      });
    } catch (error) { return databaseError(error); }
  }

  async deleteProduct(id: string, userId: string) {
    const old = await this.product(id);
    await this.db.$transaction([
      this.db.product.update({ where: { id }, data: { deletedAt: new Date() } }),
      this.db.auditLog.create({ data: { userId, action: 'PRODUCT_DELETED', entityType: 'Product', entityId: id, oldValue: auditValue(old) } }),
    ]);
    return { success: true };
  }

  async storeSettings(storeId: string, productId: string) {
    await this.product(productId);
    const store = await this.db.store.findFirst({ where: { id: storeId, deletedAt: null } });
    if (!store) throw new NotFoundException('Store not found');
    return this.db.storeProductSettings.findUnique({ where: { storeId_productId: { storeId, productId } } });
  }

  async saveStoreSettings(storeId: string, productId: string, input: StoreSettingsInput, userId: string) {
    const old = await this.storeSettings(storeId, productId);
    return this.db.$transaction(async (tx) => {
      const item = await tx.storeProductSettings.upsert({
        where: { storeId_productId: { storeId, productId } },
        create: { storeId, productId, priceMinor: input.priceMinor ?? null, minStock: input.minStock ?? 0, active: input.active ?? true },
        update: input,
      });
      await tx.auditLog.create({ data: { userId, action: old ? 'STORE_PRODUCT_SETTINGS_UPDATED' : 'STORE_PRODUCT_SETTINGS_CREATED', entityType: 'StoreProductSettings', entityId: `${storeId}:${productId}`, oldValue: old ? auditValue(old) : undefined, newValue: auditValue(item) } });
      return item;
    });
  }
}
