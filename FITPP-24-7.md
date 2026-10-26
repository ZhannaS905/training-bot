# Training Test: управляемый watcher

Область: ZhannaS905/training-bot, feature/training-test-autopost, только
bot_1792646494_1197_zhanna; fitpp-test / synthetic-v1. Production не менять.

## Устройство
Docker CMD запускает training-test-supervisor.cjs. Он всегда запускает прежний
direct-training-test.cjs (опросы MAX). Только FITPP_NOTIFICATION_SUPERVISED=true
добавляет один fitpp-notification-test.cjs --send --watch.
Ошибка watcher вызывает повторный запуск через 5, 10, 20… секунд, максимум 5 минут.
Каждый запуск заново проверяет scope, получателя, существующие доказательства
хранилища и начинает с baseline без отправки истории. Ошибка проверки никогда
не разрешает отправку: повторяется запуск с теми же проверками.
Журнал не удаляется и не пересоздаётся; claims сохраняют at-most-once даже при
неопределённом результате MAX. События в период простоя могут быть пропущены.

Supervisor проверяет /proc на прежние ручные watcher (включая preview).
Оба новых CLI (test и preview) дополнительно держат abstract socket Linux, который ядро
освобождает при падении. Запускать watcher вручную после переключения запрещено,
Старый код не имеет этой блокировки, поэтому его не запускать.
SIGTERM/SIGINT передаются обоим детям; через 10 секунд — SIGKILL. Падение основного
бота останавливает watcher и завершает supervisor с ошибкой: восстановление всего
контейнера зависит от политики BotHost. Блокировка действует в одном контейнере;
параллельные контейнеры/rolling deployment не поддерживаются.

## Перед переключением — проверить в панели или у поддержки
1. У Training Test выбрана именно тестовая ветка и собственный Dockerfile.
   Нет переопределения CMD/startup command. Фактически используется /opt/training-test.
2. Контейнер автоматически поднимается после падения PID 1 и перезагрузки узла.
   Уточнить restart policy и отключение sleep. Названия настроек неизвестны.
3. Обновление останавливает старый контейнер ДО запуска нового (без перекрытия).
4. /app/data сохраняется и доступен пользователю node. Существующие маркер и
   исходный claim остаются на месте. Ничего не создавать для обхода проверки.

Документация подтверждает CMD собственного Dockerfile, но не доказывает настройки
конкретного контейнера: https://bothost.ru/docs/main-file-entrypoint
Хранилище и диагностика: https://bothost.ru/docs/common-errors

## Переключение (только отдельным разрешённым этапом deploy)
Во время переключения не менять посещения FitPP. Команды — по одной, без разделителей.
1. В текущем контейнере получить актуальные PID/argv без ps, без печати env:

   `node -e 'const f=require("fs");for(const p of f.readdirSync("/proc").filter(x=>/^\d+$/.test(x))){try{const a=f.readFileSync("/proc/"+p+"/cmdline","utf8").split("\0");if(a.some(x=>/fitpp-notification-(test|preview)\.cjs$/.test(x)))console.log(p,JSON.stringify(a))}catch{}}'`

2. Убедиться, что найден ровно один нужный --send --watch. PID 98 не считать актуальным.
   Остановить найденный PID командой `kill -TERM <актуальный_PID>`.
   Повторить проверку из шага 1 до отсутствия watcher. Не запускать новый вручную.
3. Проверить сохранность fitpp-storage-check.txt и исходного журнала; сохранить
   прежний FITPP_NOTIFICATION_STORAGE_CONFIRMED=fitpp-test:training-test:storage-check-20261026.
4. Сначала обновить только Training Test из проверенного коммита тестовой ветки,
   с собственным Dockerfile и FITPP_NOTIFICATION_SUPERVISED=false. Убедиться,
   что опросы работают. Проверить блокировку именно в Linux BotHost (без сети,
   без отправок, без изменения журнала), одной командой:

   `node -e '(async()=>{const {acquire}=require("/opt/training-test/src/fitpp-notification-lock.cjs");const a=await acquire();try{let blocked=false;try{const b=await acquire();b.close()}catch(e){if(e.code!=="EADDRINUSE")throw e;blocked=true}if(!blocked)throw Error("LOCK_FAILED")}finally{await new Promise(r=>a.close(r))}const c=await acquire();await new Promise(r=>c.close(r));console.log("LOCK_OK")})().catch(()=>{console.error("LOCK_FAILED");process.exitCode=1})'`

   Только после LOCK_OK и проверок панели сохранить
   FITPP_NOTIFICATION_SUPERVISED=true у Training Test. Сохранение env может
   пересоздать контейнер. Не менять остальные env. При LOCK_FAILED не включать.
5. В runtime логах дождаться FITPP_NOTIFICATION_BASELINE no_history_send;
   отсутствие исторических сообщений — ожидаемо. Проверить опросы MAX.
   Командой шага 1 подтвердить ровно один watcher, при закрытом терминале.
6. В согласованное время проверить падение watcher: остановить только его PID
   SIGTERM, увидеть watcher_stopped retry_ms=5000 и новый baseline, новый PID.
   Это не требует изменения Firebase или отправки сообщения. Потом отдельно
   проверить restart контейнера и новый baseline, сохранность журнала и опросы.
7. Реальный новый attended/missed проверять только с отдельным разрешением на
   изменение Firebase/отправку MAX. До этого доставка после deploy не подтверждена.

При отказе проверки не чинить маркеры и не очищать журнал. Откат: остановить
контейнер, вернуть FITPP_NOTIFICATION_SUPERVISED=false и запустить прежний бот.
Если нужен старый образ a409c4c — он запускает только опросы. Возвращение ручного
watcher допускается лишь после проверки отсутствия управляемого экземпляра.
