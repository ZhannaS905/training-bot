# Прямое подключение с существующим тестовым входом

25 октября 2026. Локальный кандидат; не включён. Новые аккаунты, проекты, посредники не требуются и не создавались.

Исходник — копия кандидата из задачи …-22 с 149 тестами. Проверены session, runtime, direct DB, entrypoint, bridge, direct-core, тесты и прежний отчёт с результатами просмотра BotHost env. Повторного обращения к BotHost не было. По прежнему отчёту в BotHost ещё нет Firebase env. Настройки сайта/моста не являются готовым secret env бота; реальные пароли и токены не переносились.

Теперь допускается только существующий UID `lLlMAetSG1aEeJSeBl4F4ypydEh2`. Он жёстко задан в коде; переопределить UID через env нельзя. Email должен принадлежать этому пользователю: после входа проверяются UID результата и currentUser, aud, iss и sub токена. projectId и authDomain фиксированы на fitpp-test. API key должен быть из этого же проекта; при чужом ключе неверная identity/claims блокирует подключение до Firestore. Рабочий fitpp не используется.

Вход: signInWithEmailAndPassword, inMemoryPersistence; после перезапуска вход повторяется с env. Перед чтением и каждой попыткой транзакции, а также перед её завершением выполняется getIdTokenResult: SDK обновляет истекающий токен и код повторно проверяет claims. При потере identity или ошибке refresh доступ прекращается; следующий запрос может повториться после восстановления SDK. Токены и пароль не сохраняются в файлы, ошибки SDK наружу заменяются фиксированными сообщениями. Cleanup пытается закрыть все ресурсы, не раскрывая исходную ошибку.

