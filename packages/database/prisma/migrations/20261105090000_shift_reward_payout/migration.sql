CREATE TABLE "EmployeeRewardPayout" (
    "id" UUID NOT NULL,
    "cashShiftId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "amountMinor" DECIMAL(18,0) NOT NULL,
    "balanceAfterMinor" DECIMAL(18,0) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmployeeRewardPayout_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "EmployeeRewardPayout_positive" CHECK ("amountMinor" > 0)
);
CREATE UNIQUE INDEX "EmployeeRewardPayout_cashShiftId_key" ON "EmployeeRewardPayout"("cashShiftId");
CREATE INDEX "EmployeeRewardPayout_employeeId_createdAt_idx" ON "EmployeeRewardPayout"("employeeId", "createdAt");
ALTER TABLE "EmployeeRewardPayout" ADD CONSTRAINT "EmployeeRewardPayout_cashShiftId_fkey" FOREIGN KEY ("cashShiftId") REFERENCES "CashShift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EmployeeRewardPayout" ADD CONSTRAINT "EmployeeRewardPayout_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
