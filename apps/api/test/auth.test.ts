import assert from 'node:assert/strict';
import test from 'node:test';
import { hash } from 'argon2';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from '../src/auth/auth.service';
import type { DatabaseService } from '../src/database.service';
import type { JwtService } from '@nestjs/jwt';

test('login verifies Argon2 password and issues tokens', async () => {
  const created: unknown[] = [];
  const db = {
    user: { findUnique: async () => ({ id: 'user-1', active: true, passwordHash: await hash('valid-password') }) },
    refreshToken: { create: async (input: unknown) => { created.push(input); } },
    auditLog: { create: async () => undefined },
  } as unknown as DatabaseService;
  const jwt = { signAsync: async () => 'access-token' } as unknown as JwtService;
  const service = new AuthService(db, jwt);
  await assert.rejects(service.login('owner', 'wrong-password'), UnauthorizedException);
  const result = await service.login('owner', 'valid-password', 'device-1');
  assert.equal(result.accessToken, 'access-token');
  assert.ok(result.refreshToken.length > 40);
  assert.equal(created.length, 1);
});

test('refresh rotates the token and rejects replay', async () => {
  const loginRows: Array<{ data: { tokenHash: string; revokedAt?: Date; userId: string; deviceId?: string } }> = [];
  const user = { id: 'user-1', active: true, passwordHash: await hash('valid-password') };
  const db = {
    user: { findUnique: async () => user },
    refreshToken: {
      create: async (row: { data: { tokenHash: string; userId: string; deviceId?: string } }) => { loginRows.push(row); },
      findUnique: async ({ where }: { where: { tokenHash: string } }) => {
        const row = loginRows.find((item) => item.data.tokenHash === where.tokenHash);
        return row ? { id: 'token-1', userId: row.data.userId, deviceId: row.data.deviceId ?? null, revokedAt: row.data.revokedAt ?? null, expiresAt: new Date(Date.now() + 60_000), user } : null;
      },
    },
    auditLog: { create: async () => undefined },
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({
      refreshToken: {
        updateMany: async () => {
          if (loginRows[0]?.data.revokedAt) return { count: 0 };
          loginRows[0]!.data.revokedAt = new Date();
          return { count: 1 };
        },
        create: async (row: { data: { tokenHash: string; userId: string; deviceId?: string } }) => { loginRows.push(row); },
      },
      auditLog: { create: async () => undefined },
    }),
  } as unknown as DatabaseService;
  const service = new AuthService(db, { signAsync: async () => 'access-token' } as unknown as JwtService);
  const initial = await service.login('owner', 'valid-password', 'device-1');
  const rotated = await service.refresh(initial.refreshToken, 'device-1');
  assert.notEqual(rotated.refreshToken, initial.refreshToken);
  await assert.rejects(service.refresh(initial.refreshToken, 'device-1'), UnauthorizedException);
});
