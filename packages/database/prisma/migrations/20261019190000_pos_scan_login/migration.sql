ALTER TABLE "User" ADD COLUMN "posQrHash" TEXT;
ALTER TABLE "User" ADD COLUMN "posEanHash" TEXT;
CREATE UNIQUE INDEX "User_posQrHash_key" ON "User"("posQrHash");
CREATE UNIQUE INDEX "User_posEanHash_key" ON "User"("posEanHash");
