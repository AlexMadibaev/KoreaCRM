-- Added in its own migration: PostgreSQL cannot use a new enum value in the transaction that adds it.
ALTER TYPE "SalePaymentKind" ADD VALUE IF NOT EXISTS 'GIFT_CARD';
