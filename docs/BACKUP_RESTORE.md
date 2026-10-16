# Резервная копия и восстановление PostgreSQL

Скрипт `tools/postgres-backup.mjs` создаёт архив `pg_dump` в custom-формате, проверяет его через `pg_restore --list` и хранит последние копии по календарным периодам: 14 ежедневных, 8 еженедельных и 6 ежемесячных. Все даты считаются по UTC. Архивы лежат в `BACKUP_DIR/daily`, `weekly`, `monthly`; повторный запуск в тот же день оставляет только самую новую копию периода.

## Автоматический запуск на VPS

На VPS нужны Node.js и клиентские утилиты PostgreSQL (`pg_dump`, `pg_restore`), совместимые с версией сервера. Создайте отдельного системного пользователя `koreacrm`, каталог копий вне репозитория и закрытый файл `/etc/koreacrm/backup.env`:

```ini
DATABASE_URL=postgresql://USER:PASSWORD@127.0.0.1:5432/koreacrm
BACKUP_DIR=/var/backups/koreacrm
```

Права на `backup.env` и каталог копий должны разрешать доступ только администратору и пользователю сервиса. Если PostgreSQL доступен лишь внутри Docker Compose, используйте адрес и порт, доступные пользователю сервиса, либо запустите скрипт в контейнере с PostgreSQL-клиентом. Параметр Prisma `?schema=public` скрипт удаляет из URI перед вызовом `pg_dump`.

Установите файлы из `deploy/systemd/` в `/etc/systemd/system/`, поправьте пути `/opt/koreacrm` и пользователя при необходимости, затем включите таймер:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now koreacrm-postgres-backup.timer
sudo systemctl start koreacrm-postgres-backup.service
sudo systemctl status koreacrm-postgres-backup.service
```

Проверяйте журнал `journalctl -u koreacrm-postgres-backup.service` и наличие архивов. Копии на том же VPS не защищают от потери VPS: настройте отдельное внешнее хранилище и проверяйте восстановление по расписанию.

## Ручной запуск

Задайте `DATABASE_URL` и `BACKUP_DIR`, затем выполните:

```bash
node tools/postgres-backup.mjs backup
```

На Windows при отсутствии PostgreSQL в `PATH` задайте `PG_BIN_DIR`, например `C:\Program Files\PostgreSQL\16\bin`.

## Восстановление

1. Найдите проверенный `.dump` в `BACKUP_DIR/daily`, `weekly` или `monthly`.
2. Создайте **новую пустую** базу PostgreSQL (`createdb koreacrm_restore`). Не запускайте восстановление поверх рабочей базы.
3. Задайте `RESTORE_DATABASE_URL` для новой базы и `BACKUP_FILE` с полным путём к архиву.
4. Выполните `node tools/postgres-backup.mjs restore`. Скрипт проверит архив и выполнит `pg_restore` одной транзакцией с остановкой при ошибке.
5. Проверьте таблицы и ключевые сценарии API на восстановленной базе. После проверки переключайте приложение на неё.

Проверочный SQL для товаров, продаж и движений склада: `tools/verify-restore-counts.sql`.

## Конфигурация

`tools/config-backup.mjs` копирует заданные файлы конфигурации, сохраняет их SHA-256 и оставляет 14 последних снимков в `BACKUP_DIR/config`. Новые файлы создаются с закрытыми правами доступа. По умолчанию берутся `.env` и `compose.yaml` из `CONFIG_ROOT`; дополнительные файлы можно перечислить через `CONFIG_PATHS` через запятую. Каталоги и символические ссылки скрипт не копирует.

```bash
CONFIG_ROOT=/opt/koreacrm CONFIG_PATHS=.env,compose.yaml BACKUP_DIR=/var/backups/koreacrm node tools/config-backup.mjs backup
CONFIG_SNAPSHOT=/var/backups/koreacrm/config/config-YYYYMMDDTHHMMSSZ-XXXXXXXX CONFIG_RESTORE_DIR=/tmp/koreacrm-config-restored node tools/config-backup.mjs restore
```

Восстановление допускается только в пустой отдельный каталог. Перед копированием проверяются все файлы снимка; после проверки перенесите нужные настройки в новую установку. Для ежедневного запуска есть `deploy/systemd/koreacrm-config-backup.service` и `.timer`; они требуют тех же прав пользователя и `BACKUP_DIR` в `/etc/koreacrm/backup.env`.

## Область готовности

Эти механизмы покрывают PostgreSQL и перечисленные файлы конфигурации. Копии MinIO и загруженных файлов ещё нужно добавить и проверить на VPS с Docker; до этого общий backup/restore по ТЗ не завершён. На одном VPS копии не защищают от потери сервера, поэтому нужен отдельный защищённый носитель.
