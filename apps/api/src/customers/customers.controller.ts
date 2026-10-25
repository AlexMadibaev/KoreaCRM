import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AccessGuard, RequirePermission, StoreScopeGuard } from '../auth/guards';
import type { AccessContext } from '../auth/policy';
import { CustomersService } from './customers.service';
import { segmentSettingsSchema } from './customer-segments';
import { activitySchema, bonusCorrectionSchema, bonusListSchema, commentListSchema, commentSchema, createSchema, debtPaymentSchema, historySchema, listSchema, parseInput, patchSchema } from './customers.schemas';

type AuthorizedRequest = Request & { access: AccessContext };

@ApiTags('customers') @ApiBearerAuth() @UseGuards(AccessGuard) @Controller('customers')
export class CustomersController {
  constructor(private readonly service: CustomersService) {}
  @Get() @RequirePermission('customers.view') list(@Query() query: unknown) { return this.service.list(parseInput(listSchema, query)); }
  @Get('segment-settings') @RequirePermission('customers.view') segmentSettings() { return this.service.segmentSettings(); }
  @Patch('segment-settings') @RequirePermission('settings.edit') saveSegmentSettings(@Body() body: unknown, @Req() req: AuthorizedRequest) { return this.service.saveSegmentSettings(parseInput(segmentSettingsSchema, body), req.access.userId); }
  @Get(':id/history') @RequirePermission('customers.view') history(@Param('id', ParseUUIDPipe) id: string, @Query() query: unknown, @Req() req: AuthorizedRequest) { return this.service.history(id, parseInput(historySchema, query), req.access); }
  @Get(':id/comments') @RequirePermission('customers.view') comments(@Param('id', ParseUUIDPipe) id: string, @Query() query: unknown) { return this.service.comments(id, parseInput(commentListSchema, query)); }
  @Get(':id/segments') @RequirePermission('customers.view') segments(@Param('id', ParseUUIDPipe) id: string) { return this.service.segments(id); }
  @Get(':id/bonuses') @RequirePermission('customers.view') bonuses(@Param('id', ParseUUIDPipe) id: string, @Query() query: unknown) { return this.service.bonuses(id, parseInput(bonusListSchema, query)); }
  @Post(':id/bonuses/corrections') @RequirePermission('settings.edit') correctBonus(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: AuthorizedRequest) { return this.service.correctBonus(id, parseInput(bonusCorrectionSchema, body), req.access.userId); }
  @Get(':id/activity') @RequirePermission('customers.view') activity(@Param('id', ParseUUIDPipe) id: string, @Query() query: unknown, @Req() req: AuthorizedRequest) { return this.service.activity(id, parseInput(activitySchema, query), req.access); }
  @Post(':id/comments') @RequirePermission('customers.edit') addComment(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: AuthorizedRequest) { return this.service.addComment(id, parseInput(commentSchema, body), req.access.userId); }
  @Get(':id') @RequirePermission('customers.view') get(@Param('id', ParseUUIDPipe) id: string) { return this.service.get(id); }
  @Post() @RequirePermission('customers.create') create(@Body() body: unknown, @Req() req: AuthorizedRequest) { return this.service.create(parseInput(createSchema, body), req.access.userId); }
  @Patch(':id') @RequirePermission('customers.edit') edit(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: AuthorizedRequest) { return this.service.edit(id, parseInput(patchSchema, body), req.access.userId); }
  @Delete(':id') @RequirePermission('customers.delete') delete(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthorizedRequest) { return this.service.delete(id, req.access.userId); }
}

@ApiTags('customers') @ApiBearerAuth() @UseGuards(AccessGuard, StoreScopeGuard) @Controller('stores/:storeId/customers/:customerId/payments')
export class CustomerPaymentsController {
  constructor(private readonly service: CustomersService) {}
  @Get() @RequirePermission('customers.view') list(@Param('storeId', ParseUUIDPipe) storeId: string, @Param('customerId', ParseUUIDPipe) customerId: string) { return this.service.payments(storeId, customerId); }
  @Post() @RequirePermission('finance.customer_pay') pay(@Param('storeId', ParseUUIDPipe) storeId: string, @Param('customerId', ParseUUIDPipe) customerId: string, @Body() body: unknown, @Req() req: AuthorizedRequest) { return this.service.payDebt(storeId, customerId, parseInput(debtPaymentSchema, body), req.access.userId); }
}
