import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AccessGuard, RequireAnyPermission, RequirePermission, StoreScopeGuard } from '../auth/guards';
import type { AccessContext } from '../auth/policy';
import { FinanceService } from './finance.service';
import { cashOperationSchema, categorySchema, closeShiftSchema, expenseSchema, openShiftSchema, pageSchema, parseInput, reportScopeSchema, summarySchema, supplierPaymentSchema } from './finance.schemas';

type AuthorizedRequest = Request & { access: AccessContext };

@ApiTags('finance') @ApiBearerAuth() @UseGuards(AccessGuard) @Controller('expense-categories')
export class ExpenseCategoriesController {
  constructor(private readonly service: FinanceService) {}
  @Get() @RequirePermission('finance.view') list() { return this.service.categories(); }
  @Post() @RequirePermission('finance.edit') create(@Body() body: unknown, @Req() req: AuthorizedRequest) { return this.service.createCategory(parseInput(categorySchema, body), req.access.userId); }
  @Patch(':id') @RequirePermission('finance.edit') edit(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: AuthorizedRequest) { return this.service.editCategory(id, parseInput(categorySchema, body), req.access.userId); }
  @Delete(':id') @RequirePermission('finance.edit') delete(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthorizedRequest) { return this.service.deleteCategory(id, req.access.userId); }
}

@ApiTags('finance') @ApiBearerAuth() @UseGuards(AccessGuard) @Controller('finance')
export class FinanceSummaryController {
  constructor(private readonly service: FinanceService) {}
  @Get('stores') @RequireAnyPermission('finance.view', 'finance.cash_view') stores(@Req() req: AuthorizedRequest, @Query() query: unknown) { return this.service.stores(req.access, parseInput(reportScopeSchema, query).scope); }
  @Get('summary') @RequirePermission('finance.view') summary(@Query() query: unknown, @Req() req: AuthorizedRequest) { return this.service.summary(parseInput(summarySchema, query), req.access); }
  @Get('sales-trend') @RequirePermission('finance.view') salesTrend(@Query() query: unknown, @Req() req: AuthorizedRequest) { return this.service.salesTrend(parseInput(summarySchema, query), req.access); }
  @Get('top-products') @RequirePermission('finance.view') topProducts(@Query() query: unknown, @Req() req: AuthorizedRequest) { return this.service.topProducts(parseInput(summarySchema, query), req.access); }
}

@ApiTags('finance') @ApiBearerAuth() @UseGuards(AccessGuard, StoreScopeGuard) @Controller('stores/:storeId/finance')
export class StoreFinanceController {
  constructor(private readonly service: FinanceService) {}
  @Get('expenses') @RequirePermission('finance.view') expenses(@Param('storeId', ParseUUIDPipe) storeId: string, @Query() query: unknown) { return this.service.expenses(storeId, parseInput(pageSchema, query)); }
  @Post('expenses') @RequirePermission('finance.edit') expense(@Param('storeId', ParseUUIDPipe) storeId: string, @Body() body: unknown, @Req() req: AuthorizedRequest) { return this.service.createExpense(storeId, parseInput(expenseSchema, body), req.access.userId); }
  @Get('cash-shifts') @RequirePermission('finance.cash_view') shifts(@Param('storeId', ParseUUIDPipe) storeId: string, @Query() query: unknown) { return this.service.shifts(storeId, parseInput(pageSchema, query)); }
  @Post('cash-shifts') @RequirePermission('finance.cash') openShift(@Param('storeId', ParseUUIDPipe) storeId: string, @Body() body: unknown, @Req() req: AuthorizedRequest) { return this.service.openShift(storeId, parseInput(openShiftSchema, body), req.access.userId); }
  @Post('cash-shifts/:id/close') @RequirePermission('finance.cash') closeShift(@Param('storeId', ParseUUIDPipe) storeId: string, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: AuthorizedRequest) { return this.service.closeShift(storeId, id, parseInput(closeShiftSchema, body), req.access.userId); }
  @Get('cash-shifts/:id/operations') @RequirePermission('finance.cash_view') operations(@Param('storeId', ParseUUIDPipe) storeId: string, @Param('id', ParseUUIDPipe) id: string, @Query() query: unknown) { return this.service.operations(storeId, id, parseInput(pageSchema, query)); }
  @Post('cash-shifts/:id/operations') @RequirePermission('finance.cash') operation(@Param('storeId', ParseUUIDPipe) storeId: string, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: AuthorizedRequest) { return this.service.createCashOperation(storeId, id, parseInput(cashOperationSchema, body), req.access.userId); }
  @Get('supplier-payments') @RequirePermission('finance.view') payments(@Param('storeId', ParseUUIDPipe) storeId: string, @Query() query: unknown) { return this.service.supplierPayments(storeId, parseInput(pageSchema, query)); }
  @Post('supplier-payments') @RequirePermission('finance.supplier_pay') pay(@Param('storeId', ParseUUIDPipe) storeId: string, @Body() body: unknown, @Req() req: AuthorizedRequest) { return this.service.paySupplier(storeId, parseInput(supplierPaymentSchema, body), req.access.userId); }
}
