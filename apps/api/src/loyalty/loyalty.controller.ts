import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AccessGuard, RequirePermission } from '../auth/guards';
import type { AccessContext } from '../auth/policy';
import { parseInput } from '../customers/customers.schemas';
import { loyaltySettingsSchema } from './loyalty.rules';
import { LoyaltyService } from './loyalty.service';

@ApiTags('loyalty') @ApiBearerAuth() @UseGuards(AccessGuard) @Controller('loyalty')
export class LoyaltyController {
  constructor(private readonly service: LoyaltyService) {}
  @Get('settings') get() { return this.service.get(); }
  @Patch('settings') @RequirePermission('settings.edit') save(@Body() body: unknown, @Req() request: Request & { access: AccessContext }) { return this.service.save(parseInput(loyaltySettingsSchema, body), request.access.userId); }
}
