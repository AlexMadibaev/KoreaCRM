# Центр уведомлений

Рабочие события: `LOW_STOCK`, `OUT_OF_STOCK`, `NEGATIVE_STOCK`, `TRANSFER`, `LARGE_RETURN`, `LARGE_DISCOUNT`. При открытии центра или загрузке счётчика API сверяет текущие остатки и минимумы по доступным сотруднику магазинам, если у него есть `inventory.view`. Уведомления хранятся отдельно для каждого сотрудника: прочтение одного не влияет на остальных. При пополнении выше минимума предупреждение об остатке закрывается; при новом снижении появляется как непрочитанное.

`TRANSFER` создаётся в той же транзакции, что и смена статуса перемещения: запрос, подтверждение, отправка, частичная или полная приёмка, отмена. Получатели — активные сотрудники с правами `transfers.view` и `inventory.view`, которым доступен магазин-отправитель или магазин-получатель. Уведомление привязано к доступному получателю магазину и содержит ссылку, открывающую конкретное перемещение. Повтор операции не создаёт дубль; для нескольких частичных приёмок сохраняется отдельное событие на каждую приёмку.

`LARGE_RETURN` создаётся в транзакции с возвратом, когда сумма возврата не меньше `NOTIFICATION_LARGE_RETURN_MINOR`. Значение по умолчанию — `100000000` минимальных единиц (1 000 000,00 сум). Получатели — активные сотрудники с `sales.view` и доступом к магазину. Повтор запроса возврата не создаёт новое уведомление. Ссылка открывает исходный чек в выбранном магазине.

`LARGE_DISCOUNT` создаётся в транзакции продажи, если скидка одновременно достигает `NOTIFICATION_LARGE_DISCOUNT_MINOR` и `NOTIFICATION_LARGE_DISCOUNT_PERCENT` от суммы товаров до скидки. Значения по умолчанию — `10000000` минимальных единиц (100 000,00 сум) и `20` процентов. Получатели — активные сотрудники с `sales.view` и доступом к магазину. Повтор запроса продажи не создаёт дубль. Ссылка открывает конкретный чек.

Web: `/notifications`. API: `GET /notifications`, `GET /notifications/summary`, `PATCH /notifications/:id/read`, `POST /notifications/read-all`. Методы требуют `inventory.view` или `sales.view`; выдача и изменение ограничены магазинами из доступа сотрудника.

Проверка остатков на тестовой PostgreSQL: `node tools/verify-notifications.mjs` при работающем API и переменных `KOREACRM_TEST_LOGIN`, `KOREACRM_TEST_PASSWORD`. Проверка Web на ширине 360 px: `node tools/verify-web-notifications.mjs` с Edge CDP на порту 9226.

Проверка перемещений: `node tools/verify-transfer-notifications.mjs`. Проверка крупного возврата: `node tools/verify-large-return-notifications.mjs`. Проверка крупной скидки: `node tools/verify-large-discount-notifications.mjs`. Скриптам нужны тестовая PostgreSQL, работающий API, указанные переменные доступа и `DATABASE_URL`. Они сохраняют историю движений и архивируют тестовые сущности. Для проверки переходов в браузере добавьте `KOREACRM_TEST_BROWSER=1`. Скриншоты: `tools/pg-test-data/transfer-notifications-mobile.png`, `tools/pg-test-data/transfer-detail-mobile.png`, `tools/pg-test-data/large-return-mobile.png`, `tools/pg-test-data/large-discount-notification-mobile.png`, `tools/pg-test-data/large-discount-mobile.png`.

Остальные типы из ТЗ (`EXPIRING`, `EXPIRED`, `SYNC_ERROR`, `SYSTEM`) пока зарезервированы в схеме и не создаются. Для точных уведомлений по срокам годности нужен учёт остатка каждой партии: сейчас `ProductBatch.quantity` хранит поступившее количество, но продажи и перемещения его не уменьшают. Android-клиент пока отсутствует.
