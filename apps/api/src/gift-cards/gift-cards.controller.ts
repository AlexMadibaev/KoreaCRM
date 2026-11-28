import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AccessGuard, RequirePermission } from '../auth/guards';
import type { Request } from 'express';
import type { AccessContext } from '../auth/policy';
import { parseInput } from '../sales/sales.schemas';
import { giftCardCreateSchema, giftCardListSchema, giftCardPatchSchema } from './gift-cards.rules';
import { GiftCardsService } from './gift-cards.service';

type AuthorizedRequest = Request & { access: AccessContext };

@ApiTags('gift-cards') @ApiBearerAuth() @UseGuards(AccessGuard) @Controller('gift-cards')
export class GiftCardsController {
  constructor(private readonly service: GiftCardsService) {}
  @Get() @RequirePermission('giftcards.view') list(@Query() query: unknown) { return this.service.list(parseInput(giftCardListSchema, query)); }
  // The till checks a scanned card before taking it as payment.
  @Get('lookup/:code') @RequirePermission('sales.create') lookup(@Param('code') code: string) { return this.service.lookup(code); }
  @Get(':id') @RequirePermission('giftcards.view') get(@Param('id', ParseUUIDPipe) id: string) { return this.service.get(id); }
  @Post() @RequirePermission('giftcards.manage') create(@Body() body: unknown, @Req() request: AuthorizedRequest) { return this.service.create(parseInput(giftCardCreateSchema, body), request.access.userId); }
  @Patch(':id') @RequirePermission('giftcards.manage') update(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() request: AuthorizedRequest) { return this.service.setStatus(id, parseInput(giftCardPatchSchema, body).status, request.access.userId); }
}