Документация: [память Auth](https://firebase.google.com/docs/auth/web/auth-state-persistence), [обновление getIdTokenResult](https://firebase.google.com/docs/reference/js/auth.user#getidtokenresult).

Логика опросов, callbacks, durable receipts, идемпотентность, транзакции, восстановление проекции и ограничения путей сохранены. Уведомления OFF (`subscriptionNotifications=false`), owner-dialog OFF. Учётная запись имеет права существующих Rules; локальные ограничения не сужают права самой учётной записи для других клиентов.

## Точный список новых env

| Переменная | Значение |
|---|---|
| FIREBASE_PROJECT_ID | `fitpp-test` |
| FIREBASE_API_KEY | API key веб-конфигурации именно fitpp-test |
| FIREBASE_BOT_UID | `lLlMAetSG1aEeJSeBl4F4ypydEh2` |
| FIREBASE_BOT_EMAIL | Email уже существующего тестового пользователя |
| FIREBASE_BOT_PASSWORD | Его пароль, исключительно secret env BotHost; не в чате, файлах, команде, логах или репозитории |
| FITPP_DIRECT_ENABLED | `false` при подготовке; `true` только при разрешённой проверке/запуске |
| FITPP_DIRECT_WRITES_ENABLED | `false` для проверки чтения; `true` только после отдельного разрешения записи |
| FITPP_DIRECT_POLL_OPENED_AT | Реальное openedAt зарегистрированного опроса, целое UTC milliseconds |
| OWNER_DIALOG_ENABLED | `false` |

Существующие обязательные настройки: BOT_MODE=test; AUTO_PUBLISH=false; TEST_ALLOW_SEND=false; TEST_ALLOW_EDIT=false; TEST_ALLOW_DELETE=false; FITPP_BRIDGE_ENABLED=true; FITPP_POLL_SYNC_ENABLED=true; прежние FITPP_BRIDGE_HMAC_KEY и FITPP_BRIDGE_SCOPE. Сохранить MAX_BOT_TOKEN/MAX_TOKEN, WEBHOOK_SECRET, TEST_EXPECTED_BOT_ID, CHAT_IDS, STATE_DIR, HOST/PORT и TLS-настройки существующего Training Test. Не отключать проверку TLS. HMAC не перевыпускать. FITPP_BRIDGE_URL сохранить для отката: direct runtime заменяет его адрес только внутри процесса.

Scope остаётся прежним: chat=-80345864298680, user=5819064, mid=mid.ffffb6ed054c9f4801a169a000563611, uuid=99732d34-b609-4266-9418-f12de9b3fe62. Опрос: 26 октября 2026, 20:00, Заря; закрытие 26 октября в 21:00 по Москве. После закрытия кандидат откажется запускаться. Не продлевать срок и не подставлять другое openedAt для обхода проверки.

## Включение — только после отдельного разрешения

1. Сохранить текущий образ, команду запуска и env Training Test в защищённом месте. Не копировать секреты в отчёты. Остановить прежнего писателя перед прямым режимом, чтобы не было двух обработчиков.
2. Подготовить образ с Node 22: установить закреплённые зависимости `npm ci --prefix direct-sdk --ignore-scripts --no-audit --no-fund`. Включить direct-sdk/node_modules, direct-core целиком (включая FitPP-Test/persistence.js), src, оба direct entrypoint и файлы прежнего обработчика. Текущие Dockerfile/.dockerignore намеренно не переключены: обычная сборка прямое подключение не активирует. Их обновление и сборка образа ещё требуются перед деплоем.
3. Внести перечисленные env в BotHost, пароль только через secret env. Проверить действующие Rules для существующего UID: maxBindings, maxClientBindings, maxPolls, maxEvents, bookingVersions, states/main, states/bookings, states/bookingClock внутри fitppTestWorkspaces/synthetic-v1. Rules не ослаблять. Эти права в облаке здесь не проверены.
4. С FITPP_DIRECT_ENABLED=true и FITPP_DIRECT_WRITES_ENABLED=false выполнить `node direct-preflight.cjs`. Это реальный вход и чтение через Rules, поэтому требует разрешения. Команда не запускает MAX listener/sync и пишет только фиксированный итог. Успешное чтение не доказывает право записи.
5. Проверку реальных записей согласовать отдельно, включая разрешённые тестовые данные и ожидаемый результат. Только затем установить FITPP_DIRECT_WRITES_ENABLED=true и команду `node direct-training-test.cjs`. Webhook менять не требуется. Запуск может редактировать текст существующего MAX-опроса через прежний узкий механизм синхронизации, несмотря на false-флаги публикации: это тоже требует разрешения. Новые сообщения, owner-dialog и уведомления не включать.

## Откат

Остановить прямой обработчик, установить FITPP_DIRECT_ENABLED=false и FITPP_DIRECT_WRITES_ENABLED=false, вернуть прежний образ и команду memory-training-test.cjs с прежним env. Один false-флаг не переключает direct entrypoint обратно на мост: требуется возврат команды/образа. Возобновлять прежний режим только с доступным прежним мостом; его зависимость от Mac/Tunnel вернётся. Webhook не менять, если он не менялся. Сверить Firestore bookings и receipts; не удалять maxEvents/версии/clock и не откатывать базу целиком. Не удалять существующего Auth пользователя и не менять его пароль при обычном откате: им пользуется тестовое приложение. Secret env можно убрать из остановленного прямого режима после восстановления прежнего запуска.

## Проверено и ограничения

153 passed, 0 failed, 0 skipped. Все 149 прежних тестов сохранены с адаптацией ожиданий входа, добавлены 4 теста: память/SDK credentials, refresh с отказами claims/identity, успешный refresh без повторного входа, безопасные ошибки входа/cleanup. Тесты синтетические, SDK и MAX подменены; два loopback-теста требуют разрешённых локальных портов и прошли при повторе. Реальное обновление токена на серверах Google, активные Rules, credentials, доступ из BotHost и сборка образа не проверены.

Никаких реальных входов, записей Firebase, отправок MAX, push/deploy, изменений BotHost env, webhook, Rules или IAM не выполнялось. Это локально проверенная подготовка, не работающее облачное подключение.
