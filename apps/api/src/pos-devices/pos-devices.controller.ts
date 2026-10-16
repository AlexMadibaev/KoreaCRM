import { Body, Controller, ForbiddenException, Get, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AccessGuard, RequirePermission, StoreScopeGuard } from '../auth/guards';
import type { AccessContext } from '../auth/policy';
import { hasPermission } from '../auth/policy';
import { PosDevicesService } from './pos-devices.service';
import { parseInput, registerDeviceSchema, statusSchema } from './pos-devices.schemas';
type AuthorizedRequest = Request & { access: AccessContext };

@ApiTags('pos-devices') @ApiBearerAuth() @UseGuards(AccessGuard, StoreScopeGuard) @Controller('stores/:storeId/pos-devices')
export class PosDevicesController {
  constructor(private readonly service: PosDevicesService) {}
  @Get() @RequirePermission('sales.view') list(@Param('storeId', ParseUUIDPipe) storeId: string) { return this.service.list(storeId); }
  @Post() register(@Param('storeId', ParseUUIDPipe) storeId: string, @Body() body: unknown, @Req() req: AuthorizedRequest) {
    if (!hasPermission(req.access, 'sales.create') && !hasPermission(req.access, 'sales.return')) throw new ForbiddenException();
    return this.service.register(storeId, parseInput(registerDeviceSchema, body), req.access.userId);
  }
  @Patch(':deviceId/status') @RequirePermission('settings.edit') setStatus(@Param('storeId', ParseUUIDPipe) storeId: string, @Param('deviceId') deviceId: string, @Body() body: unknown, @Req() req: AuthorizedRequest) { return this.service.setStatus(storeId, deviceId, parseInput(statusSchema, body), req.access.userId); }
}
