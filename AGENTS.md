# Korea CRM: контекст для ИИ агента

Сначала прочитайте [техническую карту](docs/TECHNICAL_SETUP.md) и нужную инструкцию запуска: `docs/VPS_MVP_LAUNCH.md` или `docs/LOCAL_MVP_LAUNCH.md`. Реальные зависимости и версии проверяйте по `package.json`, `pnpm-lock.yaml`, `apps/pos/src-tauri/Cargo.lock` и Prisma schema/migrations; документация может отставать от кода.

## Структура

- `apps/api`: NestJS API, авторизация, операции и правила доступа.
- `apps/web`: личный кабинет Next.js; API URL в `apps/web/lib/api-base.ts`.
- `apps/pos`: Windows касса React/Vite и Rust/Tauri; URL сервера задаётся в форме входа.
- `packages/database/prisma`: схема, миграции, seed. PostgreSQL — основное хранилище.
- `packages/types`, `ui`, `api-client`: общие типы и код.
- `compose.production.yaml`, `deploy/production`: VPS конфигурация.

## Перед изменениями и публикацией

1. Не используйте локальные `.env`, `.mvp-local` или `tools/pg-test-data` как источник production секретов или данных. Они отсутствуют в GitHub.
2. Для схемы БД создавайте миграции Prisma; на VPS применяйте `prisma migrate deploy`. Не запускайте `migrate dev` против рабочей базы.
3. Проверяйте затронутые пакеты через `typecheck`, `lint`, `test` и сборку. `tools/verify-real-db-mvp.mjs` записывает данные и предназначен только для отдельной тестовой БД.
4. Касса EXE не слушает порт. На VPS её API URL — `https://ДОМЕН/api`; наружу открыты только 80/443. Порт 5173 — Vite dev.
5. Production Compose ещё не был собран на реальном VPS в рамках этого проекта. До использования с реальными данными проверьте сборку, миграции, вход, продажу и восстановление из резервной копии.
