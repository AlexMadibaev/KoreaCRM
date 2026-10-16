import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { canAccessStore, hasPermission, type AccessContext } from './policy';

const permissionKey = 'permission';
export const RequirePermission = (permission: string) => SetMetadata(permissionKey, permission);
const anyPermissionKey = 'anyPermission';
export const RequireAnyPermission = (...permissions: string[]) => SetMetadata(anyPermissionKey, permissions);

@Injectable()
export class AccessGuard implements CanActivate {
  constructor(private readonly jwt: JwtService, private readonly auth: AuthService, private readonly reflector: Reflector) {}

  async canActivate(executionContext: ExecutionContext): Promise<boolean> {
    const request = executionContext.switchToHttp().getRequest<Request & { access?: AccessContext }>();
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException();
    let payload: { sub?: string; typ?: string };
    try {
      payload = await this.jwt.verifyAsync(header.slice(7));
    } catch {
      throw new UnauthorizedException();
    }
    if (!payload.sub || payload.typ !== 'access') throw new UnauthorizedException();
    const access = await this.auth.context(payload.sub);
    const permission = this.reflector.getAllAndOverride<string>(permissionKey, [executionContext.getHandler(), executionContext.getClass()]);
    if (permission && !hasPermission(access, permission)) throw new ForbiddenException();
    const anyPermissions = this.reflector.getAllAndOverride<string[]>(anyPermissionKey, [executionContext.getHandler(), executionContext.getClass()]);
    if (anyPermissions?.length && !anyPermissions.some(candidate => hasPermission(access, candidate))) throw new ForbiddenException();
    request.access = access;
    return true;
  }
}

@Injectable()
export class StoreScopeGuard implements CanActivate {
  canActivate(executionContext: ExecutionContext): boolean {
    const request = executionContext.switchToHttp().getRequest<Request & { access?: AccessContext; params: { storeId?: string } }>();
    if (!request.access || !request.params.storeId) throw new ForbiddenException();
    if (!canAccessStore(request.access, request.params.storeId)) throw new ForbiddenException();
    return true;
  }
}
