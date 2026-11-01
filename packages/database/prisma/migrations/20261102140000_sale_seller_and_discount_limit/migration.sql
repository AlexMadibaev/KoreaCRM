ALTER TABLE "Sale" ADD COLUMN "sellerId" UUID;
CREATE INDEX "Sale_sellerId_createdAt_idx" ON "Sale"("sellerId", "createdAt");
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "Permission" ("id", "code") VALUES (gen_random_uuid(), 'sales.discount.unlimited') ON CONFLICT ("code") DO NOTHING;
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "Role" r CROSS JOIN "Permission" p
WHERE p."code" = 'sales.discount.unlimited' AND r."code" IN ('SUPERUSER', 'OWNER', 'DIRECTOR', 'MANAGER')
ON CONFLICT DO NOTHING;
