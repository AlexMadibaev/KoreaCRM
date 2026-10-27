import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { z } from 'zod';
import { DatabaseService } from '../database.service';
import { canAccessStore, type AccessContext } from '../auth/policy';
import { storeCreateSchema, storePatchSchema } from './stores.schemas';

const publicStore = { id: true, name: true, code: true, address: true, phone: true, status: true, managerId: true, manager: { select: { id: true, name: true } }, createdAt: true, _count: { select: { users: true, posDevices: true } } } as const;

@Injectable()
export class StoresService {
  constructor(private readonly db: DatabaseService) {}

  async list(access: AccessContext) {
    return this.db.store.findMany({ where: { deletedAt: null, id: access.allStores ? undefined : { in: access.storeIds } }, select: publicStore, orderBy: { name: 'asc' } });
  }

  async detail(id: string, access: AccessContext) {
    if (!canAccessStore(access, id)) throw new ForbiddenException();
    const store = await this.db.store.findFirst({ where: { id, deletedAt: null }, select: publicStore });
    if (!store) throw new NotFoundException('Магазин не найден');
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [employees, devices, sales, lowStock] = await Promise.all([
      this.db.user.findMany({ where: { deletedAt: null, active: true, OR: [{ allStores: true }, { stores: { some: { storeId: id } } }] }, select: { id: true, name: true, login: true, primaryStoreId: true, allStores: true, role: { select: { code: true, name: true } } }, orderBy: { name: 'asc' } }),
      this.db.posDevice.findMany({ where: { storeId: id }, select: { deviceId: true, status: true, lastActivityAt: true, lastSyncAt: true }, orderBy: { lastActivityAt: 'desc' } }),
      this.db.sale.aggregate({ where: { storeId: id, createdAt: { gte: since }, status: 'COMPLETED' }, _count: { id: true }, _sum: { totalMinor: true } }),
      this.db.$queryRaw<{ count: bigint }[]>`SELECT COUNT(*)::bigint AS count FROM "StoreProductSettings" s LEFT JOIN "Stock" st ON st."storeId" = s."storeId" AND st."productId" = s."productId" WHERE s."storeId" = ${id}::uuid AND s.active = true AND s."minStock" > 0 AND COALESCE(st.quantity - st."reservedQuantity", 0) <= s."minStock"`,
    ]);
    return { ...store, employees, devices, summary: { salesCount30Days: sales._count.id, salesTotalMinor30Days: (sales._sum.totalMinor ?? new Prisma.Decimal(0)).toString(), lowStockCount: Number(lowStock[0]?.count ?? 0) } };
  }

  async create(input: z.infer<typeof storeCreateSchema>, access: AccessContext) {
    if (!access.allStores) throw new ForbiddenException('Создавать магазины может только владелец сети');
    try {
      const store = await this.db.$transaction(async tx => {
        const created = await tx.store.create({ data: { name: input.name, code: input.code, address: input.address || null, phone: input.phone || null } });
        await tx.auditLog.create({ data: { userId: access.userId, action: 'STORE_CREATED', entityType: 'Store', entityId: created.id, newValue: { name: created.name, code: created.code, address: created.address, phone: created.phone } } });
        return created;
      });
      return this.detail(store.id, access);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('Код магазина уже занят');
      throw error;
    }
  }

