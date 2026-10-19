# Техническая карта Korea CRM

Этот документ описывает зависимости **текущего коммита**, а не список будущих требований из ТЗ. Точные версии JavaScript пакетов зафиксированы в `pnpm-lock.yaml`; исходные диапазоны версий находятся в `package.json` каждого пакета.

## Компоненты и зависимости

| Компонент       | Каталог                                                                                          | Технологии                                        | Что нужно для запуска                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| API             | `apps/api`                                                                                       | Node.js 22+, NestJS 11, Prisma 6, Argon2          | PostgreSQL 16, `DATABASE_URL`, `JWT_SECRET`                                                   |
| Личный кабинет  | `apps/web`                                                                                       | Next.js 15, React 19, Tailwind CSS 4, ExcelJS, qrcode.react | Node.js 22+, работающий API                                                          |
| Windows касса   | `apps/pos`                                                                                       | Vite 7, React 19, Tauri 2, Rust, локальная SQLite | Windows с WebView2, доступный API; для **сборки** нужны Rust MSVC и Microsoft C++ Build Tools |
| База и миграции | `packages/database/prisma`                                                                       | PostgreSQL 16, Prisma 6                           | `DATABASE_URL`; для seed также `SEED_OWNER_LOGIN` и `SEED_OWNER_PASSWORD`                     |
| Общий код       | `packages/types`, `packages/ui`, `packages/api-client`, `packages/validation`, `packages/config` | TypeScript                                        | Устанавливается вместе с pnpm workspace                                                       |
| Mobile          | `apps/mobile`                                                                                    | Capacitor 7, Vite                                 | Сейчас отдельный каркас; Android SDK не нужен для веба, API или Windows кассы                 |

Для VPS используется `compose.production.yaml`: PostgreSQL 16, контейнер Node.js 22 с API и вебом, Caddy 2 для HTTPS. На VPS нужны Docker Engine с Compose plugin, домен с A-записью на IP сервера и открытые 80/443. Публично доступны только 80/443; порты API 3001 и PostgreSQL 5432 остаются внутри Compose. Касса в EXE входящий порт не открывает и подключается к `https://ДОМЕН/api`. Порт 5173 принадлежит только Vite в режиме разработки. Вход в кассу по QR/EAN-13 описан в [инструкции](POS_SCAN_LOGIN.md).

