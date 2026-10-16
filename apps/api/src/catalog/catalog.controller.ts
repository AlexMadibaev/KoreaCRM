import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import { AccessGuard, RequirePermission, StoreScopeGuard } from '../auth/guards';
import { CatalogService } from './catalog.service';
import { brandSchema, categorySchema, limitSchema, pageSchema, parseInput, productQuerySchema, productSchema, productUpdateSchema, storeSettingsSchema } from './catalog.schemas';

type AuthorizedRequest = Request & { access: { userId: string } };
const listQuerySchema = z.object({ page: pageSchema, limit: limitSchema, search: z.string().trim().max(255).optional() });

@ApiTags('brands')
@ApiBearerAuth()
@UseGuards(AccessGuard)
@Controller('brands')
export class BrandController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  @RequirePermission('brands.view')
  list(@Query() query: unknown) {
    const input = parseInput(listQuerySchema, query);
    return this.catalog.brands(input.page, input.limit, input.search);
  }

  @Get(':id')
  @RequirePermission('brands.view')
  get(@Param('id', ParseUUIDPipe) id: string) { return this.catalog.brand(id); }

  @Post()
  @RequirePermission('brands.create')
  create(@Body() body: unknown, @Req() request: AuthorizedRequest) {
    return this.catalog.createBrand(parseInput(brandSchema, body), request.access.userId);
  }

  @Patch(':id')
  @RequirePermission('brands.edit')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() request: AuthorizedRequest) {
    return this.catalog.updateBrand(id, parseInput(brandSchema, body), request.access.userId);
  }

  @Delete(':id')
  @RequirePermission('brands.delete')
  remove(@Param('id', ParseUUIDPipe) id: string, @Req() request: AuthorizedRequest) {
    return this.catalog.deleteBrand(id, request.access.userId);
  }
}

@ApiTags('categories')
@ApiBearerAuth()
@UseGuards(AccessGuard)
@Controller('categories')
export class CategoryController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  @RequirePermission('categories.view')
  list(@Query() query: unknown) {
    const input = parseInput(listQuerySchema, query);
    return this.catalog.categories(input.page, input.limit, input.search);
  }

  @Get(':id')
  @RequirePermission('categories.view')
  get(@Param('id', ParseUUIDPipe) id: string) { return this.catalog.category(id); }

  @Post()
  @RequirePermission('categories.create')
  create(@Body() body: unknown, @Req() request: AuthorizedRequest) {
    return this.catalog.createCategory(parseInput(categorySchema, body), request.access.userId);
  }

  @Patch(':id')
  @RequirePermission('categories.edit')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() request: AuthorizedRequest) {
    return this.catalog.updateCategory(id, parseInput(categorySchema, body), request.access.userId);
  }

  @Delete(':id')
  @RequirePermission('categories.delete')
  remove(@Param('id', ParseUUIDPipe) id: string, @Req() request: AuthorizedRequest) {
    return this.catalog.deleteCategory(id, request.access.userId);
  }
}

@ApiTags('products')
@ApiBearerAuth()
@UseGuards(AccessGuard)
@Controller('products')
export class ProductController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  @RequirePermission('products.view')
  list(@Query() query: unknown) { return this.catalog.products(parseInput(productQuerySchema, query)); }

  @Get('lookup/sku/:sku')
  @RequirePermission('products.view')
  bySku(@Param('sku') sku: string) { return this.catalog.products({ page: 1, limit: 1, sku }); }

  @Get('lookup/barcode/:barcode')
  @RequirePermission('products.view')
  byBarcode(@Param('barcode') barcode: string) { return this.catalog.products({ page: 1, limit: 1, barcode }); }

  @Get(':id')
  @RequirePermission('products.view')
  get(@Param('id', ParseUUIDPipe) id: string) { return this.catalog.product(id); }

  @Post()
  @RequirePermission('products.create')
  create(@Body() body: unknown, @Req() request: AuthorizedRequest) {
    return this.catalog.createProduct(parseInput(productSchema, body), request.access.userId);
  }

  @Patch(':id')
  @RequirePermission('products.edit')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() request: AuthorizedRequest) {
    return this.catalog.updateProduct(id, parseInput(productUpdateSchema, body), request.access.userId);
  }

  @Delete(':id')
  @RequirePermission('products.delete')
  remove(@Param('id', ParseUUIDPipe) id: string, @Req() request: AuthorizedRequest) {
    return this.catalog.deleteProduct(id, request.access.userId);
  }
}

@ApiTags('store product settings')
@ApiBearerAuth()
@UseGuards(AccessGuard, StoreScopeGuard)
@Controller('stores/:storeId/products/:productId/settings')
export class StoreProductSettingsController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  @RequirePermission('products.view')
  get(@Param('storeId', ParseUUIDPipe) storeId: string, @Param('productId', ParseUUIDPipe) productId: string) {
    return this.catalog.storeSettings(storeId, productId);
  }

  @Patch()
  @RequirePermission('products.edit')
  update(@Param('storeId', ParseUUIDPipe) storeId: string, @Param('productId', ParseUUIDPipe) productId: string, @Body() body: unknown, @Req() request: AuthorizedRequest) {
    return this.catalog.saveStoreSettings(storeId, productId, parseInput(storeSettingsSchema, body), request.access.userId);
  }
}
