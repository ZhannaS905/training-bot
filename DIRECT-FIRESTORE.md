> Исторический отчёт прежнего кандидата. Требование отдельной identity и блокировка тестового владельца отменены текущим заданием. Актуальные настройки и процедура: DIRECT-EXISTING-ACCOUNT.md. Этот документ не является инструкцией включения.

# Training Test → fitpp-test: локальный кандидат, включение заблокировано

25 октября 2026. Деплой, push, изменение BotHost/webhook/Rules/облачных данных, отправки MAX, вход в Firebase и привязка владельца не выполнялись. Уведомления OFF. Проверки используют синтетические данные, подменённые адаптеры и loopback.

## Исходники и границы

Изолированный clone: work/training-test, ветка safe/direct-firestore-preparation. Основа 67578b3 (safe/local-max-preparation), родитель dd5d4b6 (refactor/cleanup-training-bot). Из отдельной папки задачи 2026-10-25 …-19 перенесены её незакоммиченные owner-dialog.js, тесты, Dockerfile, .dockerignore и bridge; исходная папка не изменена. У этой реализации было 139 тестов. Её состояние нельзя восстановить одним checkout 67578b3 — поэтому файлы включены в кандидат явно. OWNER-DIALOG.md сохраняет процедуру будущей привязки; не активировать.

Из локального max-training-local (задача 2026-10-23 …-8) скопированы точные service/pilot-policy/max-adapter/poll-view/optimistic-context/ingress и persistence.js. Они выполняют действующую серверную семантику моста. SHA256 в source-manifest.txt. Отдельно изучены отчёт журнала …-5 (FitPP commit 6dea26e) и отчёты финансовых изменений …-21/…-17. Локальный commit не доказывает версию запущенного контейнера или модулей процесса.

Новые fitpp-direct.js и fitpp-direct-db.js не подключены к entrypoint и Dockerfile. Это исполняемый offline кандидат, не готовый live пакет. Изменение main моста только позволяет будущей композиции передать callbackTransport; старое значение по умолчанию сохранено. Owner-dialog перенесён с исходным выключенным поведением. Пользовательские polling/callback пути, RAM, optimistic controller, webhook authentication и MAX identity checks сохранены.

## Что реализовано

Внутрипроцессный транспорт принимает результат существующего signedPost на фиксированном https://direct.invalid/bot/update или /bot/poll-view. Этот URL — capability-заглушка: transport не выполняет HTTP. Он повторно проверяет HMAC, путь, тело, время и exact poll scope, затем вызывает исходный normalize → handle → Service. Ответ появляется после завершения транзакции; ошибки доходят до webhook для повтора. HMAC здесь сохраняет контракт и обнаруживает подмену, но не заменяет аутентификацию MAX или Firestore Rules.

Service сохраняет durable maxEvents/digest, конфликт ID, ревизии, порядок событий, защиту от устаревших событий и атомарные bookings/bookingClock/bookingVersions/receipt. Снятие заморозки с изменением main остаётся в той же транзакции; посещения и списания не добавлялись. Poll view читает участников и ревизию в одной транзакции. Ни bind/registerPoll, ни balance не открыты через прямой transport.

SDK-адаптер принимает явно созданный Firebase client SDK instance, требует projectId=fitpp-test в обоих местах, отдельный botUid, текущую аутентификацию этого UID, разрешает только существующие synthetic-v1 пути, запрещает запись bindings/polls и создание без чтения отсутствия. У него нет delete/list, ADC, Admin SDK, файлов с токенами, отправок или побочных эффектов импорта. Записи по умолчанию запрещены. main допускается только потому, что исходный Service выполняет bookingFreeze; ограничения полей ОБЯЗАТЕЛЬНО должны обеспечиваться Rules. Локальные проверки не защищают базу при краже учётных данных.

## Блокер минимальных прав

Существующий cloud-session/firestore-client использует UID тестового владельца, вход по его паролю и короткоживущий токен в памяти Mac. Перенос такого пароля/сессии на BotHost даст боту права тренера и не удовлетворит минимальным правам. Эти файлы и реальные credentials не переносились. Использовать сервисный аккаунт с roles/datastore.user вместо владельца тоже не решает узкое ограничение документов: серверные библиотеки обходят Security Rules, а такая роль шире необходимых операций.

Без отдельной учётной записи бота и проверенных ограниченных Rules безопасное включение сейчас невозможно. Фактические активные Rules и права нового аккаунта не проверены в облаке; Rules для него ещё не реализованы и не прошли emulator review. Это блокер конфигурации/авторизации, а не доказательство технического запрета BotHost. Код получения/обновления credentials и live composition намеренно не добавлены до выбора и проверки прав.

## BotHost и Firebase

Официальная документация BotHost подтверждает custom Dockerfile, Node, npm ci и серверные env; требует 0.0.0.0 и согласованный PORT. Существующий Dockerfile использует Node 22 и порт 3000. Нужна будущая сверка PORT панели, а не произвольная смена порта. Документация не доказывает доступ конкретного контейнера к Firebase Auth/Firestore, достаточность RAM, TLS/CA, ограничения тарифного плана и права оператора на секреты.

