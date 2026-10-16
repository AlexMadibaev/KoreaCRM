import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { hash } from 'argon2';
import type { z } from 'zod';
import { DatabaseService } from '../database.service';
import type { AccessContext } from '../auth/policy';
import { employeeActivitySchema, employeeCreateSchema, employeeListSchema, employeePatchSchema, roleCreateSchema, rolePatchSchema } from './employees.schemas';

const userPublic = { id: true, name: true, login: true, active: true, allStores: true, createdAt: true, roleId: true, role: { select: { id: true, code: true, name: true, permissions: { select: { permission: { select: { code: true } } } } } }, stores: { select: { storeId: true } } } as const;
const rolePublic = { id: true, code: true, name: true, system: true, permissions: { select: { permission: { select: { code: true } } } } } as const;
const unique = (values: string[]) => [...new Set(values)];
const isDuplicate = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

@Injectable()
export class EmployeesService {
  constructor(private readonly db: DatabaseService) {}

  async list(actor: AccessContext, query: z.infer<typeof employeeListSchema>) {
    const where: Prisma.UserWhereInput = {
      ...(actor.allStores ? {} : { allStores: false, stores: { some: { storeId: { in: actor.storeIds } } } }),
      ...(query.search ? { OR: [{ name: { contains: query.search, mode: 'insensitive' } }, { login: { contains: query.search, mode: 'insensitive' } }] } : {}),
    };
    const [items, total] = await this.db.$transaction([this.db.user.findMany({ where, select: userPublic, orderBy: { createdAt: 'desc' }, skip: (query.page - 1) * query.limit, take: query.limit }), this.db.user.count({ where })]);
    return { items, total, page: query.page, limit: query.limit };
  }

  async roles() { return this.db.role.findMany({ select: rolePublic, orderBy: { name: 'asc' } }); }
  async permissions() { return this.db.permission.findMany({ select: { code: true }, orderBy: { code: 'asc' } }); }

