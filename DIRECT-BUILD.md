# Training Test: подготовка образа, 25 октября 2026

Локальная ветка `refactor/cleanup-training-bot`, репозиторий ZhannaS905/training-bot.
Подготовка не активирует прямое подключение. CMD сохранён:
`node /opt/training-test/memory-training-test.cjs`.
Docker ENV: FITPP_DIRECT_ENABLED=false, FITPP_DIRECT_WRITES_ENABLED=false,
OWNER_DIALOG_ENABLED=false; прежние запреты AUTO_PUBLISH/TEST_ALLOW_* сохранены.
Не запускать даже прежний обработчик с реальными env в рамках проверки сборки.

## Состав

Node 22 bookworm-slim; корневые зависимости через npm ci; Firebase 12.19.0
и транзитивные зависимости из direct-sdk/package-lock.json через отдельный npm ci
с --omit=dev --ignore-scripts --no-audit --no-fund --engine-strict.
Образ содержит src, direct-core целиком, включая FitPP-Test/persistence.js,
оба direct entrypoint, memory-training-test.cjs и прежний CA сертификат.
.dockerignore ограничивает контекст исходниками runtime и манифестами,
исключает node_modules, env, приватные ключи и credential-файлы.
Секреты не передавать через COPY, ARG или ENV образа.

## Проверка на машине с Docker (без credentials и внешних сервисов)

Из корня этой локальной копии:

```sh
docker build --pull -t training-test:direct-prepared .
docker run --rm --network none --entrypoint node training-test:direct-prepared -e 'const assert=require("node:assert/strict"); assert.equal(process.versions.node.split(".")[0],"22"); assert.equal(process.env.FITPP_DIRECT_ENABLED,"false"); assert.equal(process.env.FITPP_DIRECT_WRITES_ENABLED,"false"); const load=require("node:module").createRequire("/opt/training-test/direct-sdk/package.json"); for(const m of ["firebase/app","firebase/auth","firebase/firestore"]) load(m); require("./direct-core/FitPP-Test/persistence.js"); for(const m of ["./src/fitpp-direct-runtime","./direct-preflight.cjs","./direct-training-test.cjs"]) require(m); console.log("IMAGE_IMPORTS_OK")'
docker run --rm --network none --entrypoint node training-test:direct-prepared direct-preflight.cjs
```

Последняя команда должна завершиться кодом 1 с DIRECT_READ_PREFLIGHT_REJECTED:
режим выключен. SDK импортируется без initializeApp, входа, Firestore и MAX.
Сборка скачивает только образ и npm зависимости; это не проверка Firebase.

## Результат реальной сборки — 25 октября 2026

Docker Desktop 4.96.3 / Engine 29.9.2, linux/arm64. Реальная сборка успешна.
В первом прогоне Firebase 13.1.0 установился с EBADENGINE: его app/auth/firestore
требуют Node >=24.12.0. Локально закреплён Firebase 12.19.0, чистый lockfile
создан под Node 22 со строгой проверкой engines. В Dockerfile добавлен
--engine-strict. Повторная сборка успешна, предупреждений EBADENGINE нет.

Образ training-test:direct-prepared, ID:
`sha256:e47c51f378fe9da76d09b19f5c3361482f2e9803fced0f514142f337944799a3`.
Подтверждены Node v22.23.4, SDK 12.19.0, IMAGE_IMPORTS_OK, совпадение SHA-256
всех 39 runtime-файлов, USER node, прежний CMD и выключенные защитные флаги.
Firebase app не инициализирован (getApps().length === 0 до и после импортов).

Все runtime-проверки и тесты выполнялись с --network none без env-файлов,
секретов и опубликованных портов. Оба direct entrypoint завершились кодом 1:
DIRECT_READ_PREFLIGHT_REJECTED и DIRECT_STARTUP_REJECTED. Прежний CMD завершился
кодом 1: Training Test startup refused stage=CONFIG code=TEST_TOKEN_REQUIRED.
Это проверка безопасного отказа, а не успешного запуска с реальными credentials.

Повторный прогон внутри образа: 153 passed, 0 failed, 0 skipped (Node 22).
Тесты и вспомогательные исходники, отсутствующие в runtime-образе, подключены
отдельными read-only mounts; src/direct-core/direct-sdk в образе не подменялись.
Два HTTP-теста используют только loopback внутри изолированного контейнера.
Точные команды и полный TAP: ../outputs/docker-verification/;
подробный отчёт: ../outputs/Training-Test-build-report.md.

## Следующий этап — отдельное разрешение на preflight

1. Сначала получить успешную реальную сборку и IMAGE_IMPORTS_OK.
2. Отдельно согласовать размещение образа, изменения только Training Test в
   BotHost и реальный вход/чтение Firebase. Сейчас это не разрешено и не выполнено.
3. Сохранить прежний образ, команду и env в защищённом месте; секреты не
   переносить в чат, отчёты, репозиторий или команды. Сверить актуальные параметры
   по DIRECT-EXISTING-ACCOUNT.md. Пароль существующего пользователя — только
   через secret env BotHost. Сохранить прежние HMAC, scope, URL и TLS.
4. Для разрешённой одноразовой проверки: FITPP_DIRECT_ENABLED=true,
   FITPP_DIRECT_WRITES_ENABLED=false, OWNER_DIALOG_ENABLED=false,
   BOT_MODE=test, AUTO_PUBLISH=false и все TEST_ALLOW_*=false.
   FIREBASE_PROJECT_ID=fitpp-test, фиксированный UID из отчёта, API key именно
   fitpp-test, email и secret password существующего пользователя. Нужны прежние
   FITPP_BRIDGE_ENABLED=true, FITPP_POLL_SYNC_ENABLED=true, HMAC/scope и реальное
   FITPP_DIRECT_POLL_OPENED_AT зарегистрированного опроса.
5. Одноразовая команда в подготовленном образе: `node direct-preflight.cjs`.
   Ожидаемый успех: DIRECT_READ_PREFLIGHT_OK. Она выполняет реальный вход и
   разрешённые чтения, не запускает MAX listener/sync; запись выключена.
   Нельзя заменять её командой direct-training-test.cjs для проверки чтения.
6. После проверки вернуть FITPP_DIRECT_ENABLED=false; не переводить постоянную
   команду на прямой обработчик. Успех чтения не доказывает право записи.
   Реальные записи и запуск прямого обработчика требуют отдельного разрешения:
   синхронизация может редактировать существующий опрос MAX.

Срок кандидата: опрос 26 октября 2026, 20:00 Заря, закрытие 21:00 Москва.
После закрытия не менять openedAt и не продлевать срок для обхода защиты.
Rules/IAM/webhook не менять; main и рабочий бот не затрагивать.
Процедура возврата прежнего образа/команды описана в DIRECT-EXISTING-ACCOUNT.md.
