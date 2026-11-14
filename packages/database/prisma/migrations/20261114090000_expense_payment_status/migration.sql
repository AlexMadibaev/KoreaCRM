CREATE TYPE "ExpensePaymentStatus" AS ENUM ('PAID', 'UNPAID');

ALTER TABLE "Expense"
  ADD COLUMN "recipientName" TEXT,
  ADD COLUMN "deletedAt" TIMESTAMP(3),
  ADD COLUMN "paymentStatus" "ExpensePaymentStatus" NOT NULL DEFAULT 'PAID';

ALTER TABLE "Expense" ALTER COLUMN "paymentStatus" SET DEFAULT 'UNPAID';
