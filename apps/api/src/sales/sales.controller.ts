import { Body, Controller, ForbiddenException, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AccessGuard, RequirePermission, StoreScopeGuard } from '../auth/guards';
import { canAccessStore, type AccessContext } from '../auth/policy';
import { z } from 'zod';
import { SalesService } from './sales.service';
import { parseInput, paymentMethodPatchSchema, paymentMethodSchema, receiptlessReturnSchema, receiptEditSchema, returnSaleSchema, saleListSchema, saleReturnListSchema, saleSchema } from './sales.schemas';
type AuthorizedRequest = Request & { access: AccessContext };

@ApiTags('sales') @ApiBearerAuth() @UseGuards(AccessGuard, StoreScopeGuard) @Controller('stores/:storeId/sales')
export class SalesController {
  constructor(private readonly service: SalesService) {}
  @Get() @RequirePermission('sales.view') list(@Param('storeId', ParseUUIDPipe) storeId: string, @Query() query: unknown) { return this.service.list(storeId, parseInput(saleListSchema, query)); }
  @Get('returns') @RequirePermission('sales.view') returns(@Param('storeId', ParseUUIDPipe) storeId: string, @Query() query: unknown) { return this.service.listReturns(storeId, parseInput(saleReturnListSchema, query)); }
  @Get(':id') @RequirePermission('sales.view') get(@Param('storeId', ParseUUIDPipe) storeId: string, @Param('id', ParseUUIDPipe) id: string) { return this.service.get(storeId, id); }
  @Get('edit/sellers')
  @RequirePermission('sales.view')
  editSellers(@Param('storeId', ParseUUIDPipe) storeId: string, @Req() req: AuthorizedRequest) {
    if (req.access.role !== 'SUPERUSER' || req.access.posDeviceId) throw new ForbiddenException();
    return this.service.editSellers(storeId);
  }
  @Get(':id/editor')
  @RequirePermission('sales.view')
  receiptEditor(@Param('storeId', ParseUUIDPipe) storeId: string, @Param('id', ParseUUIDPipe) id: string, @Req() req: AuthorizedRequest) {
    if (req.access.role !== 'SUPERUSER' || req.access.posDeviceId) throw new ForbiddenException();
    return this.service.receiptEditor(storeId, id);
  }

  @Patch(':id/editor')
  @RequirePermission('sales.view')
  editReceipt(@Param('storeId', ParseUUIDPipe) storeId: string, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: AuthorizedRequest) {
    if (req.access.role !== 'SUPERUSER' || req.access.posDeviceId) throw new ForbiddenException();
    return this.service.editReceipt(storeId, id, parseInput(receiptEditSchema, body), req.access.userId);
  }
  @Patch(':id/details')
  @RequirePermission('sales.view')
  editDetails(@Param('storeId', ParseUUIDPipe) storeId: string, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: AuthorizedRequest) {
    if (req.access.role !== 'SUPERUSER' || req.access.posDeviceId) throw new ForbiddenException();
    const input = parseInput(z.object({
      sellerId: z.string().uuid().nullable(),
      comment: z.string().trim().max(500),
      reason: z.string().trim().min(5).max(500),
    }), body);
    return this.service.editDetails(storeId, id, input, req.access.userId);
  }
  @Post('returns/no-receipt') @RequirePermission('sales.return_no_receipt') returnWithoutReceipt(@Param('storeId', ParseUUIDPipe) storeId: string, @Body() body: unknown, @Req() req: AuthorizedRequest) { return this.service.returnWithoutReceipt(storeId, parseInput(receiptlessReturnSchema, body), req.access.userId); }
  @Post(':id/return') @RequirePermission('sales.return') returnSale(@Param('storeId', ParseUUIDPipe) storeId: string, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: AuthorizedRequest) { return this.service.returnSale(storeId, id, parseInput(returnSaleSchema, body), req.access.userId); }
  @Post('sync') @RequirePermission('sales.create') sync(@Param('storeId', ParseUUIDPipe) storeId: string, @Body() body: unknown, @Req() req: AuthorizedRequest) { return this.service.create(storeId, parseInput(saleSchema, body), req.access.userId, true, req.access.permissions.includes('sales.discount.unlimited')); }
  @Post() @RequirePermission('sales.create') create(@Param('storeId', ParseUUIDPipe) storeId: string, @Body() body: unknown, @Req() req: AuthorizedRequest) { return this.service.create(storeId, parseInput(saleSchema, body), req.access.userId, false, req.access.permissions.includes('sales.discount.unlimited')); }
  @Get('sellers/list') @RequirePermission('sales.create') sellers(@Param('storeId', ParseUUIDPipe) storeId: string, @Req() req: AuthorizedRequest) { return this.service.sellers(storeId, req.access.userId); }
}

@ApiTags('sales') @ApiBearerAuth() @UseGuards(AccessGuard) @Controller('sale-payment-methods')
export class SalePaymentMethodsController {
  constructor(private readonly service: SalesService) {}
  @Get() @RequirePermission('sales.view') list(@Query() query: unknown, @Req() req: AuthorizedRequest) { const input = parseInput(z.object({ storeId: z.string().uuid().optional() }), query); const storeId = input.storeId ?? (req.access.posDeviceId ? req.access.primaryStoreId ?? undefined : undefined); if (storeId && !canAccessStore(req.access, storeId)) throw new ForbiddenException('Store access denied'); return this.service.methods(storeId); }
  @Post() @RequirePermission('settings.edit') create(@Body() body: unknown, @Req() req: AuthorizedRequest) { return this.service.createMethod(parseInput(paymentMethodSchema, body), req.access.userId); }
  @Patch(':id') @RequirePermission('settings.edit') edit(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: AuthorizedRequest) { return this.service.editMethod(id, parseInput(paymentMethodPatchSchema, body), req.access.userId); }
}
