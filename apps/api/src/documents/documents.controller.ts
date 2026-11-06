import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AccessGuard, RequireAnyPermission } from '../auth/guards';
import type { AccessContext } from '../auth/policy';
import { parseInput } from '../finance/finance.schemas';
import { DocumentsService, documentJournalSchema } from './documents.service';

type AuthorizedRequest = Request & { access: AccessContext };
const anyDocument = ['sales.view', 'purchases.view', 'transfers.view', 'inventory.view'];

@ApiTags('documents') @ApiBearerAuth() @UseGuards(AccessGuard) @Controller('documents')
export class DocumentsController {
  constructor(private readonly service: DocumentsService) {}
  @Get() @RequireAnyPermission(...anyDocument) journal(@Query() query: unknown, @Req() req: AuthorizedRequest) { return this.service.journal(parseInput(documentJournalSchema, query), req.access); }
  @Get(':kind/:id') @RequireAnyPermission(...anyDocument) document(@Param('kind') kind: string, @Param('id') id: string, @Req() req: AuthorizedRequest) { return this.service.document(kind, id, req.access); }
}
