import { Controller, Get, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import type { HealthStatus } from '@koreacrm/types';
import { DatabaseService } from './database.service';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { AccessGuard, StoreScopeGuard } from './auth/guards';
import { BrandController, CategoryController, ProductController, PosProductsController, StoreProductSettingsController } from './catalog/catalog.controller';
import { CatalogService } from './catalog/catalog.service';
import { ProductImagesController, ProductImageFilesController, ProductImagesService } from './catalog/product-images';
import { StoresController, StockController } from './stock/stock.controller';
import { StockService } from './stock/stock.service';
import { PurchasesController, SuppliersController } from './purchases/purchases.controller';
import { PurchasesService } from './purchases/purchases.service';
import { InventoryController } from './inventory/inventory.controller';
import { InventoryService } from './inventory/inventory.service';
import { TransfersController } from './transfers/transfers.controller';
import { TransfersService } from './transfers/transfers.service';
import { ExpenseCategoriesController, FinanceSummaryController, StoreFinanceController } from './finance/finance.controller';
import { FinanceService } from './finance/finance.service';
import { CustomersController, CustomerPaymentsController } from './customers/customers.controller';
import { CustomersService } from './customers/customers.service';
import { SalesController, SalePaymentMethodsController } from './sales/sales.controller';
import { SalesService } from './sales/sales.service';
import { PosDevicesController } from './pos-devices/pos-devices.controller';
import { PosDevicesService } from './pos-devices/pos-devices.service';
import { EmployeesController, RolesController } from './employees/employees.controller';
import { EmployeesService } from './employees/employees.service';
import { NotificationsController } from './notifications/notifications.controller';
import { NotificationsService } from './notifications/notifications.service';

@Controller('health')
class HealthController {
  @Get()
  health(): HealthStatus {
    return { status: 'ok', service: 'api' };
  }
}

const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || jwtSecret.length < 32) throw new Error('JWT_SECRET must have at least 32 characters');

@Module({
  imports: [JwtModule.register({ secret: jwtSecret })],
  controllers: [HealthController, AuthController, BrandController, CategoryController, ProductController, PosProductsController, ProductImagesController, ProductImageFilesController, StoreProductSettingsController, StoresController, StockController, SuppliersController, PurchasesController, InventoryController, TransfersController, ExpenseCategoriesController, FinanceSummaryController, StoreFinanceController, CustomersController, CustomerPaymentsController, SalesController, SalePaymentMethodsController, PosDevicesController, EmployeesController, RolesController, NotificationsController],
  providers: [DatabaseService, AuthService, AccessGuard, StoreScopeGuard, CatalogService, ProductImagesService, StockService, PurchasesService, InventoryService, TransfersService, FinanceService, CustomersService, SalesService, PosDevicesService, EmployeesService, NotificationsService],
})
export class AppModule {}