В `compose.yaml` для разработки есть Redis и MinIO. Текущий код API/веба их не использует; для MVP достаточно PostgreSQL. Не переносите тестовые пароли из `.env.example` на VPS. Требования к сборке кассы на Windows подтверждаются [официальной документацией Tauri](https://v2.tauri.app/start/prerequisites/).

## Чистый клон: установка

```bash
git clone https://github.com/AlexMadibaev/KoreaCRM.git
cd KoreaCRM
corepack enable
corepack pnpm install --frozen-lockfile
```

Node.js 22+ и доступ к npm registry нужны во время установки. Для локальной разработки поднимите PostgreSQL из `compose.yaml` командой `docker compose up -d postgres`; либо укажите собственный PostgreSQL 16. Создайте `.env` из `.env.example` и задайте как минимум `DATABASE_URL`, `JWT_SECRET` длиной от 32 символов, `SEED_OWNER_LOGIN`, `SEED_OWNER_PASSWORD` длиной от 12 символов. Переменные должны быть доступны процессам Prisma и seed; на Windows их можно задать в текущей PowerShell сессии через `$env:ИМЯ='значение'`. API также загружает корневой `.env` самостоятельно.

```bash
corepack pnpm --filter @koreacrm/database db:generate
corepack pnpm --filter @koreacrm/database exec prisma migrate deploy
corepack pnpm --filter @koreacrm/database db:seed
corepack pnpm --filter @koreacrm/api dev
corepack pnpm --filter @koreacrm/web dev
```

Последние две команды запускаются в разных терминалах. По умолчанию API — `http://localhost:3001`, веб — `http://localhost:3000`, API health — `/health`, Swagger — `/docs`. Касса в режиме разработки: `corepack pnpm --filter @koreacrm/pos dev` на порту 5173; адрес API задаётся в `apps/pos/.env` через `VITE_API_URL` или в форме входа кассы.

Для сборки Windows EXE установите Rust с целевым `stable-x86_64-pc-windows-msvc`, Microsoft C++ Build Tools с компонентом **Desktop development with C++** и WebView2 Runtime. Затем выполните `corepack pnpm --filter @koreacrm/pos tauri build` на Windows. Файлы сборки находятся в `apps/pos/src-tauri/target/release/`; путь можно изменить через `CARGO_TARGET_DIR`. WebView2 нужен также на машине, где запускается касса.

`tools/start-mvp.ps1` и `tools/backup-mvp.ps1` подготовлены для исходного Windows ПК: они ожидают PostgreSQL 16 в `C:\Program Files\PostgreSQL\16\bin` и уже созданный кластер `tools/pg-test-data` на порту 5433. Этот кластер **не хранится в GitHub**. Для чистого клона используйте порядок выше или VPS Compose.

## Конфигурация

| Переменная                                | Где используется       | Назначение                                                                                          |
| ----------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                            | Prisma, API, seed      | Адрес PostgreSQL, включая `?schema=public`                                                          |
| `JWT_SECRET`                              | API                    | Подпись токенов, минимум 32 символа                                                                 |
| `SEED_OWNER_LOGIN`, `SEED_OWNER_PASSWORD` | seed                   | Создание первого владельца; пароль минимум 12 символов. Повторный seed не перезаписывает его пароль |
| `API_PORT`, `API_HOST`                    | API                    | По умолчанию 3001 и `0.0.0.0`                                                                       |
| `WEB_ORIGIN`, `POS_ORIGIN`                | API                    | Разрешённые браузерные источники CORS, несколько значений через запятую                             |
| `NEXT_PUBLIC_API_URL`                     | веб, на этапе сборки   | Адрес API в браузере; на VPS — `/api`                                                               |
| `KOREACRM_API_PROXY_TARGET`               | Next.js                | Необязательная внутренняя проксировка `/api` для локального запуска                                 |
| `KOREACRM_NEXT_DIST_DIR`                  | Next.js                | Необязательный каталог сборки для отдельных предпросмотров                                          |
| `VITE_API_URL`                            | касса, на этапе сборки | Начальный адрес API; его можно сменить в интерфейсе кассы                                           |
| `DOMAIN`, `POSTGRES_PASSWORD`             | VPS Compose            | Домен HTTPS и пароль PostgreSQL; шаблон — `deploy/production/env.example`                           |
| `NOTIFICATION_LARGE_*`                    | API                    | Пороги уведомлений; значения по умолчанию есть в `.env.example`                                     |
| `PRODUCT_IMAGE_DIR`                       | API                    | Каталог файлов изображений товаров; на VPS — постоянный том `product_images`                        |

Не коммитьте `.env`, `.env.production`, `.mvp-local`, дампы, токены и локальную SQLite. Файлы исключены из Git через `.gitignore`; перед публикацией всё равно проверяйте `git status`.

## Проверка после изменений

```bash
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm build
```

Корневые команды выполняются через Turbo. На некоторых Windows установках Turbo не находит `pnpm`, если запущен через `corepack pnpm`; выполните `corepack enable` либо добавьте `tools/pnpm.cmd` в `PATH` текущей сессии. `tools/verify-real-db-mvp.mjs` создаёт товары, закупки и продажи: запускайте его **только на отдельной тестовой базе**.

Для VPS используйте [пошаговую инструкцию](VPS_MVP_LAUNCH.md), для старого локального ПК — [локальную инструкцию](LOCAL_MVP_LAUNCH.md). Production Docker Compose подготовлен, но на текущем ПК Docker не установлен; первая сборка и сценарий восстановления должны быть проверены на VPS до работы с реальными данными.
