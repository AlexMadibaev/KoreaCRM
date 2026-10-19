# Запуск MVP на VPS

Нужны Linux VPS с Docker Compose, домен с A-записью на IP VPS и открытые порты 80/443. Касса в EXE подключается к API по адресу `https://ДОМЕН/api`; сама касса входящий порт не открывает. Порт 5173 используется только для Vite при разработке.

1. Скопируйте исходники на VPS без `.mvp-local`, `node_modules`, сборок и локальной базы.
2. Скопируйте `deploy/production/env.example` в `.env.production` и задайте домен и уникальные секреты. Для `POSTGRES_PASSWORD` и `JWT_SECRET` используйте только шестнадцатеричные символы; это исключает проблемы с URL и подстановкой Compose. Файл `.env.production` не загружайте в GitHub.
3. Запустите из корня проекта:

```bash
docker compose --env-file .env.production -f compose.production.yaml up -d --build
docker compose --env-file .env.production -f compose.production.yaml ps
```

При первом старте API применяет миграции и создаёт владельца. Откройте `https://ДОМЕН/login`, проверьте вход и `https://ДОМЕН/api/health`. В кассе укажите адрес сервера `https://ДОМЕН/api` и учётные данные сотрудника.

PostgreSQL и API не публикуют свои порты наружу: запросы проходят через Caddy по HTTPS. Данные PostgreSQL, фотографии товаров и сертификаты хранятся в Docker volumes. Компьютер с кассой может находиться в другой сети, если доступен домен.

Перед работой с реальными данными настройте регулярные копии PostgreSQL и тома фотографий `product_images` на отдельный носитель. Проверочные архивы можно создать командами:

```bash
mkdir -p backups
docker compose --env-file .env.production -f compose.production.yaml exec -T postgres pg_dump -U koreacrm -d koreacrm -Fc > backups/koreacrm.dump
docker compose --env-file .env.production -f compose.production.yaml exec -T postgres pg_restore -l < backups/koreacrm.dump > /dev/null
docker compose --env-file .env.production -f compose.production.yaml exec -T api tar -C /app/uploads -czf - products > backups/product-images.tar.gz
```

Сборка контейнеров в текущей рабочей среде не проверена: здесь Docker не установлен. До передачи реальных данных на VPS проверьте `docker compose config`, запуск всех сервисов, вход, продажу и восстановление резервной копии на отдельной базе.
