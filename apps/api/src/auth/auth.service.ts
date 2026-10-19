import { createHash, randomBytes } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { verify } from 'argon2';
import { DatabaseService } from '../database.service';
import type { AccessContext } from './policy';
import { hashPosCode, validPosCode } from './pos-code';

const refreshLifetimeMs = 30 * 24 * 60 * 60 * 1000;
const userInclude = {
  role: { include: { permissions: { include: { permission: true } } } },
  stores: true,
} as const;

function tokenHash(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class AuthService {
  private readonly scanAttempts = new Map<string, { count: number; until: number }>();
  constructor(private readonly db: DatabaseService, private readonly jwt: JwtService) {}

  private async issue(userId: string, deviceId?: string) {
    const refreshToken = randomBytes(48).toString('base64url');
    await this.db.refreshToken.create({
      data: {
        userId,
        tokenHash: tokenHash(refreshToken),
        deviceId,
        expiresAt: new Date(Date.now() + refreshLifetimeMs),
      },
    });
    return {
      accessToken: await this.jwt.signAsync({ sub: userId, typ: 'access' }, { expiresIn: '15m' }),
      refreshToken,
    };
  }

  async login(login: string, password: string, deviceId?: string) {
    const user = await this.db.user.findUnique({ where: { login } });
    if (!user?.active || !(await verify(user.passwordHash, password))) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const tokens = await this.issue(user.id, deviceId);
    await this.db.auditLog.create({ data: { userId: user.id, action: 'LOGIN', entityType: 'User', entityId: user.id, deviceId } });
    return tokens;
  }

  async loginWithPosCode(code: string, deviceId: string, ip: string) {
    const now = Date.now();
    const key = ip || 'unknown';
    const limit = this.scanAttempts.get(key);
    if (limit && limit.until > now && limit.count >= 30) throw new UnauthorizedException('Too many login attempts');
    if (!limit || limit.until <= now) this.scanAttempts.set(key, { count: 1, until: now + 15 * 60_000 });
    else limit.count += 1;
    if (!validPosCode(code)) throw new UnauthorizedException('Invalid scan code');
    const hashed = hashPosCode(code);
    const user = await this.db.user.findFirst({
      where: { OR: [{ posQrHash: hashed }, { posEanHash: hashed }] },
      include: { role: { include: { permissions: { include: { permission: true } } } } },
    });
    if (!user?.active || !user.role.permissions.some(item => item.permission.code === 'sales.create')) throw new UnauthorizedException('Invalid scan code');
    const tokens = await this.issue(user.id, deviceId);
    await this.db.auditLog.create({ data: { userId: user.id, action: 'POS_SCAN_LOGIN', entityType: 'User', entityId: user.id, deviceId } });
    this.scanAttempts.delete(key);
    return { ...tokens, login: user.login };
  }

  async refresh(refreshToken: string, deviceId?: string) {
    const hashed = tokenHash(refreshToken);
    const existing = await this.db.refreshToken.findUnique({ where: { tokenHash: hashed }, include: { user: true } });
    if (!existing || existing.revokedAt || existing.expiresAt <= new Date() || !existing.user.active || existing.deviceId !== (deviceId ?? null)) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    const replacement = randomBytes(48).toString('base64url');
    const result = await this.db.$transaction(async (tx) => {
      const revoked = await tx.refreshToken.updateMany({ where: { id: existing.id, revokedAt: null, expiresAt: { gt: new Date() } }, data: { revokedAt: new Date() } });
      if (revoked.count !== 1) throw new UnauthorizedException('Refresh token already used');
      await tx.refreshToken.create({ data: { userId: existing.userId, tokenHash: tokenHash(replacement), deviceId, expiresAt: new Date(Date.now() + refreshLifetimeMs) } });
      await tx.auditLog.create({ data: { userId: existing.userId, action: 'TOKEN_REFRESHED', entityType: 'RefreshToken', entityId: existing.id, deviceId } });
      return replacement;
    });
    return { accessToken: await this.jwt.signAsync({ sub: existing.userId, typ: 'access' }, { expiresIn: '15m' }), refreshToken: result };
  }

  async logout(refreshToken: string) {
    const hashed = tokenHash(refreshToken);
    const token = await this.db.refreshToken.findUnique({ where: { tokenHash: hashed } });
    if (token && !token.revokedAt) {
      await this.db.$transaction([
        this.db.refreshToken.update({ where: { id: token.id }, data: { revokedAt: new Date() } }),
        this.db.auditLog.create({ data: { userId: token.userId, action: 'LOGOUT', entityType: 'RefreshToken', entityId: token.id, deviceId: token.deviceId } }),
      ]);
    }
    return { success: true };
  }

  async context(userId: string): Promise<AccessContext & { login: string; name: string; role: string }> {
    const user = await this.db.user.findUnique({ where: { id: userId }, include: userInclude });
    if (!user?.active) throw new UnauthorizedException();
    return {
      userId: user.id,
      login: user.login,
      name: user.name,
      role: user.role.code,
      permissions: user.role.permissions.map((item) => item.permission.code),
      allStores: user.allStores,
      storeIds: user.stores.map((item) => item.storeId),
    };
  }

}
