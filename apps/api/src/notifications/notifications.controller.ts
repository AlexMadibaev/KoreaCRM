import { Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import { AccessGuard, RequireAnyPermission } from '../auth/guards';
import type { AccessContext } from '../auth/policy';
import { pageSchema, limitSchema, parseInput } from '../catalog/catalog.schemas';
import { NotificationsService } from './notifications.service';

type AuthorizedRequest = Request & { access: AccessContext };
const listSchema = z.object({ page: pageSchema, limit: limitSchema, unread: z.enum(['true', 'false']).default('false') });

@ApiTags('notifications')
@ApiBearerAuth()
@UseGuards(AccessGuard)
@RequireAnyPermission('inventory.view', 'sales.view')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@Req() request: AuthorizedRequest, @Query() query: unknown) {
    const input = parseInput(listSchema, query);
    return this.notifications.list(request.access, input.page, input.limit, input.unread === 'true');
  }

  @Get('summary')
  summary(@Req() request: AuthorizedRequest) { return this.notifications.summary(request.access); }

  @Patch(':id/read')
  markRead(@Req() request: AuthorizedRequest, @Param('id', ParseUUIDPipe) id: string) { return this.notifications.markRead(request.access, id); }

  @Post('read-all')
  readAll(@Req() request: AuthorizedRequest) { return this.notifications.readAll(request.access); }
}
