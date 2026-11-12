INSERT INTO "Permission" ("id", "code")
VALUES (gen_random_uuid(), 'loyalty.edit')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT grants."roleId", loyalty."id"
FROM "RolePermission" grants
JOIN "Permission" settings ON settings."id" = grants."permissionId"
CROSS JOIN "Permission" loyalty
WHERE settings."code" = 'settings.edit' AND loyalty."code" = 'loyalty.edit'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
