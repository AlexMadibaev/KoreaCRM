ALTER TABLE "SalePaymentMethod" ADD COLUMN "restrictedToStores" BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE "StorePaymentMethod" (
  "storeId" UUID NOT NULL,
  "paymentMethodId" UUID NOT NULL,
  CONSTRAINT "StorePaymentMethod_pkey" PRIMARY KEY ("storeId", "paymentMethodId"),
  CONSTRAINT "StorePaymentMethod_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "StorePaymentMethod_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "SalePaymentMethod"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "StorePaymentMethod_paymentMethodId_idx" ON "StorePaymentMethod"("paymentMethodId");
