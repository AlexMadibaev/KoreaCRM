import { Body, Controller, Delete, ForbiddenException, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AccessGuard, RequireAnyPermission, RequirePermission, StoreScopeGuard } from '../auth/guards';
import type { AccessContext } from '../auth/policy';
import { FinanceService } from './finance.service';
import { expenseQuerySchema, expenseUpdateSchema } from './finance.schemas';
import { cashOperationSchema, categorySchema, closeShiftSchema, expenseSchema, lastClosedShiftSchema, openShiftSchema, shiftQuerySchema, pageSchema, parseInput, reportScopeSchema, summarySchema, supplierPaymentSchema } from './finance.schemas';

type AuthorizedRequest = Request & { access: AccessContext };

function canManageExpenseStatus(access: AccessContext) {
  return access.role === 'OWNER' || access.login === 'Boss';
}

function expenseResponse<T extends { paymentStatus: string }>(expense: T, showStatus: boolean) {
  if (showStatus) return expense;
  const visible: Omit<T, 'paymentStatus'> & { paymentStatus?: string } = { ...expense };
  delete visible.paymentStatus;
  return visible;
}

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
  @Get('top-customers') @RequirePermission('finance.view') topCustomers(@Query() query: unknown, @Req() req: AuthorizedRequest) { return this.service.topCustomers(parseInput(summarySchema, query), req.access); }
}

@ApiTags('finance') @ApiBearerAuth() @UseGuards(AccessGuard, StoreScopeGuard) @Controller('stores/:storeId/finance')
export class StoreFinanceController {
  constructor(private readonly service: FinanceService) {}
  @Get('expenses') @RequirePermission('finance.view')
  async expenses(@Param('storeId', ParseUUIDPipe) storeId: string, @Query() query: unknown, @Req() req: AuthorizedRequest) {
    const input = parseInput(expenseQuerySchema, query);
    const canManagePaymentStatus = canManageExpenseStatus(req.access);
    if (input.paymentStatus && !canManagePaymentStatus) throw new ForbiddenException();
    const page = await this.service.expenses(storeId, input);
    return { ...page, canManagePaymentStatus, items: page.items.map(item => expenseResponse(item, canManagePaymentStatus)) };
  }

  @Post('expenses') @RequirePermission('finance.edit')
  async expense(@Param('storeId', ParseUUIDPipe) storeId: string, @Body() body: unknown, @Req() req: AuthorizedRequest) {
    const input = parseInput(expenseSchema, body);
    const showStatus = canManageExpenseStatus(req.access);
    if (input.paymentStatus && !showStatus) throw new ForbiddenException();
    return expenseResponse(await this.service.createExpense(storeId, input, req.access.userId), showStatus);
  }

  @Patch('expenses/:id') @RequireAnyPermission('finance.view', 'finance.edit')
  async updateExpense(@Param('storeId', ParseUUIDPipe) storeId: string, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: AuthorizedRequest) {
    const input = parseInput(expenseUpdateSchema, body);
    const showStatus = canManageExpenseStatus(req.access);
    if (input.paymentStatus && !showStatus) throw new ForbiddenException();
    if (Object.keys(input).some(key => key !== 'paymentStatus') && !req.access.permissions.includes('finance.edit')) throw new ForbiddenException();
    return expenseResponse(await this.service.updateExpense(storeId, id, input, req.access.userId), showStatus);
  }

  @Delete('expenses/:id') @RequirePermission('finance.edit')
  deleteExpense(@Param('storeId', ParseUUIDPipe) storeId: string, @Param('id', ParseUUIDPipe) id: string, @Req() req: AuthorizedRequest) {
    return this.service.deleteExpense(storeId, id, req.access.userId);
  }
  @Get('cash-shifts') @RequirePermission('finance.cash_view') shifts(@Param('storeId', ParseUUIDPipe) storeId: string, @Query() query: unknown) { return this.service.shifts(storeId, parseInput(shiftQuerySchema, query)); }
  @Get('cash-shifts/last-closed') @RequirePermission('finance.cash_view') lastClosed(@Param('storeId', ParseUUIDPipe) storeId: string, @Query() query: unknown) { return this.service.lastClosedShift(storeId, parseInput(lastClosedShiftSchema, query).deviceId); }
  @Get('cash-shifts/:id/report') @RequirePermission('finance.cash_view') report(@Param('storeId', ParseUUIDPipe) storeId: string, @Param('id', ParseUUIDPipe) id: string) { return this.service.shiftReport(storeId, id); }
  @Post('cash-shifts') @RequirePermission('finance.cash') openShift(@Param('storeId', ParseUUIDPipe) storeId: string, @Body() body: unknown, @Req() req: AuthorizedRequest) { return this.service.openShift(storeId, parseInput(openShiftSchema, body), req.access.userId); }
  @Post('cash-shifts/:id/close') @RequirePermission('finance.cash') closeShift(@Param('storeId', ParseUUIDPipe) storeId: string, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: AuthorizedRequest) { return this.service.closeShift(storeId, id, parseInput(closeShiftSchema, body), req.access.userId); }
  @Get('cash-shifts/:id/operations') @RequirePermission('finance.cash_view') operations(@Param('storeId', ParseUUIDPipe) storeId: string, @Param('id', ParseUUIDPipe) id: string, @Query() query: unknown) { return this.service.operations(storeId, id, parseInput(pageSchema, query)); }
  @Post('cash-shifts/:id/operations') @RequirePermission('finance.cash') operation(@Param('storeId', ParseUUIDPipe) storeId: string, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: AuthorizedRequest) { return this.service.createCashOperation(storeId, id, parseInput(cashOperationSchema, body), req.access.userId); }
  @Get('supplier-payments') @RequirePermission('finance.view') payments(@Param('storeId', ParseUUIDPipe) storeId: string, @Query() query: unknown) { return this.service.supplierPayments(storeId, parseInput(pageSchema, query)); }
  @Post('supplier-payments') @RequirePermission('finance.supplier_pay') pay(@Param('storeId', ParseUUIDPipe) storeId: string, @Body() body: unknown, @Req() req: AuthorizedRequest) { return this.service.paySupplier(storeId, parseInput(supplierPaymentSchema, body), req.access.userId); }
}
