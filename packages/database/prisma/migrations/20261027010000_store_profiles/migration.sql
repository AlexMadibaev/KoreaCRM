ALTER TABLE "User" ADD COLUMN "primaryStoreId" UUID;
ALTER TABLE "Store" ADD COLUMN "managerId" UUID;
ALTER TABLE "Role" ADD COLUMN "permissionsCustomizedAt" TIMESTAMP(3);

CREATE INDEX "User_primaryStoreId_idx" ON "User"("primaryStoreId");
CREATE INDEX "Store_managerId_idx" ON "Store"("managerId");

ALTER TABLE "User" ADD CONSTRAINT "User_primaryStoreId_fkey" FOREIGN KEY ("primaryStoreId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Store" ADD CONSTRAINT "Store_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
