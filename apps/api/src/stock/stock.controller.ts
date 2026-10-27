import { Body, Controller, ForbiddenException, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AccessGuard, RequirePermission, StoreScopeGuard } from '../auth/guards';
import { hasPermission, type AccessContext } from '../auth/policy';
import { StockService } from './stock.service';
import { adjustmentSchema, movementListSchema, parseStockInput, stockListSchema, writeOffSchema } from './stock.schemas';

type AuthorizedRequest = Request & { access: AccessContext };

@ApiTags('stores')
@ApiBearerAuth()
@UseGuards(AccessGuard)
@Controller('stores')
export class StoresController {
  constructor(private readonly stock: StockService) {}

  @Get()
  list(@Req() request: AuthorizedRequest) {
    if (!hasPermission(request.access, 'inventory.view') && !hasPermission(request.access, 'employees.view') && !hasPermission(request.access, 'sales.view') && !hasPermission(request.access, 'stores.view')) throw new ForbiddenException();
    return this.stock.stores(request.access);
  }
}

@ApiTags('stock')
@ApiBearerAuth()
@UseGuards(AccessGuard, StoreScopeGuard)
@Controller('stores/:storeId/stock')
export class StockController {
  constructor(private readonly stock: StockService) {}

  @Get()
  @RequirePermission('inventory.view')
  list(@Param('storeId', ParseUUIDPipe) storeId: string, @Query() query: unknown) {
    return this.stock.list(storeId, parseStockInput(stockListSchema, query));
  }

  @Get('movements')
  @RequirePermission('inventory.view')
  movements(@Param('storeId', ParseUUIDPipe) storeId: string, @Query() query: unknown) {
    return this.stock.movements(storeId, parseStockInput(movementListSchema, query));
  }

  @Post('adjustments')
  @RequirePermission('inventory.adjust')
  adjust(@Param('storeId', ParseUUIDPipe) storeId: string, @Body() body: unknown, @Req() request: AuthorizedRequest) {
    return this.stock.adjust(storeId, parseStockInput(adjustmentSchema, body), request.access.userId);
  }

  @Post('write-offs')
  @RequirePermission('inventory.adjust')
  writeOff(@Param('storeId', ParseUUIDPipe) storeId: string, @Body() body: unknown, @Req() request: AuthorizedRequest) {
    return this.stock.writeOff(storeId, parseStockInput(writeOffSchema, body), request.access.userId);
  }
}
