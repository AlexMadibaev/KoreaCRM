import { Controller, Get, Param, ParseUUIDPipe, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AccessGuard, RequirePermission, StoreScopeGuard } from '../auth/guards';
import type { AccessContext } from '../auth/policy';
import { CashShiftsService, shiftJournalQuerySchema } from './cash-shifts.service';
import { parseInput } from './finance.schemas';
import { MoneyService, moneyJournalSchema } from './money.service';

type AuthorizedRequest = Request & { access: AccessContext };

@ApiTags('finance') @ApiBearerAuth() @UseGuards(AccessGuard) @Controller()
export class CashShiftsController {
  constructor(private readonly service: CashShiftsService, private readonly money: MoneyService) {}
  @Get('money') @RequirePermission('finance.view') moneyJournal(@Query() query: unknown, @Req() req: AuthorizedRequest) { return this.money.journal(parseInput(moneyJournalSchema, query), req.access); }
  @Get('registers') @RequirePermission('finance.cash_view') registers(@Req() req: AuthorizedRequest) { return this.service.registers(req.access); }
  @Get('cash-shifts') @RequirePermission('finance.cash_view') journal(@Query() query: unknown, @Req() req: AuthorizedRequest) { return this.service.journal(parseInput(shiftJournalQuerySchema, query), req.access); }
  @Get('stores/:storeId/finance/cash-shifts/:id/activity') @UseGuards(StoreScopeGuard) @RequirePermission('finance.cash_view') activity(@Param('storeId', ParseUUIDPipe) storeId: string, @Param('id', ParseUUIDPipe) id: string, @Req() req: AuthorizedRequest) { return this.service.activity(storeId, id, req.access); }
}
