import { Injectable, NotFoundException } from '@nestjs/common';
import { NotificationType, Prisma } from '@prisma/client';
import { DatabaseService } from '../database.service';
import type { AccessContext } from '../auth/policy';

type StockAlert = { storeId: string; productId: string; productName: string; sku: string; quantity: number; minStock: number };
type TransferStage = 'REQUESTED' | 'APPROVED' | 'IN_TRANSIT' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'CANCELLED';
const transferTitles: Record<TransferStage, string> = {
  REQUESTED: 'Запрошено перемещение',
  APPROVED: 'Перемещение согласовано',
  IN_TRANSIT: 'Товар отправлен',
  PARTIALLY_RECEIVED: 'Товар частично принят',
  RECEIVED: 'Перемещение завершено',
  CANCELLED: 'Перемещение отменено',
};

export function stockAlertType(quantity: number, minStock: number): NotificationType | null {
  if (quantity < 0) return NotificationType.NEGATIVE_STOCK;
  if (quantity === 0) return NotificationType.OUT_OF_STOCK;
  if (minStock > 0 && quantity <= minStock) return NotificationType.LOW_STOCK;
  return null;
}

function alertText(alert: StockAlert, type: NotificationType) {
  const title = type === NotificationType.NEGATIVE_STOCK ? 'Отрицательный остаток' : type === NotificationType.OUT_OF_STOCK ? 'Товар закончился' : 'Остаток ниже минимума';
  return { title, message: `${alert.productName} · ${alert.sku}: ${alert.quantity} шт. / минимум ${alert.minStock}` };
}

const defaultLargeReturnMinor = '100000000';
function largeReturnThreshold() {
  const value = process.env.NOTIFICATION_LARGE_RETURN_MINOR ?? defaultLargeReturnMinor;
  if (!/^[1-9]\d{0,17}$/.test(value)) throw new Error('NOTIFICATION_LARGE_RETURN_MINOR must be a positive integer up to 18 digits');
  return new Prisma.Decimal(value);
}
const defaultLargeDiscountMinor = '10000000';
const defaultLargeDiscountPercent = '20';
function largeDiscountThresholds() {
  const minor = process.env.NOTIFICATION_LARGE_DISCOUNT_MINOR ?? defaultLargeDiscountMinor;
  const percent = process.env.NOTIFICATION_LARGE_DISCOUNT_PERCENT ?? defaultLargeDiscountPercent;
  if (!/^[1-9]\d{0,17}$/.test(minor)) throw new Error('NOTIFICATION_LARGE_DISCOUNT_MINOR must be a positive integer up to 18 digits');
  if (!/^(?:[1-9]|[1-9]\d|100)$/.test(percent)) throw new Error('NOTIFICATION_LARGE_DISCOUNT_PERCENT must be an integer from 1 to 100');
  return { minor: new Prisma.Decimal(minor), percent: new Prisma.Decimal(percent) };
}
function formatMinor(amountMinor: Prisma.Decimal) {
  const minor = BigInt(amountMinor.toString());
  return `${new Intl.NumberFormat('ru-RU').format(minor / 100n)},${String(minor % 100n).padStart(2, '0')}`;
}

@Injectable()
export class NotificationsService {
  constructor(private readonly db: DatabaseService) {}

  async recordLargeDiscount(tx: Prisma.TransactionClient, sale: { id: string; storeId: string; number: string }, subtotalMinor: Prisma.Decimal, discountMinor: Prisma.Decimal) {
    const threshold = largeDiscountThresholds();
    if (subtotalMinor.lte(0) || discountMinor.lt(threshold.minor) || discountMinor.mul(100).lt(subtotalMinor.mul(threshold.percent))) return;
    const recipients = await tx.user.findMany({
      where: {
        active: true,
        OR: [{ allStores: true }, { stores: { some: { storeId: sale.storeId } } }],
        role: { permissions: { some: { permission: { code: 'sales.view' } } } },
      },
      select: { id: true },
    });
    if (!recipients.length) return;
    const percent = discountMinor.mul(100).div(subtotalMinor).toDecimalPlaces(1).toString().replace('.', ',');
    await tx.notification.createMany({
      data: recipients.map(user => ({
        userId: user.id,
        sourceKey: `sale:${sale.id}:large-discount`,
        type: NotificationType.LARGE_DISCOUNT,
        storeId: sale.storeId,
        title: 'Крупная скидка',
        message: `Чек ${sale.number} · скидка ${formatMinor(discountMinor)} сум (${percent}%)`,
      })),
      skipDuplicates: true,
    });
  }

