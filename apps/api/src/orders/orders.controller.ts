import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import {
  AccessGuard,
  RequirePermission,
  StoreScopeGuard,
} from '../auth/guards';
import type { AccessContext } from '../auth/policy';
import { parseInput } from '../finance/finance.schemas';
import { OrdersService } from './orders.service';
import {
  cancelOrderSchema,
  completeOrderSchema,
  confirmOrderSchema,
  createOrderSchema,
  editOrderSchema,
  orderListSchema,
  orderPaymentSchema,
} from './orders.schemas';

type AuthorizedRequest = Request & { access: AccessContext };

@ApiTags('orders')
@ApiBearerAuth()
@UseGuards(AccessGuard, StoreScopeGuard)
@Controller('stores/:storeId/orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  @RequirePermission('orders.view')
  list(
    @Param('storeId', ParseUUIDPipe) storeId: string,
    @Query() query: unknown,
  ) {
    return this.orders.list(storeId, parseInput(orderListSchema, query));
  }

  @Get(':id')
  @RequirePermission('orders.view')
  get(
    @Param('storeId', ParseUUIDPipe) storeId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.orders.get(storeId, id);
  }

  @Post()
  @RequirePermission('orders.create')
  create(
    @Param('storeId', ParseUUIDPipe) storeId: string,
    @Body() body: unknown,
    @Req() req: AuthorizedRequest,
  ) {
    return this.orders.create(
      storeId,
      parseInput(createOrderSchema, body),
      req.access.userId,
    );
  }

  @Patch(':id')
  @RequirePermission('orders.edit')
  edit(
    @Param('storeId', ParseUUIDPipe) storeId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() req: AuthorizedRequest,
  ) {
    return this.orders.edit(
      storeId,
      id,
      parseInput(editOrderSchema, body),
      req.access.userId,
    );
  }

  @Post(':id/confirm')
  @RequirePermission('orders.confirm')
  confirm(
    @Param('storeId', ParseUUIDPipe) storeId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() req: AuthorizedRequest,
  ) {
    return this.orders.confirm(
      storeId,
      id,
      parseInput(confirmOrderSchema, body).version,
      req.access.userId,
    );
  }

  @Post(':id/ready')
  @RequirePermission('orders.edit')
  ready(
    @Param('storeId', ParseUUIDPipe) storeId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthorizedRequest,
  ) {
    return this.orders.ready(storeId, id, req.access.userId);
  }

  @Post(':id/payments')
  @RequirePermission('orders.pay')
  pay(
    @Param('storeId', ParseUUIDPipe) storeId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() req: AuthorizedRequest,
  ) {
    return this.orders.pay(
      storeId,
      id,
      parseInput(orderPaymentSchema, body),
      req.access.userId,
      req.access.permissions.includes('finance.cash'),
    );
  }

  @Post(':id/complete')
  @RequirePermission('orders.fulfill')
  complete(
    @Param('storeId', ParseUUIDPipe) storeId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() req: AuthorizedRequest,
  ) {
    return this.orders.complete(
      storeId,
      id,
      parseInput(completeOrderSchema, body),
      req.access.userId,
      req.access.permissions.includes('sales.create'),
    );
  }

  @Post(':id/cancel')
  @RequirePermission('orders.cancel')
  cancel(
    @Param('storeId', ParseUUIDPipe) storeId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() req: AuthorizedRequest,
  ) {
    return this.orders.cancel(
      storeId,
      id,
      parseInput(cancelOrderSchema, body),
      req.access.userId,
      req.access.permissions.includes('finance.cash'),
    );
  }
}
