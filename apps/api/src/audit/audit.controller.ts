import { BadRequestException, Controller, ForbiddenException, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import { AccessGuard } from '../auth/guards';
import type { AccessContext } from '../auth/policy';
import { AuditService } from './audit.service';

const querySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  search: z.string().trim().max(100).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});

@ApiTags('audit') @ApiBearerAuth() @UseGuards(AccessGuard) @Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}
  @Get()
  list(@Query() query: unknown, @Req() request: Request & { access: AccessContext }) {
    if (request.access.role !== 'SUPERUSER') throw new ForbiddenException('Журнал доступен только суперпользователю');
    const parsed = querySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.audit.list(parsed.data);
  }
}
