import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { z } from 'zod';
import { DatabaseService } from '../database.service';
import { registerDeviceSchema, statusSchema } from './pos-devices.schemas';

@Injectable()
export class PosDevicesService {
  constructor(private readonly db: DatabaseService) {}
  async list(storeId: string) { return this.db.posDevice.findMany({ where: { storeId }, orderBy: { createdAt: 'desc' } }); }
  async register(storeId: string, input: z.infer<typeof registerDeviceSchema>, actorId: string) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try { return await this.db.$transaction(async tx => {
        if (!await tx.store.findFirst({ where: { id: storeId, deletedAt: null } })) throw new NotFoundException('Store not found');
        const existing = await tx.posDevice.findUnique({ where: { deviceId: input.deviceId } });
        if (existing?.storeId !== undefined && existing.storeId !== storeId) throw new ConflictException('Device is assigned to another store');
        if (existing?.status === 'DISABLED') throw new ConflictException('Device is disabled');
        const device = existing ? await tx.posDevice.update({ where: { deviceId: input.deviceId }, data: { appVersion: input.appVersion, lastActivityAt: new Date() } }) : await tx.posDevice.create({ data: { ...input, storeId } });
        if (!existing) await tx.auditLog.create({ data: { userId: actorId, action: 'POS_DEVICE_REGISTERED', entityType: 'PosDevice', entityId: device.deviceId, newValue: { storeId, appVersion: input.appVersion } } });
        return device;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); }
      catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code) && attempt < 2) continue; throw error; }
    }
    throw new ConflictException('Device registration could not be completed');
  }
  async setStatus(storeId: string, deviceId: string, input: z.infer<typeof statusSchema>, actorId: string) {
    const existing = await this.db.posDevice.findFirst({ where: { storeId, deviceId } });
    if (!existing) throw new NotFoundException('Device not found');
    return this.db.$transaction(async tx => {
      const device = await tx.posDevice.update({ where: { deviceId }, data: { status: input.status } });
      await tx.auditLog.create({ data: { userId: actorId, action: 'POS_DEVICE_STATUS_CHANGED', entityType: 'PosDevice', entityId: deviceId, oldValue: { status: existing.status }, newValue: { status: input.status } } });
      return device;
    });
  }
}
