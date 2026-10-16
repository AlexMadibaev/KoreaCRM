import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AccessGuard, RequirePermission, StoreScopeGuard } from '../auth/guards';
import type { AccessContext } from '../auth/policy';
import { InventoryService } from './inventory.service';
import { completeSchema, countSchema, listSchema, parseInput, scanSchema } from './inventory.schemas';

type AuthorizedRequest = Request & { access: AccessContext };

@ApiTags('inventory')
@ApiBearerAuth()
@UseGuards(AccessGuard, StoreScopeGuard)
@Controller('stores/:storeId/inventories')
export class InventoryController {
  constructor(private readonly service: InventoryService) {}
  @Get() @RequirePermission('inventory.view') list(@Param('storeId', ParseUUIDPipe) storeId: string, @Query() query: unknown) { return this.service.list(storeId, parseInput(listSchema, query)); }
  @Get(':id') @RequirePermission('inventory.view') get(@Param('storeId', ParseUUIDPipe) storeId: string, @Param('id', ParseUUIDPipe) id: string) { return this.service.get(storeId, id); }
  @Post() @RequirePermission('inventory.start') create(@Param('storeId', ParseUUIDPipe) storeId: string, @Req() req: AuthorizedRequest) { return this.service.create(storeId, req.access.userId); }
  @Post(':id/start') @RequirePermission('inventory.start') start(@Param('storeId', ParseUUIDPipe) storeId: string, @Param('id', ParseUUIDPipe) id: string, @Req() req: AuthorizedRequest) { return this.service.start(storeId, id, req.access.userId); }
  @Put(':id/items') @RequirePermission('inventory.count') count(@Param('storeId', ParseUUIDPipe) storeId: string, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: AuthorizedRequest) { return this.service.count(storeId, id, parseInput(countSchema, body), req.access.userId); }
  @Post(':id/scan') @RequirePermission('inventory.count') scan(@Param('storeId', ParseUUIDPipe) storeId: string, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: AuthorizedRequest) { return this.service.scan(storeId, id, parseInput(scanSchema, body), req.access.userId); }
  @Post(':id/complete') @RequirePermission('inventory.complete') complete(@Param('storeId', ParseUUIDPipe) storeId: string, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: AuthorizedRequest) { parseInput(completeSchema, body); return this.service.complete(storeId, id, req.access.userId); }
  @Post(':id/cancel') @RequirePermission('inventory.cancel') cancel(@Param('storeId', ParseUUIDPipe) storeId: string, @Param('id', ParseUUIDPipe) id: string, @Req() req: AuthorizedRequest) { return this.service.cancel(storeId, id, req.access.userId); }
}