  async recordLargeReturn(tx: Prisma.TransactionClient, record: { id: string; saleId: string; storeId: string }, saleNumber: string, amountMinor: Prisma.Decimal) {
    if (amountMinor.lt(largeReturnThreshold())) return;
    const recipients = await tx.user.findMany({
      where: {
        active: true,
        OR: [{ allStores: true }, { stores: { some: { storeId: record.storeId } } }],
        role: { permissions: { some: { permission: { code: 'sales.view' } } } },
      },
      select: { id: true },
    });
    if (!recipients.length) return;
    await tx.notification.createMany({
      data: recipients.map(user => ({
        userId: user.id,
        sourceKey: `return:${record.id}:sale:${record.saleId}`,
        type: NotificationType.LARGE_RETURN,
        storeId: record.storeId,
        title: 'Крупный возврат',
        message: `Чек ${saleNumber} · ${formatMinor(amountMinor)} сум`,
      })),
      skipDuplicates: true,
    });
  }

  async recordTransfer(tx: Prisma.TransactionClient, transfer: { id: string; fromStoreId: string; toStoreId: string }, stage: TransferStage, receiptId?: string) {
    const storeIds = [transfer.fromStoreId, transfer.toStoreId];
    const [stores, recipients] = await Promise.all([
      tx.store.findMany({ where: { id: { in: storeIds } }, select: { id: true, name: true } }),
      tx.user.findMany({
        where: {
          active: true,
          OR: [{ allStores: true }, { stores: { some: { storeId: { in: storeIds } } } }],
          role: { AND: [
            { permissions: { some: { permission: { code: 'transfers.view' } } } },
            { permissions: { some: { permission: { code: 'inventory.view' } } } },
          ] },
        },
        select: { id: true, allStores: true, stores: { where: { storeId: { in: storeIds } }, select: { storeId: true } } },
      }),
    ]);
    if (!recipients.length) return;
    const names = new Map(stores.map(store => [store.id, store.name]));
    const message = `${names.get(transfer.fromStoreId) ?? 'Магазин'} → ${names.get(transfer.toStoreId) ?? 'Магазин'}`;
    const sourceKey = `transfer:${transfer.id}:${receiptId ? `receipt:${receiptId}` : stage}`;
    await tx.notification.createMany({
      data: recipients.map(user => ({
        userId: user.id,
        sourceKey,
        type: NotificationType.TRANSFER,
        storeId: user.allStores || user.stores.some(store => store.storeId === transfer.fromStoreId) ? transfer.fromStoreId : transfer.toStoreId,
        title: transferTitles[stage],
        message,
      })),
      skipDuplicates: true,
    });
  }

  private scope(access: AccessContext): Prisma.NotificationWhereInput {
    return { userId: access.userId, storeId: access.allStores ? undefined : { in: access.storeIds } };
  }

  private async stockAlerts(access: AccessContext): Promise<StockAlert[]> {
    if (!access.allStores && access.storeIds.length === 0) return [];
    const scope = access.allStores ? Prisma.empty : Prisma.sql`AND st.id IN (${Prisma.join(access.storeIds.map(id => Prisma.sql`${id}::uuid`))})`;
    return this.db.$queryRaw<StockAlert[]>`
      SELECT ps."storeId", ps."productId", p.name AS "productName", p.sku,
             COALESCE(s.quantity, 0) AS quantity, ps."minStock"
      FROM "StoreProductSettings" ps
      JOIN "Product" p ON p.id = ps."productId"
      JOIN "Store" st ON st.id = ps."storeId"
      LEFT JOIN "Stock" s ON s."storeId" = ps."storeId" AND s."productId" = ps."productId"
      WHERE ps.active = true AND p."deletedAt" IS NULL AND p.status = 'ACTIVE'
        AND st."deletedAt" IS NULL AND st.status = 'ACTIVE'
        AND COALESCE(s.quantity, 0) <= ps."minStock" ${scope}
      UNION ALL
      SELECT s."storeId", s."productId", p.name AS "productName", p.sku,
             s.quantity, 0 AS "minStock"
      FROM "Stock" s
      JOIN "Product" p ON p.id = s."productId"
      JOIN "Store" st ON st.id = s."storeId"
      LEFT JOIN "StoreProductSettings" ps ON ps."storeId" = s."storeId" AND ps."productId" = s."productId"
      WHERE ps."storeId" IS NULL AND s.quantity <= 0
        AND p."deletedAt" IS NULL AND p.status = 'ACTIVE'
        AND st."deletedAt" IS NULL AND st.status = 'ACTIVE' ${scope}
    `;
  }

