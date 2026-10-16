-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('PURCHASE', 'SALE', 'RETURN', 'TRANSFER_IN', 'TRANSFER_OUT', 'WRITE_OFF', 'INVENTORY', 'CORRECTION', 'SUPPLIER_RETURN');

-- CreateTable
CREATE TABLE "Stock" (
    "productId" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "reservedQuantity" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Stock_pkey" PRIMARY KEY ("storeId","productId")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "previousQuantity" INTEGER NOT NULL,
    "newQuantity" INTEGER NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "employeeId" UUID,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Stock_productId_idx" ON "Stock"("productId");

-- CreateIndex
CREATE INDEX "StockMovement_storeId_productId_createdAt_idx" ON "StockMovement"("storeId", "productId", "createdAt");

-- CreateIndex
CREATE INDEX "StockMovement_sourceType_sourceId_idx" ON "StockMovement"("sourceType", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "StockMovement_storeId_productId_type_sourceType_sourceId_key" ON "StockMovement"("storeId", "productId", "type", "sourceType", "sourceId");

-- AddForeignKey
ALTER TABLE "Stock" ADD CONSTRAINT "Stock_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stock" ADD CONSTRAINT "Stock_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Stock" ADD CONSTRAINT "Stock_reservedQuantity_nonnegative" CHECK ("reservedQuantity" >= 0);
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_quantity_consistent" CHECK ("quantity" <> 0 AND "previousQuantity" + "quantity" = "newQuantity");

CREATE FUNCTION stock_requires_movement() RETURNS trigger AS $$
DECLARE
  previous_qty integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."quantity" = 0 THEN
      RETURN NEW;
    END IF;
    previous_qty := 0;
  ELSE
    IF OLD."quantity" = NEW."quantity" THEN
      RETURN NEW;
    END IF;
    previous_qty := OLD."quantity";
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "StockMovement" m
    WHERE m."storeId" = NEW."storeId"
      AND m."productId" = NEW."productId"
      AND m."previousQuantity" = previous_qty
      AND m."newQuantity" = NEW."quantity"
      AND m."quantity" = NEW."quantity" - previous_qty
  ) THEN
    RAISE EXCEPTION 'Stock quantity change requires StockMovement';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER stock_quantity_movement_required
AFTER INSERT OR UPDATE ON "Stock"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION stock_requires_movement();

CREATE FUNCTION prevent_stock_movement_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'StockMovement is immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER stock_movement_immutable
BEFORE UPDATE OR DELETE ON "StockMovement"
FOR EACH ROW EXECUTE FUNCTION prevent_stock_movement_mutation();
