# Деплой Korea CRM в Coolify

Coolify собирает ветку `main` по файлу `compose.coolify.yaml`. GitHub отправляет подписанный webhook после push в `main`. Ход сборки доступен в Deployment Logs в Coolify.

После выкладки проверьте `/api/health` и `/login` на домене CRM. Пароли и ключи храните в Environment Variables в Coolify.
