import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AccessGuard, RequirePermission } from '../auth/guards';
import type { AccessContext } from '../auth/policy';
import { parseInput } from '../finance/finance.schemas';
import { reportQuerySchema } from './reports.schemas';
import { ReportsService } from './reports.service';

type AuthorizedRequest = Request & { access: AccessContext };

@ApiTags('reports') @ApiBearerAuth() @UseGuards(AccessGuard) @Controller('reports')
export class ReportsController {
  constructor(private readonly service: ReportsService) {}
  @Get() @RequirePermission('reports.view') catalog(@Req() req: AuthorizedRequest) { return this.service.catalog(req.access); }
  @Get(':key') @RequirePermission('reports.view') run(@Param('key') key: string, @Query() query: unknown, @Req() req: AuthorizedRequest) { return this.service.run(key, parseInput(reportQuerySchema, query), req.access); }
}
