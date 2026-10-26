import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DatabaseService } from '../database.service';
import { defaultLoyaltySettings, loyaltySettingsSchema, type LoyaltySettings } from './loyalty.rules';

@Injectable()
export class LoyaltyService {
  constructor(private readonly db: DatabaseService) {}
  async get(): Promise<LoyaltySettings> {
    const saved = await this.db.loyaltySettings.findUnique({ where: { id: 1 } });
    return saved ? loyaltySettingsSchema.parse(saved.rules) : defaultLoyaltySettings;
  }
  async save(settings: LoyaltySettings, actorId: string) {
    const previous = await this.get();
    await this.db.$transaction(async tx => {
      await tx.loyaltySettings.upsert({ where: { id: 1 }, update: { rules: settings as Prisma.InputJsonValue }, create: { id: 1, rules: settings as Prisma.InputJsonValue } });
      await tx.auditLog.create({ data: { userId: actorId, action: 'LOYALTY_SETTINGS_UPDATED', entityType: 'LoyaltySettings', entityId: '1', oldValue: previous as Prisma.InputJsonValue, newValue: settings as Prisma.InputJsonValue } });
    });
    return settings;
  }
}
