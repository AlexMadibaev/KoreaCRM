-- Receipts are numbered 1, 2, 3 within each store, in the order they were made.
ALTER TABLE "Sale" ADD COLUMN "sequence" INTEGER;

UPDATE "Sale" AS s
SET "sequence" = numbered.rn, "number" = numbered.rn::text
FROM (SELECT "id", row_number() OVER (PARTITION BY "storeId" ORDER BY "createdAt", "id") AS rn FROM "Sale") AS numbered
WHERE s."id" = numbered."id";

ALTER TABLE "Sale" ALTER COLUMN "sequence" SET NOT NULL;
CREATE UNIQUE INDEX "Sale_storeId_sequence_key" ON "Sale"("storeId", "sequence");
