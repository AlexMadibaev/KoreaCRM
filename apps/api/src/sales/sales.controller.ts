import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AccessGuard, RequirePermission, StoreScopeGuard } from '../auth/guards';
import type { AccessContext } from '../auth/policy';
import { SalesService } from './sales.service';
import { parseInput, paymentMethodPatchSchema, paymentMethodSchema, returnSaleSchema, saleListSchema, saleReturnListSchema, saleSchema } from './sales.schemas';
type AuthorizedRequest = Request & { access: AccessContext };

@ApiTags('sales') @ApiBearerAuth() @UseGuards(AccessGuard, StoreScopeGuard) @Controller('stores/:storeId/sales')
export class SalesController {
  constructor(private readonly service: SalesService) {}
  @Get() @RequirePermission('sales.view') list(@Param('storeId', ParseUUIDPipe) storeId: string, @Query() query: unknown) { return this.service.list(storeId, parseInput(saleListSchema, query)); }
  @Get('returns') @RequirePermission('sales.view') returns(@Param('storeId', ParseUUIDPipe) storeId: string, @Query() query: unknown) { return this.service.listReturns(storeId, parseInput(saleReturnListSchema, query)); }
  @Get(':id') @RequirePermission('sales.view') get(@Param('storeId', ParseUUIDPipe) storeId: string, @Param('id', ParseUUIDPipe) id: string) { return this.service.get(storeId, id); }
  @Post(':id/return') @RequirePermission('sales.return') returnSale(@Param('storeId', ParseUUIDPipe) storeId: string, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: AuthorizedRequest) { return this.service.returnSale(storeId, id, parseInput(returnSaleSchema, body), req.access.userId); }
  @Post('sync') @RequirePermission('sales.create') sync(@Param('storeId', ParseUUIDPipe) storeId: string, @Body() body: unknown, @Req() req: AuthorizedRequest) { return this.service.create(storeId, parseInput(saleSchema, body), req.access.userId, true); }
  @Post() @RequirePermission('sales.create') create(@Param('storeId', ParseUUIDPipe) storeId: string, @Body() body: unknown, @Req() req: AuthorizedRequest) { return this.service.create(storeId, parseInput(saleSchema, body), req.access.userId); }
}

@ApiTags('sales') @ApiBearerAuth() @UseGuards(AccessGuard) @Controller('sale-payment-methods')
export class SalePaymentMethodsController {
  constructor(private readonly service: SalesService) {}
  @Get() @RequirePermission('sales.view') list() { return this.service.methods(); }
  @Post() @RequirePermission('settings.edit') create(@Body() body: unknown, @Req() req: AuthorizedRequest) { return this.service.createMethod(parseInput(paymentMethodSchema, body), req.access.userId); }
  @Patch(':id') @RequirePermission('settings.edit') edit(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: AuthorizedRequest) { return this.service.editMethod(id, parseInput(paymentMethodPatchSchema, body), req.access.userId); }
}