  async activity(id: string, actor: AccessContext, query: z.infer<typeof employeeActivitySchema>) {
    const employee = await this.db.user.findUnique({ where: { id }, select: { id: true, allStores: true, stores: { select: { storeId: true } } } });
    if (!employee) throw new NotFoundException('Employee not found');
    if (!actor.allStores && (employee.allStores || !employee.stores.length || employee.stores.some(item => !actor.storeIds.includes(item.storeId)))) throw new ForbiddenException();
    const where: Prisma.AuditLogWhereInput = { OR: [{ userId: id }, { entityType: 'User', entityId: id }] };
    const [items, total] = await this.db.$transaction([
      this.db.auditLog.findMany({ where, select: { id: true, action: true, entityType: true, entityId: true, createdAt: true, ip: true, deviceId: true, user: { select: { id: true, name: true, login: true } } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (query.page - 1) * query.limit, take: query.limit }),
      this.db.auditLog.count({ where }),
    ]);
    return { items, total, page: query.page, limit: query.limit };
  }

  private async allowedRole(roleId: string, actor: AccessContext) {
    const role = await this.db.role.findUnique({ where: { id: roleId }, select: rolePublic });
    if (!role) throw new NotFoundException('Role not found');
    if (role.permissions.some(item => !actor.permissions.includes(item.permission.code))) throw new ForbiddenException('Role grants permissions you do not have');
    return role;
  }

  private async allowedScope(allStores: boolean, storeIds: string[], actor: AccessContext) {
    const uniqueIds = unique(storeIds);
    if (allStores && !actor.allStores) throw new ForbiddenException('All-store access is unavailable');
    if (!allStores && !uniqueIds.length) throw new BadRequestException('Select at least one store');
    if (!actor.allStores && uniqueIds.some(id => !actor.storeIds.includes(id))) throw new ForbiddenException('Store is outside your access');
    if (uniqueIds.length) {
      const count = await this.db.store.count({ where: { id: { in: uniqueIds }, deletedAt: null } });
      if (count !== uniqueIds.length) throw new BadRequestException('Unknown store');
    }
    return allStores ? [] : uniqueIds;
  }

  async create(input: z.infer<typeof employeeCreateSchema>, actor: AccessContext) {
    await this.allowedRole(input.roleId, actor);
    const storeIds = await this.allowedScope(input.allStores, input.storeIds, actor);
    const passwordHash = await hash(input.password);
    const pinHash = input.pin ? await hash(input.pin) : null;
    try {
      const id = await this.db.$transaction(async tx => {
        const employee = await tx.user.create({ data: { name: input.name, login: input.login, passwordHash, pinHash, roleId: input.roleId, allStores: input.allStores } });
        if (storeIds.length) await tx.userStore.createMany({ data: storeIds.map(storeId => ({ userId: employee.id, storeId })) });
        await tx.auditLog.create({ data: { userId: actor.userId, action: 'EMPLOYEE_CREATED', entityType: 'User', entityId: employee.id, newValue: { login: input.login, roleId: input.roleId, allStores: input.allStores, storeIds } } });
        return employee.id;
      });
      return this.db.user.findUniqueOrThrow({ where: { id }, select: userPublic });
    } catch (error) { if (isDuplicate(error)) throw new ConflictException('Login already exists'); throw error; }
  }

  async update(id: string, input: z.infer<typeof employeePatchSchema>, actor: AccessContext) {
    if (id === actor.userId) throw new ConflictException('Edit your own account through profile settings');
    const current = await this.db.user.findUnique({ where: { id }, select: userPublic });
    if (!current) throw new NotFoundException('Employee not found');
    if (!actor.allStores && (current.allStores || current.stores.some(item => !actor.storeIds.includes(item.storeId)))) throw new ForbiddenException();
    await this.allowedRole(current.roleId, actor);
    const roleId = input.roleId ?? current.roleId;
    await this.allowedRole(roleId, actor);
    const allStores = input.allStores ?? current.allStores;
    const storeIds = await this.allowedScope(allStores, input.storeIds ?? current.stores.map(item => item.storeId), actor);
    const passwordHash = input.password ? await hash(input.password) : undefined;
    const pinHash = input.pin === null ? null : input.pin ? await hash(input.pin) : undefined;
    try {
      await this.db.$transaction(async tx => {
        await tx.user.update({ where: { id }, data: { name: input.name, login: input.login, active: input.active, roleId, allStores, passwordHash, pinHash } });
        if (input.storeIds !== undefined || input.allStores !== undefined) {
          await tx.userStore.deleteMany({ where: { userId: id } });
          if (storeIds.length) await tx.userStore.createMany({ data: storeIds.map(storeId => ({ userId: id, storeId })) });
        }
        if (input.active === false || input.password) await tx.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
        await tx.auditLog.create({ data: { userId: actor.userId, action: 'EMPLOYEE_UPDATED', entityType: 'User', entityId: id, oldValue: { roleId: current.roleId, allStores: current.allStores, active: current.active }, newValue: { roleId, allStores, storeIds, active: input.active, name: input.name, login: input.login, passwordChanged: Boolean(input.password), pinChanged: input.pin !== undefined } } });
      });
      return this.db.user.findUniqueOrThrow({ where: { id }, select: userPublic });
    } catch (error) { if (isDuplicate(error)) throw new ConflictException('Login already exists'); throw error; }
  }

  private async checkedPermissions(codes: string[], actor: AccessContext) {
    const uniqueCodes = unique(codes);
    if (uniqueCodes.some(code => !actor.permissions.includes(code))) throw new ForbiddenException('Cannot grant permissions you do not have');
    if (await this.db.permission.count({ where: { code: { in: uniqueCodes } } }) !== uniqueCodes.length) throw new BadRequestException('Unknown permission');
    return uniqueCodes;
  }

  async createRole(input: z.infer<typeof roleCreateSchema>, actor: AccessContext) {
    const codes = await this.checkedPermissions(input.permissions, actor);
    try {
      const role = await this.db.$transaction(async tx => {
        const permissions = await tx.permission.findMany({ where: { code: { in: codes } }, select: { id: true } });
        const created = await tx.role.create({ data: { code: input.code, name: input.name, system: false, permissions: { create: permissions.map(permission => ({ permissionId: permission.id })) } } });
        await tx.auditLog.create({ data: { userId: actor.userId, action: 'ROLE_CREATED', entityType: 'Role', entityId: created.id, newValue: { code: input.code, permissions: codes } } });
        return created;
      });
      return this.db.role.findUniqueOrThrow({ where: { id: role.id }, select: rolePublic });
    } catch (error) { if (isDuplicate(error)) throw new ConflictException('Role code already exists'); throw error; }
  }

  async updateRole(id: string, input: z.infer<typeof rolePatchSchema>, actor: AccessContext) {
    const current = await this.db.role.findUnique({ where: { id }, select: rolePublic });
    if (!current) throw new NotFoundException('Role not found');
    if (current.system) throw new ConflictException('System role cannot be edited');
    if (current.permissions.some(item => !actor.permissions.includes(item.permission.code))) throw new ForbiddenException();
    const codes = input.permissions ? await this.checkedPermissions(input.permissions, actor) : undefined;
    if (codes && !codes.includes('settings.edit') && (await this.db.user.findUnique({ where: { id: actor.userId }, select: { roleId: true } }))?.roleId === id) throw new ConflictException('You cannot remove your own role management right');
    await this.db.$transaction(async tx => {
      await tx.role.update({ where: { id }, data: { name: input.name } });
      if (codes) {
        const permissions = await tx.permission.findMany({ where: { code: { in: codes } }, select: { id: true } });
        await tx.rolePermission.deleteMany({ where: { roleId: id } });
        if (permissions.length) await tx.rolePermission.createMany({ data: permissions.map(permission => ({ roleId: id, permissionId: permission.id })) });
      }
      await tx.auditLog.create({ data: { userId: actor.userId, action: 'ROLE_UPDATED', entityType: 'Role', entityId: id, newValue: { name: input.name, permissions: codes } } });
    });
    return this.db.role.findUniqueOrThrow({ where: { id }, select: rolePublic });
  }
}
