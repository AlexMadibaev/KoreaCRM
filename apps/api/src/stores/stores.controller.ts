import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AccessGuard, RequirePermission } from '../auth/guards';
import type { AccessContext } from '../auth/policy';
import { StoresService } from './stores.service';
import { parseStoreInput, storeCreateSchema, storePatchSchema } from './stores.schemas';

type AuthorizedRequest = Request & { access: AccessContext };

@ApiTags('stores') @ApiBearerAuth() @UseGuards(AccessGuard) @Controller('store-management')
export class StoreManagementController {
  constructor(private readonly stores: StoresService) {}
  @Get() @RequirePermission('stores.view') list(@Req() req: AuthorizedRequest) { return this.stores.list(req.access); }
  @Get(':id') @RequirePermission('stores.view') detail(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthorizedRequest) { return this.stores.detail(id, req.access); }
  @Post() @RequirePermission('stores.create') create(@Body() body: unknown, @Req() req: AuthorizedRequest) { return this.stores.create(parseStoreInput(storeCreateSchema, body), req.access); }
  @Patch(':id') @RequirePermission('stores.edit') update(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: AuthorizedRequest) { return this.stores.update(id, parseStoreInput(storePatchSchema, body), req.access); }
  @Post(':id/team/:userId') @RequirePermission('employees.edit') assignEmployee(@Param('id', ParseUUIDPipe) id: string, @Param('userId', ParseUUIDPipe) userId: string, @Req() req: AuthorizedRequest) { return this.stores.assignEmployee(id, userId, req.access); }
  @Delete(':id/team/:userId') @RequirePermission('employees.edit') unassignEmployee(@Param('id', ParseUUIDPipe) id: string, @Param('userId', ParseUUIDPipe) userId: string, @Req() req: AuthorizedRequest) { return this.stores.unassignEmployee(id, userId, req.access); }
}
