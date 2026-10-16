# Проверка API на PostgreSQL

`verify-real-db-mvp.mjs` создаёт тестовый товар, поставщика и закупку, принимает товар, проводит продажу и списание. Проверяет запрет продажи сверх остатка и отсутствие повторных движений при повторе запроса. Запускайте только на отдельной тестовой базе: созданные записи сохраняются.

1. Создайте отдельную базу PostgreSQL и задайте `DATABASE_URL`, `JWT_SECRET`, `SEED_OWNER_LOGIN`, `SEED_OWNER_PASSWORD` в локальном окружении.
2. Примените миграции: `corepack pnpm --filter @koreacrm/database exec prisma migrate deploy`.
3. Заполните начальные данные: `corepack pnpm --filter @koreacrm/database db:seed`.
4. Запустите API: `corepack pnpm --filter @koreacrm/api dev`.
5. Задайте `KOREACRM_TEST_API_URL`, `KOREACRM_TEST_LOGIN`, `KOREACRM_TEST_PASSWORD` и выполните `node tools/verify-real-db-mvp.mjs`.

По умолчанию скрипт обращается к `http://127.0.0.1:3006`; адрес можно изменить через `KOREACRM_TEST_API_URL`.
