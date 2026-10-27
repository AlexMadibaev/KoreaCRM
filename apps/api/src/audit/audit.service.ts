import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DatabaseService } from '../database.service';

type Query = { page: number; limit: number; search?: string; from?: string; to?: string };

@Injectable()
export class AuditService {
  constructor(private readonly db: DatabaseService) {}

  async list(query: Query) {
    const where: Prisma.AuditLogWhereInput = {
      createdAt: query.from || query.to ? { gte: query.from ? new Date(`${query.from}T00:00:00.000Z`) : undefined, lt: query.to ? new Date(new Date(`${query.to}T00:00:00.000Z`).getTime() + 86_400_000) : undefined } : undefined,
      OR: query.search ? [
        { action: { contains: query.search, mode: 'insensitive' } },
        { entityType: { contains: query.search, mode: 'insensitive' } },
        { user: { name: { contains: query.search, mode: 'insensitive' } } },
        { user: { login: { contains: query.search, mode: 'insensitive' } } },
      ] : undefined,
    };
    const [items, total] = await this.db.$transaction([
      this.db.auditLog.findMany({ where, select: { id: true, action: true, entityType: true, entityId: true, oldValue: true, newValue: true, ip: true, deviceId: true, createdAt: true, user: { select: { id: true, name: true, login: true } } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (query.page - 1) * query.limit, take: query.limit }),
      this.db.auditLog.count({ where }),
    ]);
    return { items, total, page: query.page, limit: query.limit };
  }
}