Источники:
- https://bothost.ru/docs/custom-dockerfile
- https://bothost.ru/docs/environment-variables
- https://firebase.google.com/docs/firestore/security/iam
- https://firebase.google.com/docs/firestore/security/get-started
- https://firebase.google.com/docs/firestore/use-rest-api

Предпочтительная схема: Firebase client SDK + отдельная bot Firebase Auth identity + Security Rules. Google проверяет токен; getUid — дополнительная локальная проверка, не самостоятельная проверка подписи JWT. Не использовать простой decode JWT как доказательство подлинности. Поддержку выбранной версии SDK, auth refresh и lifecycle нужно отдельно проверить. В найденной локальной SDK-папке заявлена firebase 13.1.0; она не добавлена зависимостью и не считается проверенной для нового контейнера.

## Следующие шаги, до разрешения на деплой

1. Зафиксировать точные Training Test image/commit, ветку репозитория, entrypoint, env names, PORT, webhook URL/update_types и secret с защищённым rollback-снимком. Production и тест используют общий репозиторий: общий update-from-Git запрещён. Проверить /me только после отдельного разрешения на внешний запрос. Не использовать GET /updates рядом с webhook.
2. Подготовить отдельный botUid в fitpp-test, без IAM и без доступа к fitpp-crm. Не брать UID владельца, MAX user ID или BotHost USER_ID. Подготовить Rules локально: чтение нужных state/binding/poll; immutable metadata; неизменные binding/poll; create-only maxEvents; атомарные связь receipt/version/clock/bookings и ограниченный bookingFreeze main; отказ финансовым/тренерским изменениям, чужим workspace, list/delete/произвольным create. Учесть лимиты get/getAfter Rules на транзакцию. Сопоставить со всеми существующими allow: дополнительные allow объединяются через OR.
3. Прогнать Firebase Auth + Firestore Emulator с настоящими SDK и Rules. Отдельные negative тесты для владельца/бота/постороннего, production пути, прямых обходных записей, повреждённых метаданных, main без bookingFreeze, гонки MAX/UI, duplicate после рестарта, конфликт ID, потеря соединения после commit и повтор, заморозка/отмена. Текущая in-memory модель не доказывает конкуренцию и работу Rules.
4. Только после выбора credentials разработать headless login/refresh. Конфигурация будущего режима: BOT_MODE=test; существующие identity/secret/exact scope; FITPP_DIRECT_ENABLED=false по умолчанию; FIREBASE_PROJECT_ID=fitpp-test; отдельные FIREBASE_BOT_UID и серверные секреты выбранного способа входа; OWNER_DIALOG_ENABLED=false; subscriptionNotifications=false. Никаких owner passwords/refresh tokens из Mac. Никакого fallback на production, anonymous, ADC, старый bridge или устаревший локальный snapshot. При потере auth — отказ операции и retry, не положительный ACK.
5. Будущая композиция: SDK auth + createDirectDb(getUid, writeEnabled) → чтение и проверка уже существующих binding/poll (без prepare/arm) → createDirectTransport с openedAt из проверенного poll → bridge.main с post=(s,path,payload)=>signedPost(s,path,payload,{transport}) и callbackTransport=transport. Сохранить guardedApi /me, exact scope, createWebhook secret, reconciliation и RAM. Обе ветки post и callbackTransport обязательны; иначе callbacks останутся на старом HTTP пути. Не брать openedAt=Date.now при рестарте.
6. Добавить SDK с lockfile, Docker COPY новых модулей и persistence; обновить allowlist .dockerignore; собрать образ локально и проверить non-root, TLS, PORT, SIGTERM и отсутствие секретов в слоях/логах. Нынешний Dockerfile не содержит direct-код, поэтому его текущая сборка прямое подключение не включает.
7. После отдельного разрешения — точечные изменения только Training Test и fitpp-test. Сначала проверить outbound TLS к identitytoolkit.googleapis.com / securetoken.googleapis.com и Firestore с запрещёнными записями. Затем минимальные синтетические yes/cancel и восстановление из неопределённого результата commit. Положительный ACK только после durable commit. Сверить UI и MAX projection. Работа без Mac относится только к bot → Firestore: существующий UI FitPP-Test всё ещё зависит от локального API, его хостинг этим кандидатом не переносится.

## Откат

До изменения сохранить точные образ/commit, env и webhook. При отказах сначала остановить приём прямых записей; не запускать два писателя с расходящимися snapshot. Вернуть прежний образ/конфигурацию Training Test, при необходимости прежний bridge с прежними secret и exact scope; сверить состояние Firestore и event receipts до возобновления. Не откатывать базу целиком: потеряются новые операции UI. Не удалять maxEvents, версии и clock, иначе повторная доставка станет новой операцией. Отозвать отдельные credentials бота; удаление/откат Rules только после проверки зависимости других тестовых клиентов. Восстановление webhook нужно только если он впоследствии менялся; переход транспорта сам по себе не требует изменения update_types/URL. Owner OFF, уведомления OFF при любом исходе.

## Альтернатива

Если BotHost не даёт защищённые secrets, стабильный refresh/SDK или outbound TLS, оставить узкий серверный endpoint в управляемой среде с отдельной identity и проверенной транзакционной логикой; бот обращается к нему по подписанному запросу. Это облачный посредник вместо Mac/Tunnel, а не прямое подключение. Широкий Admin ключ в BotHost и ослабление Rules не являются безопасной альтернативой.