  async update(id: string, input: z.infer<typeof storePatchSchema>, access: AccessContext) {
    if (!canAccessStore(access, id)) throw new ForbiddenException();
    const current = await this.db.store.findFirst({ where: { id, deletedAt: null } });
    if (!current) throw new NotFoundException('Магазин не найден');
    if ((input.status === 'ARCHIVED' || current.status === 'ARCHIVED' && input.status !== undefined) && !access.permissions.includes('stores.archive')) throw new ForbiddenException('Статус архива может менять только владелец сети');
    if (input.managerId) {
      const manager = await this.db.user.findFirst({ where: { id: input.managerId, active: true, deletedAt: null, OR: [{ allStores: true }, { stores: { some: { storeId: id } } }] }, select: { id: true } });
      if (!manager) throw new BadRequestException('Ответственный должен работать в этом магазине');
    }
    if (input.status && input.status !== 'ACTIVE' && current.status === 'ACTIVE' && await this.db.cashShift.count({ where: { storeId: id, status: 'OPEN' } })) throw new ConflictException('Сначала закройте кассовые смены');
    await this.db.$transaction(async tx => {
      await tx.store.update({ where: { id }, data: { name: input.name, address: input.address, phone: input.phone, managerId: input.managerId, status: input.status } });
      await tx.auditLog.create({ data: { userId: access.userId, action: 'STORE_UPDATED', entityType: 'Store', entityId: id, oldValue: { name: current.name, address: current.address, phone: current.phone, managerId: current.managerId, status: current.status }, newValue: { name: input.name ?? current.name, address: input.address === undefined ? current.address : input.address, phone: input.phone === undefined ? current.phone : input.phone, managerId: input.managerId === undefined ? current.managerId : input.managerId, status: input.status ?? current.status } } });
    });
    return this.detail(id, access);
  }

  async assignEmployee(storeId: string, userId: string, access: AccessContext) {
    if (!canAccessStore(access, storeId)) throw new ForbiddenException();
    const employee = await this.db.user.findFirst({ where: { id: userId, active: true, deletedAt: null }, include: { stores: true } });
    if (!employee || !access.allStores && (employee.allStores || employee.stores.some(item => !access.storeIds.includes(item.storeId)))) throw new ForbiddenException('Сотрудник недоступен');
    const role = await this.db.role.findUnique({ where: { id: employee.roleId }, select: { code: true, permissions: { select: { permission: { select: { code: true } } } } } });
    if (!role || role.code === 'SUPERUSER' && access.role !== 'SUPERUSER' || role.permissions.some(item => !access.permissions.includes(item.permission.code))) throw new ForbiddenException('Недостаточно прав для назначения сотрудника');
    if (!await this.db.store.findFirst({ where: { id: storeId, deletedAt: null }, select: { id: true } })) throw new NotFoundException('Магазин не найден');
    if (!employee.allStores && !employee.stores.some(item => item.storeId === storeId)) {
      await this.db.$transaction(async tx => {
        await tx.userStore.create({ data: { userId, storeId } });
        if (!employee.primaryStoreId) await tx.user.update({ where: { id: userId }, data: { primaryStoreId: storeId } });
        await tx.auditLog.create({ data: { userId: access.userId, action: 'STORE_EMPLOYEE_ASSIGNED', entityType: 'Store', entityId: storeId, newValue: { employeeId: userId } } });
      });
    }
    return this.detail(storeId, access);
  }

  async unassignEmployee(storeId: string, userId: string, access: AccessContext) {
    if (!canAccessStore(access, storeId)) throw new ForbiddenException();
    const employee = await this.db.user.findFirst({ where: { id: userId, deletedAt: null }, include: { stores: true } });
    if (!employee || employee.allStores || !employee.stores.some(item => item.storeId === storeId)) throw new NotFoundException('Назначение не найдено');
    if (!access.allStores && employee.stores.some(item => !access.storeIds.includes(item.storeId))) throw new ForbiddenException();
    if (employee.stores.length <= 1) throw new ConflictException('Сначала назначьте сотруднику другой магазин');
    const nextPrimary = employee.primaryStoreId === storeId ? employee.stores.find(item => item.storeId !== storeId)!.storeId : employee.primaryStoreId;
    await this.db.$transaction(async tx => {
      await tx.userStore.delete({ where: { userId_storeId: { userId, storeId } } });
      if (employee.primaryStoreId === storeId) await tx.user.update({ where: { id: userId }, data: { primaryStoreId: nextPrimary } });
      await tx.store.updateMany({ where: { id: storeId, managerId: userId }, data: { managerId: null } });
      await tx.auditLog.create({ data: { userId: access.userId, action: 'STORE_EMPLOYEE_UNASSIGNED', entityType: 'Store', entityId: storeId, oldValue: { employeeId: userId } } });
    });
    return this.detail(storeId, access);
  }
}
