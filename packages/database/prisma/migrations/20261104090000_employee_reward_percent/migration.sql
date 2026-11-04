ALTER TABLE "User" ADD COLUMN "rewardPercent" DECIMAL(5,2) NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD CONSTRAINT "User_rewardPercent_range" CHECK ("rewardPercent" >= 0 AND "rewardPercent" <= 100);
UPDATE "User" AS u SET "rewardPercent" = 3 FROM "Role" AS r WHERE u."roleId" = r.id AND r.code = 'MANAGER';
