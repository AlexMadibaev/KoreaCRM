-- Gift cards are a payment method: the till scans the card's QR code and spends its balance.

CREATE TYPE "GiftCardStatus" AS ENUM ('ACTIVE', 'BLOCKED');
CREATE TYPE "GiftCardTransactionType" AS ENUM ('ISSUE', 'REDEEM', 'REFUND');

CREATE TABLE "GiftCard" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "initialMinor" DECIMAL(18,0) NOT NULL,
    "balanceMinor" DECIMAL(18,0) NOT NULL,
    "status" "GiftCardStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3),
    "comment" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GiftCard_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "GiftCard_balance_check" CHECK ("balanceMinor" >= 0 AND "balanceMinor" <= "initialMinor")
);
CREATE UNIQUE INDEX "GiftCard_code_key" ON "GiftCard"("code");
CREATE INDEX "GiftCard_createdAt_idx" ON "GiftCard"("createdAt");

CREATE TABLE "GiftCardTransaction" (
    "id" UUID NOT NULL,
    "giftCardId" UUID NOT NULL,
    "type" "GiftCardTransactionType" NOT NULL,
    "amountMinor" DECIMAL(18,0) NOT NULL,
    "balanceAfterMinor" DECIMAL(18,0) NOT NULL,
    "saleId" UUID,
    "paymentId" UUID,
    "saleReturnId" UUID,
    "actorId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GiftCardTransaction_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "GiftCardTransaction_giftCardId_createdAt_idx" ON "GiftCardTransaction"("giftCardId", "createdAt");
CREATE INDEX "GiftCardTransaction_paymentId_idx" ON "GiftCardTransaction"("paymentId");
ALTER TABLE "GiftCardTransaction" ADD CONSTRAINT "GiftCardTransaction_giftCardId_fkey" FOREIGN KEY ("giftCardId") REFERENCES "GiftCard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "SalePaymentMethod" ("id", "code", "name", "kind", "active", "system", "sortOrder", "updatedAt")
VALUES (gen_random_uuid(), 'GIFT_CARD', 'Гифт-карта', 'GIFT_CARD', true, true, 70, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "Permission" ("id", "code") VALUES
    (gen_random_uuid(), 'sales.discount.manual'),
    (gen_random_uuid(), 'giftcards.view'),
    (gen_random_uuid(), 'giftcards.manage')
ON CONFLICT ("code") DO NOTHING;

-- Manual receipt discounts are now a separate right; roles that could give unlimited discounts keep it.
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "Role" r CROSS JOIN "Permission" p
WHERE (p."code" = 'sales.discount.manual' AND r."code" IN ('SUPERUSER', 'OWNER', 'DIRECTOR', 'MANAGER'))
   OR (p."code" = 'giftcards.view' AND r."code" IN ('SUPERUSER', 'OWNER', 'DIRECTOR', 'MANAGER'))
   OR (p."code" = 'giftcards.manage' AND r."code" IN ('SUPERUSER', 'OWNER', 'DIRECTOR'))
ON CONFLICT DO NOTHING;