  async syncStock(access: AccessContext) {
    if (!access.permissions.includes('inventory.view')) return;
    if (!access.allStores && access.storeIds.length === 0) return;
    const alerts = (await this.stockAlerts(access)).map(alert => ({ ...alert, type: stockAlertType(alert.quantity, alert.minStock) })).filter((alert): alert is StockAlert & { type: NotificationType } => alert.type !== null);
    const current = await this.db.notification.findMany({ where: { ...this.scope(access), sourceKey: { startsWith: 'stock:' } } });
    const existing = new Map(current.map(item => [item.sourceKey, item]));
    const activeKeys = new Set<string>();
    for (const alert of alerts) {
      const sourceKey = `stock:${alert.storeId}:${alert.productId}`;
      activeKeys.add(sourceKey);
      const previous = existing.get(sourceKey);
      const text = alertText(alert, alert.type);
      const data = { type: alert.type, storeId: alert.storeId, productId: alert.productId, quantity: alert.quantity, minStock: alert.minStock, ...text };
      if (!previous) {
        await this.db.notification.upsert({ where: { userId_sourceKey: { userId: access.userId, sourceKey } }, create: { userId: access.userId, sourceKey, ...data }, update: data });
      } else if (previous.resolvedAt || previous.type !== alert.type) {
        await this.db.notification.update({ where: { id: previous.id }, data: { ...data, readAt: null, resolvedAt: null, createdAt: new Date() } });
      } else if (previous.quantity !== null && alert.quantity < previous.quantity) {
        await this.db.notification.update({ where: { id: previous.id }, data: { ...data, readAt: null, createdAt: new Date() } });
      } else if (previous.quantity !== alert.quantity || previous.minStock !== alert.minStock || previous.message !== text.message) {
        await this.db.notification.update({ where: { id: previous.id }, data });
      }
    }
    const resolvedIds = current.filter(item => !item.resolvedAt && !activeKeys.has(item.sourceKey)).map(item => item.id);
    if (resolvedIds.length) await this.db.notification.updateMany({ where: { id: { in: resolvedIds }, userId: access.userId }, data: { resolvedAt: new Date() } });
  }

  async list(access: AccessContext, page: number, limit: number, unreadOnly: boolean) {
    await this.syncStock(access);
    const base = { ...this.scope(access), resolvedAt: null } satisfies Prisma.NotificationWhereInput;
    const where = { ...base, readAt: unreadOnly ? null : undefined } satisfies Prisma.NotificationWhereInput;
    const [items, total, unreadCount] = await this.db.$transaction([
      this.db.notification.findMany({ where, include: { store: { select: { name: true } } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * limit, take: limit }),
      this.db.notification.count({ where }),
      this.db.notification.count({ where: { ...base, readAt: null } }),
    ]);
    return { items, total, unreadCount, page, limit };
  }

  async summary(access: AccessContext) {
    await this.syncStock(access);
    return { unreadCount: await this.db.notification.count({ where: { ...this.scope(access), resolvedAt: null, readAt: null } }) };
  }

  async markRead(access: AccessContext, id: string) {
    const result = await this.db.notification.updateMany({ where: { ...this.scope(access), id, resolvedAt: null }, data: { readAt: new Date() } });
    if (!result.count) throw new NotFoundException('Notification not found');
    return { success: true };
  }

  async readAll(access: AccessContext) {
    await this.syncStock(access);
    const result = await this.db.notification.updateMany({ where: { ...this.scope(access), resolvedAt: null, readAt: null }, data: { readAt: new Date() } });
    return { updated: result.count };
  }
}
