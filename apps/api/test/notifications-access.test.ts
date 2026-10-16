import assert from 'node:assert/strict';
import test from 'node:test';
import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import type { Reflector } from '@nestjs/core';
import { AccessGuard } from '../src/auth/guards';
import type { AuthService } from '../src/auth/auth.service';
import type { AccessContext } from '../src/auth/policy';

function guardFor(permissions: string[]) {
  const request = { headers: { authorization: 'Bearer test' } };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
  const jwt = { verifyAsync: async () => ({ sub: 'user-1', typ: 'access' }) } as unknown as JwtService;
  const auth = { context: async () => ({ userId: 'user-1', permissions, allStores: false, storeIds: ['store-1'] } satisfies AccessContext) } as unknown as AuthService;
  const reflector = { getAllAndOverride: (key: string) => key === 'anyPermission' ? ['inventory.view', 'sales.view'] : undefined } as unknown as Reflector;
  return { guard: new AccessGuard(jwt, auth, reflector), context };
}

test('notification center permits sales or inventory viewers and rejects unrelated roles', async () => {
  for (const permission of ['sales.view', 'inventory.view']) {
    const { guard, context } = guardFor([permission]);
    assert.equal(await guard.canActivate(context), true);
  }
  const { guard, context } = guardFor(['products.view']);
  await assert.rejects(guard.canActivate(context), ForbiddenException);
});
