import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AccessGuard, RequirePermission, StoreScopeGuard } from '../auth/guards';
import type { AccessContext } from '../auth/policy';
import { InvoiceImportService } from './invoice-import.service';
import { invoiceMatchSchema, invoiceSchema } from './invoice-import';
import { PurchasesService } from './purchases.service';
import { listSchema, priceHistorySchema, parseInput, purchasePatchSchema, purchaseSchema, receivingSchema, supplierPatchSchema, supplierSchema } from './purchases.schemas';

type AuthorizedRequest = Request & { access: AccessContext };

@ApiTags('suppliers')
@ApiBearerAuth()
@UseGuards(AccessGuard)
@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly service: PurchasesService) {}
  @Get() @RequirePermission('suppliers.view') list(@Query() query: unknown) { return this.service.suppliers(parseInput(listSchema, query)); }
  @Get(':id') @RequirePermission('suppliers.view') get(@Param('id', ParseUUIDPipe) id: string) { return this.service.supplier(id); }
  @Post() @RequirePermission('suppliers.create') create(@Body() body: unknown, @Req() req: AuthorizedRequest) { return this.service.createSupplier(parseInput(supplierSchema, body), req.access.userId); }
  @Patch(':id') @RequirePermission('suppliers.edit') update(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: AuthorizedRequest) { return this.service.updateSupplier(id, parseInput(supplierPatchSchema, body), req.access.userId); }
  @Delete(':id') @RequirePermission('suppliers.delete') delete(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthorizedRequest) { return this.service.deleteSupplier(id, req.access.userId); }
}

@ApiTags('purchases')
@ApiBearerAuth()
@UseGuards(AccessGuard, StoreScopeGuard)
@Controller('stores/:storeId/purchases')
export class PurchasesController {
  constructor(private readonly service: PurchasesService, private readonly invoices: InvoiceImportService) {}
  @Get('price-history') @RequirePermission('purchases.view') priceHistory(@Param('storeId', ParseUUIDPipe) storeId: string, @Query() query: unknown) { return this.service.priceHistory(storeId, parseInput(priceHistorySchema, query)); }
  @Post('import/match') @RequirePermission('purchases.create') matchInvoice(@Body() body: unknown) { return this.invoices.match(parseInput(invoiceMatchSchema, body).rows); }
  @Post('import/preview') @RequirePermission('purchases.create') previewInvoice(@Body() body: unknown) { return this.invoices.preview(parseInput(invoiceSchema, body)); }
  @Post('import/confirm') @RequirePermission('purchases.create') confirmInvoice(@Param('storeId', ParseUUIDPipe) storeId: string, @Body() body: unknown, @Req() req: AuthorizedRequest) { return this.invoices.confirm(storeId, parseInput(invoiceSchema, body), req.access.userId); }
  @Get() @RequirePermission('purchases.view') list(@Param('storeId', ParseUUIDPipe) storeId: string, @Query() query: unknown) { return this.service.purchases(storeId, parseInput(listSchema, query)); }
  @Get(':id') @RequirePermission('purchases.view') get(@Param('storeId', ParseUUIDPipe) storeId: string, @Param('id', ParseUUIDPipe) id: string) { return this.service.purchase(storeId, id); }
  @Post() @RequirePermission('purchases.create') create(@Param('storeId', ParseUUIDPipe) storeId: string, @Body() body: unknown, @Req() req: AuthorizedRequest) { return this.service.createPurchase(storeId, parseInput(purchaseSchema, body), req.access.userId); }
  @Patch(':id') @RequirePermission('purchases.edit') update(@Param('storeId', ParseUUIDPipe) storeId: string, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: AuthorizedRequest) { return this.service.updatePurchase(storeId, id, parseInput(purchasePatchSchema, body), req.access.userId); }
  @Post(':id/submit') @RequirePermission('purchases.submit') submit(@Param('storeId', ParseUUIDPipe) storeId: string, @Param('id', ParseUUIDPipe) id: string, @Req() req: AuthorizedRequest) { return this.service.transition(storeId, id, 'ORDERED', req.access.userId); }
  @Post(':id/cancel') @RequirePermission('purchases.cancel') cancel(@Param('storeId', ParseUUIDPipe) storeId: string, @Param('id', ParseUUIDPipe) id: string, @Req() req: AuthorizedRequest) { return this.service.transition(storeId, id, 'CANCELLED', req.access.userId); }
  @Post(':id/receivings') @RequirePermission('purchases.receive') receive(@Param('storeId', ParseUUIDPipe) storeId: string, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: AuthorizedRequest) { return this.service.receive(storeId, id, parseInput(receivingSchema, body), req.access.userId); }
}
