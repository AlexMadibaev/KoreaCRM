import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AccessGuard, RequirePermission } from '../auth/guards';
import type { AccessContext } from '../auth/policy';
import { TransfersService } from './transfers.service';
import { createSchema, editSchema, listSchema, parseInput, receiveSchema } from './transfers.schemas';

type AuthorizedRequest = Request & { access: AccessContext };

@ApiTags('transfers')
@ApiBearerAuth()
@UseGuards(AccessGuard)
@Controller('transfers')
export class TransfersController {
  constructor(private readonly service: TransfersService) {}
  @Get('stores') @RequirePermission('transfers.create') stores() { return this.service.stores(); }
  @Get() @RequirePermission('transfers.view') list(@Query() query: unknown, @Req() req: AuthorizedRequest) { return this.service.list(parseInput(listSchema, query), req.access); }
  @Get(':id') @RequirePermission('transfers.view') get(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthorizedRequest) { return this.service.get(id, req.access); }
  @Post() @RequirePermission('transfers.create') create(@Body() body: unknown, @Req() req: AuthorizedRequest) { return this.service.create(parseInput(createSchema, body), req.access); }
  @Patch(':id') @RequirePermission('transfers.edit') edit(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: AuthorizedRequest) { return this.service.edit(id, parseInput(editSchema, body), req.access); }
  @Post(':id/request') @RequirePermission('transfers.request') request(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthorizedRequest) { return this.service.transition(id, 'REQUESTED', req.access); }
  @Post(':id/approve') @RequirePermission('transfers.approve') approve(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthorizedRequest) { return this.service.transition(id, 'APPROVED', req.access); }
  @Post(':id/send') @RequirePermission('transfers.send') send(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthorizedRequest) { return this.service.send(id, req.access); }
  @Post(':id/receive') @RequirePermission('transfers.receive') receive(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: AuthorizedRequest) { return this.service.receive(id, parseInput(receiveSchema, body), req.access); }
  @Post(':id/cancel') @RequirePermission('transfers.cancel') cancel(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthorizedRequest) { return this.service.transition(id, 'CANCELLED', req.access); }
}
