# Training Test: request_contact — 25 октября 2026

Подготовлено в refactor/cleanup-training-bot. Training Test Dockerfile задаёт
контактные флаги true; серверные значения env при наличии имеют приоритет.

## Сценарий

Личный /start → «📱 Поделиться номером телефона» → подписанный собственный
контакт → уникальный синтетический клиент → транзакционная привязка → личный
ответ. Нет owner-dialog, файла подтверждения, кодов или дополнительной кнопки.
Личный chat_id берётся из входящего аутентифицированного события, не угадывается.
Для bot_started нужна соответствующая подписка; /start работает с message_created.

Реальный Docker CMD — direct-training-test.cjs. CONTACT_LINK_ENABLED=true
выбирает contact-linking-runtime до подготовки режима бронирований.
Используется существующий MaxApi и TEST_BOT_TOKEN || BOT_TOKEN с проверкой
совместимости, свежий /me проверяет ID и username Training Test.
Тестовые личные ответы разрешены только MAX ID 5819064; TEST_ADMIN_IDS должен
содержать только этот ID. Контактный режим заменяет обработку тестового опроса
в этом процессе; одновременно мост и планировщик не запускаются.

## Серверные настройки

Только Training Test bot_1792646494_1197_zhanna, проект fitpp-test.
Существующие credentials остаются в защищённом окружении сервера; их не копировать.

CONTACT_LINK_ENABLED=true
CONTACT_LINK_REPLY_ENABLED=true
CONTACT_LINK_WRITES_ENABLED=true
OWNER_DIALOG_ENABLED=false
BOT_MODE=test
FIREBASE_PROJECT_ID=fitpp-test
TEST_ADMIN_IDS=5819064
AUTO_PUBLISH=false
TEST_ALLOW_SEND=false
TEST_ALLOW_EDIT=false
TEST_ALLOW_DELETE=false

CHAT_IDS, TEST_EXPECTED_BOT_ID, WEBHOOK_SECRET и FIREBASE_* сохраняются от
существующего тестового запуска. Глобальные разрешения рассылок не включаются.
Старые FITPP_DIRECT_* не мешают контактному режиму; его Firebase-сессия отключает
capability бронирований. Запись привязки имеет отдельный узкий флаг.
При false у CONTACT_LINK_WRITES_ENABLED commit запрещён; при false у
CONTACT_LINK_REPLY_ENABLED личные ответы запрещены.

## Проверки и данные

Webhook проверяет X-Max-Bot-Api-Secret, ограничение 64 KiB. Контакт принимается
после /start в течение пяти минут, в том же личном диалоге, без пересылки.
Проверяются max_info.user_id, HMAC-SHA256(token, исходный vcf_info), timingSafeEqual,
ровно один TEL, нормализация российского телефона 8/7 и единственное совпадение.
Сравнение HMAC соответствует https://dev.max.ru/docs-api/use-cases/sending-messages/keyboard.
Полные события, телефоны, подписи и токены не логируются и не сохраняются.

Только чтение: fitppTestWorkspaces/synthetic-v1/states/main.
Только реестр привязок: fitppTestWorkspaces/synthetic-v1/notificationBindings/training-test.
Карточки demo-client-1…4; реальные клиенты запрещены.
Транзакция перечитывает телефон и реестр, проверяет auth, уникальность, конфликты
clientId/MAX ID/chat ID. Чужая связь не перезаписывается; повтор своей не пишет.
Реестр содержит clientId, maxUserId, maxChatId, notificationsEnabled:false.
Это отдельная привязка к карточке; states/main не изменяется.

Повторные события резервируются в памяти до обработки; до 512 за запуск.
После неоднозначной ошибки отправки автоматического повтора нет. При ошибке
Firebase можно снова отправить /start и поделиться контактом. После перезапуска
память сбрасывается, транзакционная идемпотентность реестра сохраняется.
Нельзя ослаблять Firebase Rules. Чтение обоих документов проверяется до listen;
право записи подтверждается только настоящим успешным commit.

## Установка и откат

Открыть авторизованную панель Training Test. Проверить действующий CMD и доступ
к тестовой Firebase без вывода значений, сохранить прежнюю версию кода и настройки.
Разместить подготовленные файлы из указанной ветки и включить контактные флаги.
После запуска пользователь повторяет /start и сам нажимает кнопку контакта.
Проверить один commit для demo-client-1, notificationsEnabled:false и личный ответ.
При ошибке вернуть прежний код/флаги и перезапустить только Training Test.
Не менять main, production, fitpp-crm, Rules и рассылки.

Локальные проверки используют синтетические адаптеры. Живой формат контакта,
облачные Rules, реальная привязка и подтверждение требуют серверного этапа.
