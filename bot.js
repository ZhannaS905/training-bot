// bot.js - ОЧИЩЕННЫЙ ФАЙЛ БЕЗ CRM И БЕЗ ДУБЛИКАТОВ
require('dotenv').config();
const { Bot, Keyboard } = require('@maxhub/max-bot-api');
const fs = require('fs');
const path = require('path');

const bot = new Bot(process.env.BOT_TOKEN);

const ADMIN_IDS = process.env.ADMIN_IDS 
    ? process.env.ADMIN_IDS.split(',').map(id => Number(id.trim()))
    : [];

// Проверяем, что администраторы загружены
if (ADMIN_IDS.length === 0) {
    console.warn('⚠️ Внимание: ADMIN_IDS не указаны в .env файле!');
    console.warn('Добавьте в .env: ADMIN_IDS=ваш_id_через_запятую');
}
console.log('👑 Загруженные ADMIN_IDS:', ADMIN_IDS);

const dailyPolls = {};
const pollMessages = {};

// ========== СИСТЕМА СТАТИСТИКИ КЛИЕНТА ==========
const userStats = {};
const userSubscriptions = {};
// ========== СИСТЕМА ОПЛАТЫ ==========
const pendingPayments = {}; // Ожидающие оплаты

// Данные для банковских переводов
const BANK_DETAILS = {
    SBER: {
        name: 'Сбербанк',
        number: '2202 2010 0800 8258',
        nameHolder: 'Жанна С.',
    },
    SPB: {
        name: 'СПБ (Альфа/Т-Банк)',
        nameHolder: 'Жанна С.',
        phone: '+7 (925) 225-13-36',
        type: 'spb'
    }
};

// ========== ЛОГИРОВАНИЕ ==========
const LOG_DIR = path.join(__dirname, 'logs');

function ensureLogDir() {
    if (!fs.existsSync(LOG_DIR)) {
        fs.mkdirSync(LOG_DIR, { recursive: true });
    }
}

function logToFile(message) {
    ensureLogDir();
    const logFile = path.join(LOG_DIR, `bot-${new Date().toISOString().split('T')[0]}.log`);
    const logMessage = `[${new Date().toISOString()}] ${message}\n`;
    
    fs.appendFileSync(logFile, logMessage, 'utf8');
    console.log(message);
}

// ========== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==========
function getUserName(ctx) {
    const user = ctx.user || ctx.from;
    if (!user) return 'Аноним';
    
    if (user.first_name) {
        return user.first_name + (user.last_name ? ` ${user.last_name}` : '');
    }
    if (user.username) return `@${user.username}`;
    if (user.id) return `Пользователь ${user.id}`;
    
    return 'Аноним';
}

function getUserId(ctx) {
    const user = ctx.user || ctx.from;
    return user?.id || user?.user_id;
}

function getChatId(ctx) {
    return ctx.chat?.id || ctx.chatId || ctx.conversation?.chat_id || ctx.message?.chat?.id;
}

function isAdmin(userId) {
    return ADMIN_IDS.includes(Number(userId));
}

function getDayName(dayNumber) {
    const days = [
        'Воскресенье',
        'Понедельник',
        'Вторник',
        'Среда',
        'Четверг',
        'Пятница',
        'Суббота'
    ];
    return days[dayNumber] || 'Неизвестно';
}

// Функции для определения тренировочных дней
function isTrainingDay(date) {
    const dayOfWeek = date.getDay();
    return dayOfWeek === 1 || dayOfWeek === 3; // Пн=1, Ср=3
}

function getNextTrainingDay(currentDate) {
    const days = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
    let nextDate = new Date(currentDate);
    
    // Начинаем поиск со следующего дня
    nextDate.setDate(nextDate.getDate() + 1);
    
    // Ищем ближайший тренировочный день (пн/ср)
    while (!isTrainingDay(nextDate)) {
        nextDate.setDate(nextDate.getDate() + 1);
    }
    
    const dayName = days[nextDate.getDay()];
    return `${dayName}, ${nextDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}`;
}

function createPollKeyboard() {
    return Keyboard.inlineKeyboard([
        [
            Keyboard.button.callback('✅ Приду', 'poll_yes'),
            Keyboard.button.callback('❌ Не приду', 'poll_no')
        ],
        [
            Keyboard.button.callback('❓ Возможно', 'poll_maybe'),
            Keyboard.button.callback('↩️ Отменить', 'poll_cancel')
        ],
        [
            Keyboard.button.callback('👤 Мой кабинет', 'user_panel'),
            Keyboard.button.callback('ℹ️ Помощь', 'poll_help')
        ]
    ]);
}

// ========== СИСТЕМА АБОНЕМЕНТОВ ==========
function saveSubscriptions() {
    try {
        fs.writeFileSync(
            path.join(LOG_DIR, 'subscriptions.json'),
            JSON.stringify(userSubscriptions, null, 2)
        );
        logToFile('💾 Абонементы сохранены');
    } catch (err) {
        logToFile('❌ Ошибка сохранения абонементов:', err);
    }
}

// ========== СИСТЕМА СТАТИСТИКИ ==========
function saveUserStats() {
    try {
        fs.writeFileSync(
            path.join(LOG_DIR, 'user_stats.json'),
            JSON.stringify(userStats, null, 2)
        );
        logToFile('💾 Статистика пользователей сохранены');
    } catch (err) {
        logToFile('❌ Ошибка сохранения статистики:', err);
    }
}

function updateUserStats(userId, userName, action, trainingDate) {
    if (!userStats[userId]) {
        userStats[userId] = {
            name: userName,
            totalTrainings: 0,
            attended: 0,
            missed: 0,
            maybe: 0,
            noShow: 0,
            history: [],
            subscriptionHistory: [],
            firstSeen: new Date().toISOString(),
            lastActivity: new Date().toISOString()
        };
    }
    
    const stats = userStats[userId];
    stats.lastActivity = new Date().toISOString();
    
    const trainingInfo = {
        date: trainingDate || new Date().toISOString().split('T')[0],
        action: action,
        timestamp: new Date().toISOString()
    };
    
    stats.history.push(trainingInfo);
    
    if (action === 'yes') {
        stats.attended++;
        stats.totalTrainings++;
    } else if (action === 'no') {
        stats.missed++;
        stats.totalTrainings++;
    } else if (action === 'maybe') {
        stats.maybe++;
    }
    
    // Сохраняем историю абонементов
    if (userSubscriptions[userId]) {
        const subscription = userSubscriptions[userId];
        const subHistory = {
            date: new Date().toISOString(),
            type: subscription.type,
            lessons: subscription.lessons,
            startDate: subscription.startDate,
            lastUsed: subscription.lastUsed
        };
        
        const lastHistory = stats.subscriptionHistory[stats.subscriptionHistory.length - 1];
        if (!lastHistory || lastHistory.lessons !== subscription.lessons) {
            stats.subscriptionHistory.push(subHistory);
        }
    }
    
    if (stats.history.length > 50) {
        stats.history = stats.history.slice(-50);
    }
    
    saveUserStats();
    return stats;
}

// ========== ЗАГРУЗКА ДАННЫХ ПРИ СТАРТЕ ==========
try {
    const subsFile = path.join(LOG_DIR, 'subscriptions.json');
    if (fs.existsSync(subsFile)) {
        const data = fs.readFileSync(subsFile, 'utf8');
        if (data.trim()) {
            Object.assign(userSubscriptions, JSON.parse(data));
            logToFile(`✅ Загружено ${Object.keys(userSubscriptions).length} абонементов`);
        }
    }
} catch (err) {
    logToFile('⚠️ Ошибка загрузки абонементов:', err);
}

try {
    const statsFile = path.join(LOG_DIR, 'user_stats.json');
    if (fs.existsSync(statsFile)) {
        const data = fs.readFileSync(statsFile, 'utf8');
        if (data.trim()) {
            Object.assign(userStats, JSON.parse(data));
            logToFile(`✅ Загружено ${Object.keys(userStats).length} записей статистики`);
        }
    }
} catch (err) {
    logToFile('⚠️ Ошибка загрузки статистики:', err);
}

// ========== ФУНКЦИИ ДЛЯ КНОПОК ==========
function createBuyKeyboard() {
    return Keyboard.inlineKeyboard([
        [
            Keyboard.button.callback('📅 Месячный (4400 руб.)', 'buy_monthly_select'),
            Keyboard.button.callback('🎫 Разовое посещение (700 руб.)', 'buy_single_select')
        ]
    ]);
}

function createPaymentMethodKeyboard(subscriptionType) {
    return Keyboard.inlineKeyboard([
        [
            Keyboard.button.callback('💰 Наличные', `pay_cash_${subscriptionType}`),
            Keyboard.button.callback('🏦 Перевод', `pay_bank_${subscriptionType}`)
        ],
        [
            Keyboard.button.callback('« Назад к выбору', 'user_buy')
        ]
    ]);
}

// ========== ФУНКЦИИ ОПРОСОВ ==========
function createPollText(dateKey, poll) {
    const yesCount = poll.yes.length;
    const noCount = poll.no.length;
    const maybeCount = poll.maybe.length;
    const total = yesCount + noCount + maybeCount;
    
    const date = new Date(dateKey);
    const formattedDate = date.toLocaleDateString('ru-RU', {
        weekday: 'long',
        day: 'numeric',
        month: 'long'
    });
    
    // Тренировка по умолчанию (без CRM)
    const trainingType = 'ВИИТ тренировка';
    const trainingLocation = 'мкр. Заря';
    const trainingTime = '20:00';
    
    let text = `**${formattedDate}**\n`;
    text += `*${trainingType}*\n\n`;
    text += `📍 ${trainingLocation}\n`;
    text += `⏰ ${trainingTime}\n\n`;
    
    if (total === 0) {
        text += `*🤨  Пока никто не записался!*\n\n`;
    } else {
        text += `**Участников: ${total}**\n\n`;
        
        if (yesCount > 0) {
            text += `**✅ Идут (${yesCount}):**\n`;
            poll.yes.forEach((name, i) => {
                text += `${i + 1}. ${name}\n`;
            });
            text += `\n`;
        }
        
        if (maybeCount > 0) {
            text += `**❓ Возможно (${maybeCount}):**\n`;
            poll.maybe.forEach((name, i) => {
                text += `${i + 1}. ${name}\n`;
            });
            text += `\n`;
        }
        
        if (noCount > 0) {
            text += `**❌ Не идут (${noCount}):**\n`;
            poll.no.forEach((name, i) => {
                text += `${i + 1}. ${name}\n`;
            });
            text += `\n`;
        }
    }
    
    text += `Используйте кнопки ниже:`;
    
    return text;
}

async function createNewPollMessage(chatId, pollText, pollKey) {
    try {
        logToFile(`🆕 Создаю новое сообщение с опросом в чате ${chatId}`);
        
        const keyboard = createPollKeyboard();
        
        const message = await bot.api.sendMessageToChat(chatId, pollText, {
            format: 'markdown',
            attachments: [keyboard]
        });
        
        let messageId = null;
        
        if (message?.body?.mid) {
            messageId = message.body.mid;
            pollMessages[pollKey] = messageId;
            logToFile(`✅ Создан новый опрос, mid: ${messageId}`);
        } else if (message?.mid) {
            messageId = message.mid;
            pollMessages[pollKey] = messageId;
            logToFile(`✅ Создан новый опрос, mid: ${messageId}`);
        } else {
            logToFile(`⚠️ Не получили mid`);
            return null;
        }
        
        return messageId;
        
    } catch (sendError) {
        logToFile(`❌ Не удалось создать сообщение: ${sendError.message}`);
        return null;
    }
}

async function updatePollInChat(chatId) {
    try {
        const today = new Date().toISOString().split('T')[0];
        const pollKey = `${chatId}_${today}`;
        const messageId = pollMessages[pollKey];

        if (!chatId) {
            logToFile('⚠️ Нет chatId');
            return;
        }
        
        const poll = dailyPolls[today] || { yes: [], no: [], maybe: [] };
        const pollText = createPollText(today, poll);
        const keyboard = createPollKeyboard();

        logToFile(`🔄 Обновляю опрос в чате ${chatId}, message_id: ${messageId}`);

        // Пытаемся обновить существующее сообщение
        if (messageId) {
            try {
                const result = await bot.api.sendMessageToChat(chatId, pollText, {
                    format: 'markdown',
                    attachments: [keyboard],
                    forward_message_id: messageId
                });
                
                if (result?.body?.mid) {
                    const newMessageId = result.body.mid;
                    
                    // Если это новое сообщение (mid изменился), обновляем ID
                    if (newMessageId !== messageId) {
                        pollMessages[pollKey] = newMessageId;
                        logToFile(`✅ Создано новое сообщение, mid: ${newMessageId}`);
                        
                        // Пытаемся удалить старое сообщение
                        try {
                            await bot.api.deleteMessage({
                                message_id: messageId,
                                chat_id: chatId
                            });
                            logToFile(`🗑️ Удалено старое сообщение`);
                        } catch (deleteError) {
                            logToFile(`⚠️ Не удалось удалить старое сообщение: ${deleteError.message}`);
                        }
                    } else {
                        logToFile(`✅ Сообщение обновлено`);
                    }
                    
                    return newMessageId;
                }
                
            } catch (editError) {
                logToFile(`⚠️ Не удалось обновить сообщение: ${editError.message}`);
                
                // Если обновление не удалось, создаем новое
                return await createNewPollAndDeleteOld(chatId, pollText, keyboard, pollKey, messageId);
            }
        } else {
            // Если нет messageId, просто создаем новое сообщение
            logToFile(`⚠️ Нет message_id для чата ${chatId}, создаю новое`);
            return await createNewPollMessage(chatId, pollText, pollKey);
        }
        
        return null;

    } catch (error) {
        logToFile(`❌ Ошибка в updatePollInChat: ${error.message}`);
        return null;
    }
}

// Вспомогательная функция для создания нового опроса и удаления старого
async function createNewPollAndDeleteOld(chatId, pollText, keyboard, pollKey, oldMessageId) {
    try {
        // Создаем новое сообщение
        const newMessage = await bot.api.sendMessageToChat(chatId, pollText, {
            format: 'markdown',
            attachments: [keyboard]
        });
        
        if (newMessage?.body?.mid) {
            const newMessageId = newMessage.body.mid;
            pollMessages[pollKey] = newMessageId;
            logToFile(`✅ Создан новый опрос вместо обновления, mid: ${newMessageId}`);
            
            // Пытаемся удалить старое сообщение
            if (oldMessageId) {
                try {
                    await bot.api.deleteMessage({
                        message_id: oldMessageId,
                        chat_id: chatId
                    });
                    logToFile(`🗑️ Удалено старое сообщение`);
                } catch (deleteError) {
                    logToFile(`⚠️ Не удалось удалить старое сообщение: ${deleteError.message}`);
                }
            }
            
            return newMessageId;
        }
        
        return null;
        
    } catch (sendError) {
        logToFile(`❌ Не удалось создать новое сообщение: ${sendError.message}`);
        return null;
    }
}

// ========== ПРОВЕРКА АБОНЕМЕНТА ==========
function checkSubscription(userId, responseType, shouldConsume = true) {
    if (responseType !== 'yes') {
        return { isValid: true, message: '' };
    }
    
    const subscription = userSubscriptions[userId];
    
    if (!subscription) {
        return {
            isValid: false,
            message: `❌ **У вас нет активного абонемента!**\n\nДля записи на тренировку необходимо приобрести абонемент.`
        };
    }
    
    switch (subscription.type) {
        case 'monthly':
            const currentDate = new Date();
            const startDate = new Date(subscription.startDate);
            const oneMonthLater = new Date(startDate);
            oneMonthLater.setDate(startDate.getDate() + 30);
            
            if (currentDate > oneMonthLater) {
                return {
                    isValid: false,
                    message: `❌ **Срок абонемента истёк!**\n\nВаш абонемент закончился ${oneMonthLater.toLocaleDateString('ru-RU')}`
                };
            } else if (subscription.lessons <= 0) {
                return {
                    isValid: false,
                    message: `❌ **Занятия по абонементу закончились!**\n\nУ вас осталось 0 занятий.`
                };
            } else {
                // Списываем занятие только если shouldConsume = true
                if (shouldConsume) {
                    subscription.lessons--;
                    subscription.lastUsed = new Date().toISOString();
                    saveSubscriptions();
                }
                
                return {
                    isValid: true,
                    message: `📅 Месячный | Осталось: ${subscription.lessons} занятий`
                };
            }
            
        case 'single':
            if (subscription.lessons <= 0) {
                return {
                    isValid: false,
                    message: `❌ **Разовое занятие использовано!**`
                };
            } else {
                // Списываем занятие только если shouldConsume = true
                if (shouldConsume) {
                    subscription.lessons = 0;
                    subscription.lastUsed = new Date().toISOString();
                    saveSubscriptions();
                }
                
                return {
                    isValid: true,
                    message: `🎫 Разовое посещение | Использовано`
                };
            }
    }
    
    return { isValid: true, message: '' };
}

// ========== ОБРАБОТКА ОТВЕТОВ НА ОПРОС ==========
async function handlePollResponse(ctx, responseType) {
    try {
        const chatId = getChatId(ctx);
        const today = new Date().toISOString().split('T')[0];
        const userName = getUserName(ctx);
        const userId = getUserId(ctx);
        
        logToFile(`🗳️ ${userName} -> ${responseType} в чате ${chatId}`);
        
        // ========== ВАЖНО: Проверяем, не записан ли пользователь уже ==========
        if (!dailyPolls[today]) {
            dailyPolls[today] = { yes: [], no: [], maybe: [] };
        }
        
        const poll = dailyPolls[today];
        let alreadyInList = null;
        
        // Проверяем, в каком списке уже находится пользователь
        if (poll.yes.includes(userName)) {
            alreadyInList = 'yes';
        } else if (poll.no.includes(userName)) {
            alreadyInList = 'no';
        } else if (poll.maybe.includes(userName)) {
            alreadyInList = 'maybe';
        }
        
        // Если пользователь уже в том же списке - ничего не делаем
        if (alreadyInList === responseType) {
            logToFile(`⚠️ Пользователь ${userName} уже в списке ${responseType}`);
            
            if (userId) {
                try {
                    await bot.api.sendMessageToUser(userId, 
                        `*ℹ️ Вы уже в списке "${getResponseName(responseType)}"*`,
                        { format: 'markdown' }
                    );
                } catch (lsError) {
                    logToFile(`⚠️ Не удалось отправить уведомление в ЛС: ${lsError.message}`);
                }
            }
            
            return;
        }
        
        // ========== ПРОВЕРКА АБОНЕМЕНТА (ТОЛЬКО ИНФОРМАЦИЯ, НЕ БЛОКИРОВКА) ==========
        let subscriptionStatus = 'no_subscription';
        let subscriptionDetails = '';
        let hasValidSubscription = false;

        if (responseType === 'yes') {
            const subscription = userSubscriptions[userId];
            
            if (subscription) {
                // Проверяем, но не блокируем
                const checkResult = checkSubscription(userId, responseType, false);
                
                if (checkResult.isValid) {
                    subscriptionStatus = 'valid';
                    subscriptionDetails = checkResult.message;
                    hasValidSubscription = true;
                    
                    // Если абонемент валиден - списываем занятие
                    checkSubscription(userId, responseType, true);
                } else {
                    subscriptionStatus = 'invalid';
                    subscriptionDetails = checkResult.message;
                    hasValidSubscription = false;
                }
            } else {
                subscriptionStatus = 'no_subscription';
                subscriptionDetails = '❌ **У вас нет активного абонемента!**';
                hasValidSubscription = false;
            }
        }
        
        // ========== УДАЛЯЕМ ИЗ ПРЕДЫДУЩЕГО СПИСКА И ДОБАВЛЯЕМ В НОВЫЙ ==========
        
        // Удаляем пользователя из всех списков (если был в каком-то)
        if (alreadyInList) {
            const index = poll[alreadyInList].indexOf(userName);
            if (index > -1) {
                poll[alreadyInList].splice(index, 1);
                logToFile(`🗑️ Удален из списка ${alreadyInList}: ${userName}`);
                
                // Если уходим из "приду" - восстанавливаем занятие
                if (alreadyInList === 'yes' && responseType !== 'yes') {
                    const subscription = userSubscriptions[userId];
                    if (subscription) {
                        subscription.lessons++; // Восстанавливаем занятие
                        saveSubscriptions();
                        logToFile(`↩️ Восстановлено занятие для ${userName}, осталось: ${subscription.lessons}`);
                    }
                }
            }
        }
        
        // Добавляем в новый список
        if (!poll[responseType]) poll[responseType] = [];
        poll[responseType].push(userName);
        
        // Обновляем статистику пользователя
        updateUserStats(userId, userName, responseType, today);
        
        // Обновляем опрос в чате
        if (chatId) {
            await updatePollInChat(chatId);
        }
        
        // ========== ОТПРАВКА СООБЩЕНИЙ В ЛС ==========
        if (userId && responseType === 'yes') {
            try {
                const trainingType = 'ВИИТ тренировка';
                const trainingLocation = 'мкр. Заря';
                const trainingTime = '20:00';
                
                let message = `✅ **ВЫ УСПЕШНО ЗАПИСАЛИСЬ НА ТРЕНИРОВКУ!**\n\n`;
                
                // Добавляем информацию об абонементе
                if (subscriptionStatus === 'valid') {
                    message += `**🧾 ВАШ АБОНЕМЕНТ:**\n`;
                    message += `└─ ${subscriptionDetails}\n`;
                    message += `└─ ✅ Занятие списано\n\n`;
                } else {
                    // Если нет абонемента
                    message += `**⚠️ ВНИМАНИЕ!**\n`;
                    message += `У вас нет __активного__ абонемента!\n\n`;
                    
                    message += `**🎯 ЧТО ДЕЛАТЬ:**\n`;
                    message += `1. Купите __АБОНЕМЕНТ__ 8 зан/мес (4400 руб.)\n`;
                    message += `2. Оплатите __РАЗОВОЕ ПОСЕЩЕНИЕ__ (700 руб.)\n\n`;
                }
                
                // Добавляем рекомендации
                message += `**💪 ЧТО ВЗЯТЬ С СОБОЙ:**\n`;
                message += `└─ Бутылка воды\n`;
                message += `└─ Полотенце\n`;
                message += `└─ Хорошее настроение! 😊\n\n`;
                
                // Если нет абонемента - добавляем кнопку для покупки
                if (subscriptionStatus !== 'valid') {
                    const buyKeyboard = Keyboard.inlineKeyboard([
                        [
                            Keyboard.button.callback('📅 Купить/Оплатить', 'user_panel_buy')
                        ]
                    ]);
                    
                    message += `Выгоднее приобрести абонемент!\n`;
                    
                    // Отправляем с клавиатурой
                    await bot.api.sendMessageToUser(userId, message, { 
                        format: 'markdown',
                        attachments: [buyKeyboard]
                    });
                } else {
                    // Если есть абонемент - просто текст
                    message += `**Увидимся на тренировке! 🏃‍♀️**`;
                    await bot.api.sendMessageToUser(userId, message, { format: 'markdown' });
                }
                
                logToFile(`📨 Информация отправлена в ЛС ${userId} (статус абонемента: ${subscriptionStatus})`);
                
            } catch (lsError) {
                logToFile(`⚠️ Не удалось отправить в ЛС: ${lsError.message}`);
            }
        } else if (userId && responseType !== 'yes') {
            // Для ответов "не приду" и "возможно"
            const messages = {
                no: `❌ **Вы отметили, что не придете.**\n\n Увидимся в следующий раз!`,
                maybe: `❓ **Вы отметились как "Возможно".**\n\n Подтвердите участие позже!`
            };
            
            try {
                await bot.api.sendMessageToUser(userId, messages[responseType], { format: 'markdown' });
            } catch (lsError) {
                logToFile(`⚠️ Не удалось отправить сообщение об отмене в ЛС: ${lsError.message}`);
            }
        }
        
        // Удаляем команду из чата
        try {
            await ctx.deleteMessage();
            logToFile(`🗑️ Удалена команда от ${userName}`);
        } catch (deleteError) {
            logToFile(`⚠️ Не удалось удалить сообщение: ${deleteError.message}`);
        }
        
    } catch (error) {
        logToFile(`❌ Ошибка обработки ответа: ${error.message}`);
    }
}

// Вспомогательная функция для получения названия ответа
function getResponseName(responseType) {
    const names = {
        'yes': '✅ Приду',
        'no': '❌ Не приду',
        'maybe': '❓ Возможно'
    };
    return names[responseType] || responseType;
}

// ========== ОБРАБОТЧИКИ КНОПОК ОПРОСА ==========
bot.action('poll_yes', async (ctx) => {
    await handlePollResponse(ctx, 'yes');
});

bot.action('poll_no', async (ctx) => {
    await handlePollResponse(ctx, 'no');
});

bot.action('poll_maybe', async (ctx) => {
    await handlePollResponse(ctx, 'maybe');
});

// ========== ОБРАБОТЧИК КНОПКИ ОТМЕНИТЬ ==========
bot.action('poll_cancel', async (ctx) => {
    try {
        const chatId = getChatId(ctx);
        const today = new Date().toISOString().split('T')[0];
        const userName = getUserName(ctx);
        const userId = getUserId(ctx);
        
        logToFile(`↩️ Отмена голоса через кнопку: ${userName}`);
        
        // Удаляем callback-кнопку
        try {
            await ctx.deleteMessage();
            logToFile(`🗑️ Удалено сообщение с кнопкой от ${userName}`);
        } catch (deleteError) {
            logToFile(`⚠️ Не удалось удалить сообщение: ${deleteError.message}`);
        }
        
        if (!dailyPolls[today]) {
            try {
                await ctx.answerCallbackQuery({
                    text: 'ℹ️ Вы еще не голосовали',
                    show_alert: false
                });
            } catch {}
            return;
        }
        
        const poll = dailyPolls[today];
        let removedFrom = null;
        
        // Находим и удаляем пользователя из всех списков
        ['yes', 'no', 'maybe'].forEach(type => {
            if (poll[type]) {
                const index = poll[type].indexOf(userName);
                if (index > -1) {
                    poll[type].splice(index, 1);
                    removedFrom = type;
                    logToFile(`🗑️ Удален из списка ${type}: ${userName}`);
                }
            }
        });
        
        if (!removedFrom) {
            try {
                await ctx.answerCallbackQuery({
                    text: 'ℹ️ Вы еще не голосовали',
                    show_alert: false
                });
            } catch {}
            return;
        }
        
        // Восстанавливаем занятие если отменяем из "приду"
        if (removedFrom === 'yes') {
            const subscription = userSubscriptions[userId];
            if (subscription) {
                subscription.lessons++; // Восстанавливаем занятие
                saveSubscriptions();
                logToFile(`↩️ Восстановлено занятие для ${userName}, осталось: ${subscription.lessons}`);
            }
        }
        
        // Отправляем подтверждение в ЛС
        if (userId) {
            try {
                await bot.api.sendMessageToUser(userId, '✅ **Голос отменён!**', {
                    format: 'markdown'
                });
                logToFile(`📨 Подтверждение отмены отправлено в ЛС ${userId}`);
            } catch (lsError) {
                logToFile(`⚠️ Не удалось отправить подтверждение в ЛС: ${lsError.message}`);
            }
        }
        
        try {
            await ctx.answerCallbackQuery({
                text: '✅ Ваш голос отменен',
                show_alert: false
            });
        } catch {}
        
        logToFile(`↩️ Голос отменен: ${userName}`);
        
        // Обновляем опрос в чате
        if (chatId) {
            await updatePollInChat(chatId);
        }
        
    } catch (error) {
        logToFile(`⚠️ Ошибка отмены голоса: ${error.message}`);
        try {
            await ctx.answerCallbackQuery({
                text: '❌ Ошибка при отмене голоса',
                show_alert: false
            });
        } catch {}
    }
});

// ========== КОМАНДЫ ==========
bot.command('старт', async (ctx) => {
    try {
        const name = getUserName(ctx);
        
        await ctx.reply(
            `**🏃🏻‍♀️‍➡️ Привет, ${name}!**\n\n` +
            `Я бот для записи на тренировки.\n\n` +
            `**📋 Команды:**\n` +
            `• /опрос - создать опрос (в группе)\n` +
            `• /приду - буду на тренировке\n` +
            `• /неприду - не смогу прийти\n` +
            `• /возможно - ещё не решил\n` +
            `• /отменить - отменить голос\n` +
            `• /мойкабинет - ваш личный кабинет\n` +
            `• /моя_статистика - ваша статистика\n` +
            `• /история - история посещений\n` +
            `• /абонемент - информация об абонементе\n` +
            `• /моиабонементы - ваши абонементы\n` +
            `• /купить - купить абонемент\n` +
            `• /записаться - записаться на тренировку\n` +
            `• /помощь - помощь\n\n` +
            `📌 Команды удаляются из чата!`,
            { format: 'markdown' }
        );
        
        await ctx.deleteMessage();
        logToFile(`🗑️ Удалена /старт от ${name}`);
        
    } catch (error) {
        logToFile(`⚠️ Ошибка /старт: ${error.message}`);
    }
});

bot.command('опрос', async (ctx) => {
    try {
        const chatId = getChatId(ctx);
        const userName = getUserName(ctx);
        
        if (!chatId) {
            await ctx.reply(
                '⚠️ *Создавайте опрос в групповом чате!*\n\n' +
                '1. Добавьте меня в группу\n' +
                '2. Напишите /опрос\n' +
                '3. Отмечайтесь кнопками\n\n',
                { format: 'markdown' }
            );
            await ctx.deleteMessage();
            return;
        }
        
        const today = new Date().toISOString().split('T')[0];
        const pollKey = `${chatId}_${today}`;
        
        logToFile(`✅ ${userName} создает опрос в чате: ${chatId}`);
        
        if (!dailyPolls[today]) {
            dailyPolls[today] = { yes: [], no: [], maybe: [] };
        }
        
        const poll = dailyPolls[today];
        const pollText = createPollText(today, poll);
        
        await createNewPollMessage(chatId, pollText, pollKey);
        await ctx.deleteMessage();
        logToFile(`🗑️ Удалена /опрос от ${userName}`);
        
    } catch (error) {
        logToFile(`⚠️ Ошибка: ${error.message}`);
        await ctx.reply('❌ Ошибка', { format: 'markdown' });
    }
});

bot.command('приду', async (ctx) => {
    await handlePollResponse(ctx, 'yes');
});

bot.command('неприду', async (ctx) => {
    await handlePollResponse(ctx, 'no');
});

bot.command('возможно', async (ctx) => {
    await handlePollResponse(ctx, 'maybe');
});

bot.command('отменить', async (ctx) => {
    try {
        const chatId = getChatId(ctx);
        const today = new Date().toISOString().split('T')[0];
        const userName = getUserName(ctx);
        const userId = getUserId(ctx);
        
        logToFile(`↩️ Отмена голоса через команду: ${userName}`);
        
        if (!dailyPolls[today]) {
            await ctx.deleteMessage();
            return;
        }
        
        const poll = dailyPolls[today];
        let removed = false;
        
        ['yes', 'no', 'maybe'].forEach(type => {
            if (poll[type]) {
                const index = poll[type].indexOf(userName);
                if (index > -1) {
                    poll[type].splice(index, 1);
                    removed = true;
                    logToFile(`🗑️ Удален из списка ${type}: ${userName}`);
                }
            }
        });
        
        if (!removed) {
            await ctx.deleteMessage();
            return;
        }
        
        // Восстанавливаем занятие если отменяем из "приду"
        if (userId) {
            const subscription = userSubscriptions[userId];
            if (subscription) {
                subscription.lessons++; 
                saveSubscriptions();
                logToFile(`↩️ Восстановлено занятие для ${userName}, осталось: ${subscription.lessons}`);
            }
            
            try {
                await bot.api.sendMessageToUser(userId, '✅ **Голос отменён!**', {
                    format: 'markdown'
                });
                logToFile(`📨 Подтверждение отмены отправлено в ЛС ${userId}`);
            } catch (lsError) {
                logToFile(`⚠️ Не удалось отправить подтверждение в ЛС: ${lsError.message}`);
            }
        }
        
        await ctx.deleteMessage();
        logToFile(`🗑️ Удалена команда /отменить от ${userName}`);
        
        // Обновляем опрос в чате
        if (chatId) {
            await updatePollInChat(chatId);
        }
        
    } catch (error) {
        logToFile(`⚠️ Ошибка команды /отменить: ${error.message}`);
        try { await ctx.deleteMessage(); } catch {}
    }
});

// ========== ПОЛЬЗОВАТЕЛЬСКАЯ ПАНЕЛЬ ==========
async function showUserPanel(ctx) {
    try {
        const userId = getUserId(ctx);
        const userName = getUserName(ctx);
        
        if (!userId) {
            await ctx.reply('❌ *Не удалось определить ваш профиль*\n\nПожалуйста, откройте меня в личных сообщениях.', { format: 'markdown' });
            await ctx.deleteMessage();
            return;
        }
        
        // Получаем статистику пользователя
        const stats = userStats[userId] || updateUserStats(userId, userName, 'panel', null);
        const subscription = userSubscriptions[userId];
        
        // Рассчитываем показатели
        const attendanceRate = stats.totalTrainings > 0 
            ? Math.round((stats.attended / stats.totalTrainings) * 100) 
            : 0;
        
        // Статистика за 30 дней
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const recentHistory = stats.history.filter(h => 
            new Date(h.timestamp) > thirtyDaysAgo && h.action === 'yes'
        );
        const recentAttended = recentHistory.length;
        
        // Формируем клавиатуру
        const keyboard = Keyboard.inlineKeyboard([
            [
                Keyboard.button.callback('🎫 Мои абонементы', 'user_subs'),
                Keyboard.button.callback('📊 Моя статистика', 'user_stats')
            ],
            [
                Keyboard.button.callback('📅 Расписание', 'user_schedule'),
                Keyboard.button.callback('💳 Купить/Оплатить', 'user_buy')
            ],
            [
                Keyboard.button.callback('❓ Помощь', 'user_help')
            ]
        ]);
        
        // Приветственное сообщение с эмодзи
        let greeting = '';
        const hour = new Date().getHours();
        if (hour < 6) greeting = '🌙 Доброй ночи';
        else if (hour < 12) greeting = '☀️ Доброе утро';
        else if (hour < 18) greeting = '🌤️ Добрый день';
        else greeting = '🌙 Добрый вечер';
        
        await ctx.reply(
            `${greeting}, **${userName.split(' ')[0]}**! 👋\n\n` +
            
            `**📊 ВАШИ ПОКАЗАТЕЛИ:**\n` +
            `└─ 🎯 Посещено тренировок: **${stats.attended || 0}**\n` +
            `└─ 📈 Посещаемость: **${attendanceRate}%**\n` +
            `└─ ⭐ Активность (30 дней): **${recentAttended}**\n\n` +
            
            `**💳 АБОНЕМЕНТ:**\n` +
            `${subscription ? 
                `└─ ✅ ${subscription.type === 'monthly' ? '📅 Месячный' : '🎫 Разовое посещение'}\n` +
                `└─ 🎫 Осталось занятий: **${subscription.lessons}**\n` +
                `└─ 💰 Стоимость: **${subscription.cost} руб.**` : 
                `└─ ❌ **Нет активного абонемента**\n` +
                `└─ 🎯 Рекомендуем приобрести`}\n\n` +
            
            `*Выберите действие:*`,
            {
                attachments: [keyboard],
                format: 'markdown'
            }
        );
        
        await ctx.deleteMessage();
        logToFile(`👤 Пользовательская панель открыта: ${userName} (${userId})`);
        
    } catch (error) {
        logToFile(`❌ Ошибка пользовательской панели: ${error.message}`);
        throw error;
    }
}

// Команда "Мой кабинет"
bot.command('мойкабинет', async (ctx) => {
    try {
        await showUserPanel(ctx);
    } catch (error) {
        logToFile(`❌ Ошибка команды мойкабинет: ${error.message}`);
        await ctx.reply('Произошла ошибка при открытии панели', { format: 'markdown' });
        await ctx.deleteMessage();
    }
});

// Кнопка "Мой кабинет" в опросе
bot.action('user_panel', async (ctx) => {
    try {
        const userId = getUserId(ctx);
        const userName = getUserName(ctx);
        
        logToFile(`👤 Мой кабинет через кнопку от ${userName}`);
        
        if (!userId) {
            logToFile(`⚠️ Не удалось определить ID пользователя`);
            try {
                await ctx.answerCallbackQuery({
                    text: '❌ Не удалось определить ваш профиль. Откройте меня в личных сообщениях.',
                    show_alert: true
                });
            } catch {}
            return;
        }
        
        try {
            await ctx.answerCallbackQuery({
                text: '👤 Открываю ваш кабинет в личных сообщениях...',
                show_alert: false
            });
        } catch {}
        
        // Отправляем панель в ЛС
        const stats = userStats[userId] || updateUserStats(userId, userName, 'panel', null);
        const subscription = userSubscriptions[userId];
        
        const attendanceRate = stats.totalTrainings > 0 
            ? Math.round((stats.attended / stats.totalTrainings) * 100) 
            : 0;
        
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const recentHistory = stats.history.filter(h => 
            new Date(h.timestamp) > thirtyDaysAgo && h.action === 'yes'
        );
        const recentAttended = recentHistory.length;
        
        const keyboard = Keyboard.inlineKeyboard([
            [
                Keyboard.button.callback('🎫 Мои абонементы', 'user_subs'),
                Keyboard.button.callback('📊 Моя статистика', 'user_stats')
            ],
            [
                Keyboard.button.callback('📅 Расписание', 'user_schedule'),
                Keyboard.button.callback('💳 Купить/оплатить', 'user_buy')
            ],
            [
                Keyboard.button.callback('❓ Помощь', 'user_help')
            ]
        ]);
        
        let greeting = '';
        const hour = new Date().getHours();
        if (hour < 6) greeting = '🌙 Доброй ночи';
        else if (hour < 12) greeting = '☀️ Доброе утро';
        else if (hour < 18) greeting = '🌤️ Добрый день';
        else greeting = '🌙 Добрый вечер';
        
        try {
            await bot.api.sendMessageToUser(
                userId,
                `${greeting}, **${userName.split(' ')[0]}**! 👋\n\n` +
                
                `**📊 ВАШИ ПОКАЗАТЕЛИ:**\n` +
                `└─ 🎯 Посещено тренировок: **${stats.attended || 0}**\n` +
                `└─ 📈 Посещаемость: **${attendanceRate}%**\n` +
                `└─ ⭐ Активность (30 дней): **${recentAttended}**\n\n` +
                
                `**💳 АБОНЕМЕНТ:**\n` +
                `${subscription ? 
                    `└─ ✅ ${subscription.type === 'monthly' ? '📅 Месячный' : '🎫 Разовое посещение'}\n` +
                    `└─ 🎫 Осталось занятий: **${subscription.lessons}**\n` +
                    `└─ 💰 Стоимость: **${subscription.cost} руб.**` : 
                    `└─ ❌ **Нет активного абонемента**\n` +
                    `└─ 🎯 Рекомендуем приобрести`}\n\n` +
                
                `**Выберите действие:**`,
                {
                    format: 'markdown',
                    attachments: [keyboard]
                }
            );
            
            logToFile(`👤 Пользовательская панель отправлена в ЛС: ${userName} (${userId})`);
            
        } catch (lsError) {
            logToFile(`❌ Не удалось отправить панель в ЛС: ${lsError.message}`);
            
            try {
                await ctx.answerCallbackQuery({
                    text: '❌ Не удалось отправить кабинет в ЛС. Откройте меня в личных сообщениях и напишите /мойкабинет',
                    show_alert: true
                });
            } catch {}
        }
        
    } catch (error) {
        logToFile(`❌ Ошибка кнопки "Мой кабинет": ${error.message}`);
        try { 
            await ctx.answerCallbackQuery({
                text: '❌ Ошибка при открытии кабинета',
                show_alert: false
            });
        } catch {}
    }
});

bot.action('poll_help', async (ctx) => {
    try {
        const userId = getUserId(ctx);
        const userName = getUserName(ctx);
        
        logToFile(`❓ Помощь через кнопку от ${userName}`);
        
        if (userId) {
            try {
                await bot.api.sendMessageToUser(userId,
                    `**❓ ПОМОЩЬ ПО ОПРОСУ**\n\n` +
                    `**✅ ПРИДУ:** Запись на тренировку\n` +
                    `**❌ НЕ ПРИДУ:** Отметка отсутствия\n` +
                    `**❓ ВОЗМОЖНО:** Пока не решили\n` +
                    `**👤 МОЙ КАБИНЕТ:** Ваш личный кабинет\n` +
                    `**↩️ ОТМЕНИТЬ:** Удалить голос`,
                    { format: 'markdown' }
                );
                logToFile(`📨 Помощь отправлена в ЛС ${userId}`);
                
                try {
                    await ctx.answerCallbackQuery({
                        text: 'ℹ️ Помощь отправлена в личные сообщения!',
                        show_alert: false
                    });
                } catch (alertError) {
                    logToFile(`ℹ️ Callback query answer не поддерживается`);
                }
                
            } catch (lsError) {
                logToFile(`⚠️ Не удалось отправить помощь в ЛС: ${lsError.message}`);
                
                try {
                    await ctx.answerCallbackQuery({
                        text: '❌ Не удалось отправить помощь в ЛС. Напишите мне в личные сообщения.',
                        show_alert: true
                    });
                } catch (alertError) {
                    logToFile(`⚠️ Не удалось показать alert: ${alertError.message}`);
                }
            }
        } else {
            try {
                await ctx.answerCallbackQuery({
                    text: '❌ Не удалось определить ваш профиль. Откройте меня в личных сообщениях.',
                    show_alert: true
                });
            } catch (alertError) {
                logToFile(`⚠️ Не удалось показать alert: ${alertError.message}`);
            }
        }
        
    } catch (error) {
        logToFile(`⚠️ Ошибка кнопки помощи: ${error.message}`);
        try {
            await ctx.answerCallbackQuery({
                text: '❌ Ошибка при отправке помощи',
                show_alert: false
            });
        } catch {}
    }
});

// ========== СТАТИСТИКА ==========
bot.command('моя_статистика', async (ctx) => {
    try {
        const userId = getUserId(ctx);
        const userName = getUserName(ctx);
        
        if (!userId) {
            await ctx.reply('❌ Не удалось определить ваш профиль', { format: 'markdown' });
            await ctx.deleteMessage();
            return;
        }
        
        const stats = userStats[userId] || updateUserStats(userId, userName, 'stats', null);
        const subscription = userSubscriptions[userId];
        
        const attendanceRate = stats.totalTrainings > 0 
            ? Math.round((stats.attended / stats.totalTrainings) * 100) 
            : 0;
        
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        
        const recentHistory = stats.history.filter(h => 
            new Date(h.timestamp) > thirtyDaysAgo && h.action === 'yes'
        );
        const recentAttended = recentHistory.length;
        
        let statsText = `**📊 ВАША СТАТИСТИКА**\n\n`;
        statsText += `**👤 Пользователь:** ${stats.name}\n\n`;
        
        statsText += `**🎯 ОБЩАЯ АКТИВНОСТЬ:**\n`;
        statsText += `Всего тренировок: ${stats.totalTrainings}\n`;
        statsText += `Посетил: ${stats.attended}\n`;
        statsText += `Пропустил: ${stats.missed}\n`;
        statsText += `Не определился: ${stats.maybe}\n`;
        statsText += `Посещаемость: ${attendanceRate}%\n\n`;
        
        statsText += `**📈 ПОСЛЕДНИЕ 30 ДНЕЙ:**\n`;
        statsText += `Посещено: ${recentAttended} тренировок\n`;
        statsText += `Среднее в неделю: ${Math.round(recentAttended / 4.3)}\n\n`;
        
        if (subscription) {
            const startDate = new Date(subscription.startDate);
            const endDate = new Date(startDate);
            endDate.setDate(startDate.getDate() + 30);
            const daysLeft = Math.max(0, Math.ceil((endDate - new Date()) / (1000 * 60 * 60 * 24)));
            
            statsText += `**🧾 АБОНЕМЕНТ:**\n`;
            statsText += `Тип: ${subscription.type === 'monthly' ? '📅 Месячный' : '🎫 Разовое посещение'}\n`;
            statsText += `Осталось занятий: ${subscription.lessons}\n`;
            statsText += `Начало: ${startDate.toLocaleDateString('ru-RU')}\n`;
            statsText += `Осталось дней: ${daysLeft}\n`;
            
            if (subscription.type === 'monthly') {
                const usedLessons = 8 - subscription.lessons;
                const costPerLesson = 4400 / 8;
                const saved = Math.round(usedLessons * (700 - costPerLesson));
                
                statsText += `Использовано: ${usedLessons} из 8\n`;
                statsText += `Экономия: ${saved} руб.\n`;
                statsText += `Цена за занятие: ${Math.round(4400 / 8)} руб.\n`;
            }
            statsText += `\n`;
        } else {
            statsText += `**🧾 АБОНЕМЕНТ:** ❌ Нет активного абонемента\n\n`;
        }
        
        statsText += `**💡 РЕКОМЕНДАЦИИ:**\n`;
        if (recentAttended >= 8) {
            statsText += `🎯 Отличная активность! Продолжайте в том же духе!\n`;
        } else if (recentAttended >= 4) {
            statsText += `👍 Хороший результат. Можно увеличить частоту!\n`;
        } else if (recentAttended > 0) {
            statsText += `👌 Начало положено. Старайтесь заниматься регулярнее!\n`;
        } else {
            statsText += `🎯 Начните с разового посещения! /купить\n`;
        }
        
        const recentVisits = stats.history
            .filter(h => h.action === 'yes')
            .slice(-5)
            .reverse();
        
        if (recentVisits.length > 0) {
            statsText += `\n**📅 ПОСЛЕДНИЕ ПОСЕЩЕНИЯ:**\n`;
            recentVisits.forEach((visit, index) => {
                const date = new Date(visit.timestamp);
                statsText += `${index + 1}. ${date.toLocaleDateString('ru-RU')}\n`;
            });
        }
        
        statsText += `\n**📅 Первая активность:** ${new Date(stats.firstSeen).toLocaleDateString('ru-RU')}`;
        statsText += `\n**🔄 Последняя активность:** ${new Date(stats.lastActivity).toLocaleDateString('ru-RU')}`;
        
        await ctx.reply(statsText, { format: 'markdown' });
        await ctx.deleteMessage();
        logToFile(`📊 Статистика отправлена пользователю ${userId}`);
        
    } catch (error) {
        logToFile(`❌ Ошибка статистики: ${error.message}`);
        await ctx.reply('Произошла ошибка при получении статистики', { format: 'markdown' });
        await ctx.deleteMessage();
    }
});

// ========== ИСТОРИЯ ==========
bot.command('история', async (ctx) => {
    try {
        const userId = getUserId(ctx);
        const userName = getUserName(ctx);
        
        if (!userId) {
            await ctx.reply('❌ Не удалось определить ваш профиль', { format: 'markdown' });
            await ctx.deleteMessage();
            return;
        }
        
        const stats = userStats[userId] || updateUserStats(userId, userName, 'history', null);
        
        if (stats.history.length === 0) {
            await ctx.reply(
                `**📅 ИСТОРИЯ ПОСЕЩЕНИЙ**\n\n` +
                `У вас пока нет истории посещений.\n` +
                `Запишитесь на первую тренировку!`,
                { format: 'markdown' }
            );
            await ctx.deleteMessage();
            return;
        }
        
        const visitsByMonth = {};
        stats.history.forEach(visit => {
            if (visit.action === 'yes') {
                const date = new Date(visit.timestamp);
                const monthYear = `${date.getMonth() + 1}.${date.getFullYear()}`;
                
                if (!visitsByMonth[monthYear]) {
                    visitsByMonth[monthYear] = {
                        month: date.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }),
                        count: 0,
                        dates: []
                    };
                }
                
                visitsByMonth[monthYear].count++;
                visitsByMonth[monthYear].dates.push(date);
            }
        });
        
        let historyText = `**📅 ИСТОРИЯ ВАШИХ ПОСЕЩЕНИЙ**\n\n`;
        historyText += `**👤 Пользователь:** ${stats.name}\n`;
        historyText += `**Всего посещений:** ${stats.attended}\n\n`;
        
        const sortedMonths = Object.entries(visitsByMonth)
            .sort((a, b) => {
                const [monthA, yearA] = a[0].split('.').map(Number);
                const [monthB, yearB] = b[0].split('.').map(Number);
                return (yearB * 12 + monthB) - (yearA * 12 + monthA);
            })
            .slice(0, 6);
        
        if (sortedMonths.length === 0) {
            historyText += `Записей о посещениях не найдено.\n`;
        } else {
            sortedMonths.forEach(([key, data]) => {
                historyText += `**${data.month}:**\n`;
                historyText += `Посещений: ${data.count}\n`;
                
                if (sortedMonths[0][0] === key && data.dates.length > 0) {
                    const recentDates = data.dates
                        .sort((a, b) => b - a)
                        .slice(0, 5)
                        .map(d => d.toLocaleDateString('ru-RU'));
                    
                    if (recentDates.length > 0) {
                        historyText += `Даты: ${recentDates.join(', ')}\n`;
                    }
                }
                historyText += `\n`;
            });
        }
        
        const months = sortedMonths.map(([_, data]) => data.month.split(' ')[0]);
        const counts = sortedMonths.map(([_, data]) => data.count);
        const maxCount = Math.max(...counts, 1);
        
        historyText += `**📈 АКТИВНОСТЬ ПО МЕСЯЦАМ:**\n`;
        sortedMonths.forEach(([_, data], index) => {
            const barLength = Math.round((data.count / maxCount) * 10);
            const bar = '█'.repeat(barLength) + '░'.repeat(10 - barLength);
            historyText += `${months[index]}: ${bar} ${data.count}\n`;
        });
        
        await ctx.reply(historyText, { format: 'markdown' });
        await ctx.deleteMessage();
        logToFile(`📅 История отправлена пользователю ${userId}`);
        
    } catch (error) {
        logToFile(`❌ Ошибка истории: ${error.message}`);
        await ctx.reply('Произошла ошибка при получении истории', { format: 'markdown' });
        await ctx.deleteMessage();
    }
});

// ========== АБОНЕМЕНТЫ ==========
bot.command('абонемент', async (ctx) => {
    try {
        const userId = getUserId(ctx);
        const subscription = userSubscriptions[userId];
        
        let response = `*📄 ИНФОРМАЦИЯ ОБ АБОНЕМЕНТЕ*\n\n`;
        
        if (subscription) {
            const startDate = new Date(subscription.startDate);
            const endDate = new Date(startDate);
            endDate.setDate(startDate.getDate() + 30);
            const daysLeft = Math.max(0, Math.ceil((endDate - new Date()) / (1000 * 60 * 60 * 24)));
            
            response += `✅ **У вас есть активный абонемент!**\n\n`;
            response += `📅 Тип: ${subscription.type === 'monthly' ? '📅 Месячный' : '🎫 Разовое посещение'}\n`;
            response += `🎯 Осталось занятий: ${subscription.lessons}\n`;
            response += `📅 Дата начала: ${startDate.toLocaleDateString('ru-RU')}\n`;
            response += `⏰ Действует до: ${endDate.toLocaleDateString('ru-RU')}\n`;
            response += `⌛ Осталось дней: ${daysLeft}\n`;
            
            if (subscription.lastUsed) {
                response += `🔄 Последнее использование: ${new Date(subscription.lastUsed).toLocaleDateString('ru-RU')}\n`;
            }
        } else {
            response += '❌ **У вас нет активного абонемента.**\n\n';
            response += '📅 Месячный (8 занятий) - 4400 руб.\n';
            response += '🎫 Разовое посещение (1 занятие) - 700 руб.\n\n';
            response += 'Для покупки используйте /купить';
        }
        
        await ctx.reply(response, { format: 'markdown' });
        await ctx.deleteMessage();
        
    } catch (error) {
        logToFile(`❌ Ошибка /абонемент: ${error.message}`);
        await ctx.reply('Произошла ошибка. Попробуйте позже.');
    }
});

// ========== ПОКУПКА АБОНЕМЕНТА ==========
bot.command('купить', async (ctx) => {
    try {
        const userId = getUserId(ctx);
        const userName = getUserName(ctx);
        
        await ctx.deleteMessage();
        
        // Показываем новое меню покупки напрямую
        const keyboard = Keyboard.inlineKeyboard([
            [
                Keyboard.button.callback('📅 8 зан/мес (4400 руб.)', 'buy_monthly_select'),
                Keyboard.button.callback('🎫 Разовое посещение(700 руб.)', 'buy_single_select')
            ],
            
            [
                Keyboard.button.callback('« В главное меню', 'user_back')
            ]
        ]);
        
        await ctx.reply(
            
            `**📅 МЕСЯЧНЫЙ АБОНЕМЕНТ**\n` +
            `└─ 🎫 8 занятий за 30 дней\n` +
            `└─ 💰 Цена: 4400 руб.\n` +
            `└─ 🎯 Цена за занятие: 550 руб.\n` +
            `└─ 💰 Экономия: 1200 руб.\n` +
            `└─ ⭐ Выгода: 21% скидка\n\n` +
            
            `**🎫 РАЗОВОЕ ПОСЕЩЕНИЕ**\n` +
            `└─ 🎫 1 занятие\n` +
            `└─ 💰 Цена: 700 руб.\n` +
            `└─ ⏰ Неограниченный срок\n` +
            `└─ 🎯 Для пробного посещения\n\n` +
            
            `**💰 СПОСОБЫ ОПЛАТЫ:**\n` +
            `└─ 💰 Наличные на месте\n` +
            `└─ 🏦 Перевод на карту (Сбербанк, СПБ)\n\n` +

            `*Выберите для оплаты:*`,
            {
                format: 'markdown',
                attachments: [keyboard]
            }
        );
        
        logToFile(`🛒 Команда /купить от ${userName}`);
        
    } catch (error) {
        logToFile(`❌ Ошибка команды /купить: ${error.message}`);
        await ctx.reply('Произошла ошибка. Попробуйте позже.', { format: 'markdown' });
    }
});

// ========== ПОМОЩЬ ==========
bot.command('помощь', async (ctx) => {
    try {
        await ctx.reply(
            `**❓ ПОМОЩЬ**\n\n` +
            `**📋 Команды:**\n` +
            `• /опрос - создать опрос (в группе)\n` +
            `• /приду - буду на тренировке\n` +
            `• /неприду - не смогу прийти\n` +
            `• /возможно - ещё не решил\n` +
            `• /отменить - отменить голос\n` +
            `• /мойкабинет - ваш личный кабинет\n` +
            `• /моя_статистика - ваша статистика\n` +
            `• /история - история посещений\n` +
            `• /абонемент - информация об абонементе\n` +
            `• /моиабонементы - ваши абонементы\n` +
            `• /купить - купить абонемент\n` +
            `• /записаться - записаться на тренировку\n\n` +
            `📍 мкр. Заря | ⏰ 20:00 | 🎯 ВИИТ тренировка`,
            { format: 'markdown' }
        );
        
        await ctx.deleteMessage();
        logToFile(`🗑️ Удалена /помощь`);
        
    } catch (error) {
        logToFile(`⚠️ Ошибка: ${error.message}`);
    }
});

// ========== ОБРАБОТЧИКИ КНОПОК ПОКУПКИ ==========
bot.action('user_panel_buy', async (ctx) => {
    try {
        const userId = getUserId(ctx);
        const userName = getUserName(ctx);
        
        logToFile(`🛒 Пользователь ${userName} хочет купить абонемент из ЛС`);
        
        // Пробуем удалить сообщение с кнопкой
        try {
            if (ctx.message && ctx.message.mid) {
                await bot.api.raw.delete('messages/{mid}', {
                    path: { mid: ctx.message.mid }
                });
            } else if (ctx.callbackQuery && ctx.callbackQuery.message && ctx.callbackQuery.message.mid) {
                await bot.api.raw.delete('messages/{mid}', {
                    path: { mid: ctx.callbackQuery.message.mid }
                });
            }
        } catch (deleteError) {
            logToFile(`ℹ️ Не удалось удалить сообщение: ${deleteError.message}`);
        }
        
        const subscription = userSubscriptions[userId];
        
        const keyboard = Keyboard.inlineKeyboard([
            [
                Keyboard.button.callback('📅 8 зан/мес (4400 руб.)', 'buy_monthly_select'),
                Keyboard.button.callback('🎫 Разовое посещение (700 руб.)', 'buy_single_select')
            ],
            [
                Keyboard.button.callback('« Назад', 'user_back')
            ]
        ]);
        
        let response = `**💳 ОПЛАТА**\n\n`;
        
        if (subscription) {
            response += `**✅ У ВАС ЕСТЬ АКТИВНЫЙ АБОНЕМЕНТ**\n\n`;
            response += `Тип: ${subscription.type === 'monthly' ? '📅 Месячный' : '🎫 Разовое посещение'}\n`;
            response += `Осталось занятий: ${subscription.lessons}\n\n`;
        }
                
        response += `**📅 МЕСЯЧНЫЙ АБОНЕМЕНТ**\n`;
        response += `└─ 🎫 8 занятий за 30 дней\n`;
        response += `└─ 💰 Цена: 4400 руб.\n`;
        response += `└─ 🎯 Цена за занятие: 550 руб.\n`;
        response += `└─ 💰 Экономия: 1200 руб.\n`;
        response += `└─ ⭐ Выгода: 21% скидка\n\n`;
        
        response += `**🎫 РАЗОВОЕ ПОСЕЩЕНИЕ**\n`;
        response += `└─ 🎫 1 занятие\n`;
        response += `└─ 💰 Цена: 700 руб.\n`;
        response += `└─ ⏰ Неограниченный срок\n`;
        
        response += `**💰 СПОСОБЫ ОПЛАТЫ:**\n`;
        response += `└─ 💰 Наличные на месте\n`;
        response += `└─ 🏦 Перевод на карту (Сбербанк, СПБ)\n`;
        
        response += `*Выберите для оплаты:*`;
        
        // Отправляем новое сообщение
        await ctx.reply(response, {
            format: 'markdown',
            attachments: [keyboard]
        });
        
        // Отвечаем на callback query
        try {
            await ctx.answerCallbackQuery({
                text: '💳 Открываю меню покупки...',
                show_alert: false
            });
        } catch (alertError) {
            logToFile(`ℹ️ Не удалось ответить на callback: ${alertError.message}`);
        }
        
    } catch (error) {
        logToFile(`❌ Ошибка кнопки покупки из ЛС: ${error.message}`);
        
        // Пробуем отправить сообщение об ошибке
        try {
            await ctx.reply(
                `❌ **ОШИБКА ПРИ ОТКРЫТИИ МЕНЮ ПОКУПКИ**\n\n` +
                `Пожалуйста, используйте команду /купить`,
                { format: 'markdown' }
            );
        } catch (sendError) {
            logToFile(`❌ Не удалось отправить сообщение об ошибке: ${sendError.message}`);
        }
    }
});

// ========== РЕДИРЕКТ СТАРЫХ КНОПОК ==========
bot.action('buy_monthly', async (ctx) => {
    try {
        await ctx.deleteMessage();
        
        // Перенаправляем на новую систему
        const fakeCtx = {
            ...ctx,
            callbackQuery: { data: 'buy_monthly_select' }
        };
        
        await ctx.reply(
            `**🔄 ПЕРЕХОД НА НОВУЮ СИСТЕМУ**\n\n` +
            `Открываю выбор способа оплаты для месячного абонемента...`,
            { format: 'markdown' }
        );
        
        await bot.action('buy_monthly_select').handler(fakeCtx);
        
    } catch (error) {
        logToFile(`❌ Ошибка редиректа buy_monthly: ${error.message}`);
    }
});

bot.action('buy_single', async (ctx) => {
    try {
        await ctx.deleteMessage();
        
        // Перенаправляем на новую систему
        const fakeCtx = {
            ...ctx,
            callbackQuery: { data: 'buy_single_select' }
        };
        
        await ctx.reply(
            `**🔄 ПЕРЕХОД НА НОВУЮ СИСТЕМУ**\n\n` +
            `Открываю выбор способа оплаты для разового абонемента...`,
            { format: 'markdown' }
        );
        
        await bot.action('buy_single_select').handler(fakeCtx);
        
    } catch (error) {
        logToFile(`❌ Ошибка редиректа buy_single: ${error.message}`);
    }
});

// ========== ОБРАБОТЧИКИ ПОЛЬЗОВАТЕЛЬСКОЙ ПАНЕЛИ ==========
// 1. МОИ АБОНЕМЕНТЫ
bot.action('user_subs', async (ctx) => {
    try {
        // Удаляем предыдущее сообщение
        try {
            await ctx.deleteMessage();
        } catch (deleteError) {
            logToFile(`⚠️ Не удалось удалить сообщение: ${deleteError.message}`);
        }
        
        const userId = getUserId(ctx);
        const userName = getUserName(ctx);
        
        const subscription = userSubscriptions[userId];
        const stats = userStats[userId] || updateUserStats(userId, userName, 'subs', null);
        
        const keyboard = Keyboard.inlineKeyboard([
            [
                Keyboard.button.callback('📅 Купить месячный', 'user_buy_monthly'),
                Keyboard.button.callback('🎫 Оплатить Разовое посещение', 'user_buy_single')
            ],
            [
                Keyboard.button.callback('📋 История покупок', 'user_subs_history'),
            ],
            [
                Keyboard.button.callback('« Назад в панель', 'user_back')
            ]
        ]);
        
        let response = `**🎫 МОИ АБОНЕМЕНТЫ**\n\n`;
        
        if (subscription) {
            const startDate = new Date(subscription.startDate);
            const endDate = new Date(startDate);
            endDate.setDate(startDate.getDate() + 30);
            const daysLeft = Math.max(0, Math.ceil((endDate - new Date()) / (1000 * 60 * 60 * 24)));
            const isExpired = new Date() > endDate;
            const isActive = subscription.lessons > 0 && !isExpired;
            
            // Прогресс-бар для месячного абонемента
            let progressBar = '';
            if (subscription.type === 'monthly') {
                const usedLessons = 8 - subscription.lessons;
                const progress = Math.round((usedLessons / 8) * 100);
                const barLength = 10;
                const filled = Math.round((progress / 100) * barLength);
                progressBar = '█'.repeat(filled) + '░'.repeat(barLength - filled);
            }
            
            response += `**✅ АКТИВНЫЙ АБОНЕМЕНТ**\n\n`;
            response += `📋 **Тип:** ${subscription.type === 'monthly' ? '📅 Месячный' : '🎫 Разовое посещение'}\n`;
            response += `🎫 **Осталось занятий:** ${subscription.lessons}\n`;
            
            if (subscription.type === 'monthly') {
                response += `📊 **Прогресс:** ${progressBar} ${Math.round((8 - subscription.lessons) / 8 * 100)}%\n`;
                response += `📅 **Использовано:** ${8 - subscription.lessons} из 8\n`;
            }
            
            response += `💰 **Стоимость:** ${subscription.cost} руб.\n`;
            response += `📅 **Начало:** ${startDate.toLocaleDateString('ru-RU')}\n`;
            response += `⏰ **Действует до:** ${endDate.toLocaleDateString('ru-RU')}\n`;
            response += `⌛ **Осталось дней:** ${daysLeft}\n`;
            response += `📊 **Статус:** ${isActive ? '✅ Активен' : isExpired ? '⏰ Истек' : '❌ Использован'}\n\n`;
            
            if (subscription.lastUsed) {
                response += `🔄 **Последнее использование:** ${new Date(subscription.lastUsed).toLocaleDateString('ru-RU')}\n\n`;
            }
            
            // Расчет экономии для месячного абонемента
            if (subscription.type === 'monthly' && subscription.lessons < 8) {
                const usedLessons = 8 - subscription.lessons;
                const costPerLesson = 4400 / 8;
                const saved = Math.round(usedLessons * (700 - costPerLesson));
                response += `💰 **Вы сэкономили:** ${saved} руб.\n`;
                response += `🎯 **Цена за занятие:** ${Math.round(costPerLesson)} руб. (вместо 700 руб.)\n\n`;
            }
            
        } else {
            response += `**❌ НЕТ АКТИВНОГО АБОНЕМЕНТА**\n\n`;
            response += `Для записи на тренировки необходим абонемент.\n\n`;
            response += `**🎯 ВЫГОДНЫЕ ПРЕДЛОЖЕНИЯ:**\n`;
            response += `📅 **Месячный абонемент:**\n`;
            response += `• 8 занятий за 30 дней\n`;
            response += `• Цена: 4400 руб.\n`;
            response += `• 🎯 Цена за занятие: 550 руб.\n`;
            response += `• 💰 Экономия: 1200 руб.\n\n`;
            
            response += `🎫 **Разовое посещение абонемент:**\n`;
            response += `• 1 занятие\n`;
            response += `• Цена: 700 руб.\n\n`;
            
            response += `**💡 РЕКОМЕНДАЦИЯ:**\n`;
            if (stats.attended >= 4) {
                response += `Вы посещаете регулярно - выгоднее взять месячный абонемент!\n`;
            } else {
                response += `Начните с разового абонемента!\n`;
            }
        }
        
        response += `*Выберите действие:*`;
        
        await ctx.reply(response, {
            format: 'markdown',
            attachments: [keyboard]
        });
        
    } catch (error) {
        logToFile(`❌ Ошибка user_subs: ${error.message}`);
    }
});

// 1.1 История покупок абонементов
bot.action('user_subs_history', async (ctx) => {
    try {
        // Удаляем предыдущее сообщение
        try {
            await ctx.deleteMessage();
        } catch (deleteError) {
            logToFile(`⚠️ Не удалось удалить сообщение: ${deleteError.message}`);
        }
        
        const userId = getUserId(ctx);
        const stats = userStats[userId];
        
        const keyboard = Keyboard.inlineKeyboard([
            [
                Keyboard.button.callback('« Назад к абонементам', 'user_subs')
            ]
        ]);
        
        let response = `**📋 ИСТОРИЯ ОПЛАТЫ**\n\n`;
        
        if (!stats || !stats.subscriptionHistory || stats.subscriptionHistory.length === 0) {
            response += `📭 **История покупок пуста**\n\n`;
            response += `У вас еще не было ОПЛАТЫ.\n`;
            
            await ctx.reply(response, {
                format: 'markdown',
                attachments: [keyboard]
            });
            return;
        }
        
        response += `Всего покупок: ${stats.subscriptionHistory.length}\n\n`;
        
        // Сортируем по дате (последние первыми) и берем только последние 3
        const sortedHistory = [...stats.subscriptionHistory]
            .sort((a, b) => new Date(b.date) - new Date(a.date))
            .slice(0, 3);
        
        sortedHistory.forEach((sub, index) => {
            const date = new Date(sub.date);
            const endDate = new Date(sub.startDate);
            endDate.setDate(endDate.getDate() + 30);
            
            response += `${index + 1}. **${date.toLocaleDateString('ru-RU')}**\n`;
            response += `   📋 Тип: ${sub.type === 'monthly' ? '📅 Месячный' : '🎫 Разовое посещение'}\n`;
            response += `   🎫 Занятий: ${sub.lessons}\n`;
            response += `   📅 Действовал до: ${endDate.toLocaleDateString('ru-RU')}\n\n`;
        });
        
        // Статистика по истории
        const monthlySubs = sortedHistory.filter(sub => sub.type === 'monthly').length;
        const singleSubs = sortedHistory.filter(sub => sub.type === 'single').length;
        const totalSpent = monthlySubs * 4400 + singleSubs * 700;
        
        response += `**📊 СТАТИСТИКА ПОКУПОК:**\n`;
        response += `📅 Месячных абонементов: ${stats.subscriptionHistory.filter(sub => sub.type === 'monthly').length}\n`;
        response += `🎫 Разовых абонементов: ${stats.subscriptionHistory.filter(sub => sub.type === 'single').length}\n`;
        response += `💰 Всего потрачено: ${totalSpent} руб.\n`;
        response += `📅 Последняя оплата: ${new Date(sortedHistory[0].date).toLocaleDateString('ru-RU')}\n`;
        
        if (stats.subscriptionHistory.length > 3) {
            response += `\n📌 *Показаны последние 3 покупки из ${stats.subscriptionHistory.length}*`;
        }
        
        await ctx.reply(response, {
            format: 'markdown',
            attachments: [keyboard]
        });
        
    } catch (error) {
        logToFile(`❌ Ошибка user_subs_history: ${error.message}`);
    }
});

// 2. МОЯ СТАТИСТИКА
bot.action('user_stats', async (ctx) => {
    try {
        // Удаляем предыдущее сообщение
        try {
            await ctx.deleteMessage();
        } catch (deleteError) {
            logToFile(`⚠️ Не удалось удалить сообщение: ${deleteError.message}`);
        }
        
        const userId = getUserId(ctx);
        const userName = getUserName(ctx);
        
        const stats = userStats[userId] || updateUserStats(userId, userName, 'stats', null);
        
        const keyboard = Keyboard.inlineKeyboard([
            [
                Keyboard.button.callback('🏆 Достижения', 'user_stats_achievements'),
                Keyboard.button.callback('📅 История посещений', 'user_stats_history')
            ],
            [
                Keyboard.button.callback('« Назад в панель', 'user_back')
            ]
        ]);
        
        // Рассчитываем показатели
        const attendanceRate = stats.totalTrainings > 0 
            ? Math.round((stats.attended / stats.totalTrainings) * 100) 
            : 0;
        
        // Статистика за 30 дней
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const recentHistory = stats.history.filter(h => 
            new Date(h.timestamp) > thirtyDaysAgo && h.action === 'yes'
        );
        const recentAttended = recentHistory.length;
        
        // Статистика за 7 дней
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() + 7);
        const weekHistory = stats.history.filter(h => 
            new Date(h.timestamp) > weekAgo && h.action === 'yes'
        );
        const weekAttended = weekHistory.length;
        
        // Расчет прогресса
        const progressLevel = Math.floor(stats.attended / 10);
        const progressToNextLevel = stats.attended % 10;
        
        let response = `**📊 МОЯ СТАТИСТИКА**\n\n`;
        
        response += `**🎯 ОБЩАЯ СТАТИСТИКА:**\n`;
        response += `└─ 📊 Всего тренировок: **${stats.totalTrainings}**\n`;
        response += `└─ ✅ Посетил: **${stats.attended}**\n`;
        response += `└─ ❌ Пропустил: **${stats.missed}**\n`;
        response += `└─ ❓ Не определился: **${stats.maybe}**\n`;
        response += `└─ 📈 Посещаемость: **${attendanceRate}%**\n\n`;
        
        response += `**📅 АКТИВНОСТЬ ПО ПЕРИОДАМ:**\n`;
        response += `└─ 🗓️ За 30 дней: **${recentAttended}** тренировок\n`;
        response += `└─ 📈 В неделю: **${Math.round(recentAttended / 4.3)}**\n`;
        response += `└─ 📅 За 7 дней: **${weekAttended}** тренировок\n\n`;
        
        // Прогресс-бар уровня
        response += `**🏆 УРОВЕНЬ ПРОГРЕССА:**\n`;
        response += `└─ 🎮 Уровень: ${progressLevel + 1}\n`;
        response += `└─ 🎯 До следующего уровня: ${10 - progressToNextLevel} тренировок\n`;
        
        const progressBar = '█'.repeat(progressToNextLevel) + '░'.repeat(10 - progressToNextLevel);
        response += `└─ 📊 Прогресс: ${progressBar} ${progressToNextLevel}/10\n\n`;
        
        // Рекомендации на основе статистики
        response += `**💡 ПЕРСОНАЛЬНЫЕ РЕКОМЕНДАЦИИ:**\n`;
        
        if (recentAttended >= 8) {
            response += `└─ 🏆 **Отличный результат!** Вы посещаете регулярно.\n`;
            response += `└─ 🎯 Продолжайте в том же темпе!\n`;
        } else if (recentAttended >= 4) {
            response += `└─ 👍 **Хорошая активность!**\n`;
            response += `└─ 🎯 Можно увеличить до 2-3 тренировок в неделю.\n`;
        } else if (recentAttended > 0) {
            response += `└─ 👌 **Начало положено!**\n`;
            response += `└─ 🎯 Старайтесь заниматься минимум 1 раз в неделю.\n`;
        } else {
            response += `└─ 🎯 **Пора начать!**\n`;
            response += `└─ 💪 Запишитесь на ближайшую тренировку!\n`;
        }
        
        if (attendanceRate < 50) {
            response += `└─ ⚠️ **Низкая посещаемость**\n`;
            response += `└─ 🎯 Старайтесь реже пропускать тренировки.\n`;
        }
        
        response += `\n**Выберите раздел статистики:**`;
        
        await ctx.reply(response, {
            format: 'markdown',
            attachments: [keyboard]
        });
        
    } catch (error) {
        logToFile(`❌ Ошибка user_stats: ${error.message}`);
    }
});

// 2.2 Достижения
bot.action('user_stats_achievements', async (ctx) => {
    try {
        // Удаляем предыдущее сообщение
        try {
            await ctx.deleteMessage();
        } catch (deleteError) {
            logToFile(`⚠️ Не удалось удалить сообщение: ${deleteError.message}`);
        }
        
        const userId = getUserId(ctx);
        const stats = userStats[userId];
        
        const keyboard = Keyboard.inlineKeyboard([
            [
                Keyboard.button.callback('« Назад к статистике', 'user_stats')
            ]
        ]);
        
        let response = `**🏆 МОИ ДОСТИЖЕНИЯ**\n\n`;
        
        if (!stats) {
            response += `📭 **Нет данных**\n\n`;
            response += `Начните заниматься, чтобы получить достижения!`;
            await ctx.reply(response, { format: 'markdown', attachments: [keyboard] });
            return;
        }
        
        const achievements = [];
        
        // Проверяем достижения
        if (stats.attended >= 1) {
            achievements.push({
                emoji: '🎯',
                name: 'Первая тренировка',
                description: 'Посетил первую тренировку',
                unlocked: true
            });
        }
        
        if (stats.attended >= 5) {
            achievements.push({
                emoji: '⭐',
                name: 'Новичок',
                description: 'Посетил 5 тренировок',
                unlocked: true
            });
        }
        
        if (stats.attended >= 10) {
            achievements.push({
                emoji: '🏆',
                name: 'Активный участник',
                description: 'Посетил 10 тренировок',
                unlocked: true
            });
        }
        
        if (stats.attended >= 25) {
            achievements.push({
                emoji: '👑',
                name: 'Ветеран',
                description: 'Посетил 25 тренировок',
                unlocked: stats.attended >= 25
            });
        }
        
        if (stats.attended >= 50) {
            achievements.push({
                emoji: '💎',
                name: 'Легенда',
                description: 'Посетил 50 тренировок',
                unlocked: stats.attended >= 50
            });
        }
        
        // Регулярность
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const recentAttended = stats.history.filter(h => 
            new Date(h.timestamp) > thirtyDaysAgo && h.action === 'yes'
        ).length;
        
        if (recentAttended >= 8) {
            achievements.push({
                emoji: '🔥',
                name: 'Супер активность',
                description: '8+ тренировок за месяц',
                unlocked: true
            });
        }
        
        if (stats.attended > 0 && stats.missed === 0) {
            achievements.push({
                emoji: '✅',
                name: 'Идеальная посещаемость',
                description: 'Ни разу не пропустил',
                unlocked: true
            });
        }
        
        // Отображаем достижения
        response += `**✅ РАЗБЛОКИРОВАННЫЕ:**\n\n`;
        
        const unlocked = achievements.filter(a => a.unlocked);
        if (unlocked.length === 0) {
            response += `🎯 **Пока нет достижений**\n`;
            response += `Начните тренироваться, чтобы получить первые достижения!\n\n`;
        } else {
            unlocked.forEach((ach, index) => {
                response += `${ach.emoji} **${ach.name}**\n`;
                response += `└─ ${ach.description}\n\n`;
            });
        }
        
        // Предстоящие достижения
        response += `**🎯 БУДУЩИЕ ДОСТИЖЕНИЯ:**\n\n`;
        
        if (stats.attended < 25) {
            const needed = 25 - stats.attended;
            response += `👑 **Ветеран** (25 тренировок)\n`;
            response += `└─ Осталось: ${needed} тренировок\n`;
            response += `└─ Прогресс: ${stats.attended}/25\n\n`;
        }
        
        if (stats.attended < 50) {
            const needed = 50 - stats.attended;
            response += `💎 **Легенда** (50 тренировок)\n`;
            response += `└─ Осталось: ${needed} тренировок\n`;
            response += `└─ Прогресс: ${stats.attended}/50\n\n`;
        }
        
        // Прогресс-бар общего прогресса
        const totalPossible = 50;
        const progressPercent = Math.min(100, Math.round((stats.attended / totalPossible) * 100));
        const progressBar = '█'.repeat(Math.round(progressPercent / 10)) + '░'.repeat(10 - Math.round(progressPercent / 10));
        
        response += `**📊 ОБЩИЙ ПРОГРЕСС:**\n`;
        response += `${progressBar} ${progressPercent}%\n`;
        response += `Достижений: ${unlocked.length}/${achievements.length}\n`;
        
        await ctx.reply(response, {
            format: 'markdown',
            attachments: [keyboard]
        });
        
    } catch (error) {
        logToFile(`❌ Ошибка user_stats_achievements: ${error.message}`);
    }
});

// 2.3 История посещений
bot.action('user_stats_history', async (ctx) => {
    try {
        // Удаляем предыдущее сообщение
        try {
            await ctx.deleteMessage();
        } catch (deleteError) {
            logToFile(`⚠️ Не удалось удалить сообщение: ${deleteError.message}`);
        }
        
        const userId = getUserId(ctx);
        const stats = userStats[userId];
        
        const keyboard = Keyboard.inlineKeyboard([
            [
                Keyboard.button.callback('« Назад к статистике', 'user_stats')
            ]
        ]);
        
        let response = `**📅 ИСТОРИЯ ПОСЕЩЕНИЙ**\n\n`;
        
        if (!stats || !stats.history || stats.history.length === 0) {
            response += `📭 **История пуста**\n\n`;
            response += `У вас еще нет посещений.\n`;
            response += `Запишитесь на первую тренировку!`;
            
            await ctx.reply(response, {
                format: 'markdown',
                attachments: [keyboard]
            });
            return;
        }
        
        // Фильтруем только посещения
        const visits = stats.history
            .filter(h => h.action === 'yes')
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        
        response += `Всего посещений: ${visits.length}\n\n`;
        
        // Группируем по месяцам
        const visitsByMonth = {};
        visits.forEach(visit => {
            const date = new Date(visit.timestamp);
            const monthYear = `${date.getMonth() + 1}.${date.getFullYear()}`;
            const monthName = date.toLocaleDateString('ru-RU', { 
                month: 'long', 
                year: 'numeric' 
            });
            
            if (!visitsByMonth[monthYear]) {
                visitsByMonth[monthYear] = {
                    name: monthName,
                    visits: 0,
                    dates: []
                };
            }
            
            visitsByMonth[monthYear].visits++;
            visitsByMonth[monthYear].dates.push(date);
        });
        
        // Сортируем месяцы (последние первыми)
        const sortedMonths = Object.entries(visitsByMonth)
            .sort((a, b) => {
                const [monthA, yearA] = a[0].split('.').map(Number);
                const [monthB, yearB] = b[0].split('.').map(Number);
                return (yearB * 12 + monthB) - (yearA * 12 + monthA);
            })
            .slice(0, 6);
        
        if (sortedMonths.length === 0) {
            response += `📭 **Нет данных о посещениях**\n`;
            await ctx.reply(response, { format: 'markdown', attachments: [keyboard] });
            return;
        }
        
        sortedMonths.forEach(([_, data]) => {
            response += `**${data.name}:**\n`;
            response += `└─ 🎯 Посещений: ${data.visits}\n`;
            
            // Показываем даты для последнего месяца
            if (sortedMonths[0][1] === data && data.dates.length > 0) {
                const recentDates = data.dates
                    .sort((a, b) => b - a)
                    .slice(0, 5)
                    .map(d => d.toLocaleDateString('ru-RU'));
                
                if (recentDates.length > 0) {
                    response += `└─ 📅 Даты: ${recentDates.join(', ')}\n`;
                }
            }
            response += `\n`;
        });
        
        // График активности
        const months = sortedMonths.map(([_, data]) => data.name.split(' ')[0].substring(0, 3));
        const visitCounts = sortedMonths.map(([_, data]) => data.visits);
        const maxVisits = Math.max(...visitCounts, 1);
        
        response += `**📈 АКТИВНОСТЬ ПО МЕСЯЦАМ:**\n`;
        sortedMonths.forEach(([_, data], index) => {
            const barLength = Math.round((data.visits / maxVisits) * 12);
            const bar = '█'.repeat(barLength) + '░'.repeat(12 - barLength);
            response += `${months[index]}: ${bar} ${data.visits}\n`;
        });
        
        response += `\n**📊 СТАТИСТИКА:**\n`;
        response += `└─ 🏆 Самое активное посещение: ${Math.max(...visitCounts)} раз\n`;
        response += `└─ 📅 Первое посещение: ${new Date(visits[visits.length - 1].timestamp).toLocaleDateString('ru-RU')}\n`;
        response += `└─ 🔄 Последнее посещение: ${new Date(visits[0].timestamp).toLocaleDateString('ru-RU')}\n`;
        
        await ctx.reply(response, {
            format: 'markdown',
            attachments: [keyboard]
        });
        
    } catch (error) {
        logToFile(`❌ Ошибка user_stats_history: ${error.message}`);
    }
});

// 3. РАСПИСАНИЕ
bot.action('user_schedule', async (ctx) => {
    try {
        const userId = getUserId(ctx);
        
        const keyboard = Keyboard.inlineKeyboard([
            [
                Keyboard.button.callback('✅ Записаться', 'user_schedule_enroll'),
            ],
            [
                Keyboard.button.callback('🎯 Мои записи', 'user_schedule_my'),
            ],
            [
                Keyboard.button.callback('« Назад в панель', 'user_back')
            ]
        ]);
        
        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowStr = tomorrow.toISOString().split('T')[0];
        
        // Определяем день недели
        const dayOfWeek = today.getDay();
        const days = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
        const dayName = days[dayOfWeek];
        
        // Проверяем, есть ли сегодня тренировка
        const isTrainingDay = dayOfWeek === 1 || dayOfWeek === 3;
        
        let response = `**📅 РАСПИСАНИЕ ТРЕНИРОВОК**\n\n`;
        
        response += `**📅 СЕГОДНЯ (${dayName}, ${today.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}):**\n`;
        
        if (isTrainingDay) {
            response += `└─ 🎯 ВИИТ тренировка\n`;
            response += `└─ 📍 мкр. Заря\n`;
            response += `└─ ⏰ 20:00\n`;
            response += `└─ 🎫 Мест: 10\n\n`;
            
            // Проверяем записан ли пользователь на сегодня
            const todayPoll = dailyPolls[todayStr] || { yes: [], no: [], maybe: [] };
            const isEnrolled = todayPoll.yes && todayPoll.yes.includes(getUserName(ctx));
            
            response += `**📊 СТАТУС НА СЕГОДНЯ:**\n`;
            response += `└─ 🎯 ${isEnrolled ? '✅ Вы записаны' : '❌ Вы не записаны'}\n`;
            response += `└─ 👥 Всего записей: ${(todayPoll.yes ? todayPoll.yes.length : 0) + (todayPoll.maybe ? todayPoll.maybe.length : 0)}\n\n`;
        } else {
            response += `└─ 🚫 **Сегодня тренировок нет**\n`;
            response += `└─ 📅 Следующая тренировка: ${getNextTrainingDay(today)}\n\n`;
        }
        
        // Показываем завтрашний день только если он тренировочный
        const tomorrowDayOfWeek = tomorrow.getDay();
        const isTomorrowTrainingDay = tomorrowDayOfWeek === 1 || tomorrowDayOfWeek === 3;
        
        if (isTomorrowTrainingDay) {
            response += `**📅 ЗАВТРА (${tomorrow.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}):**\n`;
            response += `└─ 🎯 ВИИТ тренировка\n`;
            response += `└─ 📍 мкр. Заря\n`;
            response += `└─ ⏰ 20:00\n\n`;
        }
        
        response += `**💡 РЕКОМЕНДАЦИИ:**\n`;
        response += `└─ 🎯 ${isTrainingDay ? 'Лучше записываться заранее' : 'Запишитесь на следующую тренировку заранее'}\n`;
        response += `└─ ⏰ Приходите за 10-15 минут до начала\n`;
        response += `└─ 💧 Не забудьте воду и полотенце\n`;
        
        response += `\n*Выберите действие:*`;
        
        await ctx.reply(response, {
            format: 'markdown',
            attachments: [keyboard]
        });
        await ctx.deleteMessage();
        
    } catch (error) {
        logToFile(`❌ Ошибка user_schedule: ${error.message}`);
    }
});

// 3.1 Записаться на тренировку
bot.action('user_schedule_enroll', async (ctx) => {
    try {
        const userId = getUserId(ctx);
        const userName = getUserName(ctx);
        
        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];
        
        // Проверяем, есть ли сегодня тренировка
        const dayOfWeek = today.getDay();
        const isTrainingDay = dayOfWeek === 1 || dayOfWeek === 3;
        
        if (!isTrainingDay) {
            const days = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
            const dayName = days[dayOfWeek];
            
            // Находим следующий тренировочный день
            let nextTrainingDate = new Date(today);
            nextTrainingDate.setDate(nextTrainingDate.getDate() + 1);
            
            while (!(nextTrainingDate.getDay() === 1 || nextTrainingDate.getDay() === 3)) {
                nextTrainingDate.setDate(nextTrainingDate.getDate() + 1);
            }
            
            const nextDayName = days[nextTrainingDate.getDay()];
            const nextDateFormatted = nextTrainingDate.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
            
            await ctx.reply(
                `**📅 СЕГОДНЯ ТРЕНИРОВОК НЕТ**\n\n` +
                `Сегодня **${dayName}, ${today.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}** тренировки не проводятся.\n\n` +
                `**📅 БЛИЖАЙШАЯ ТРЕНИРОВКА:**\n` +
                `└─ ${nextDateFormatted}\n` +
                `**💡 РЕКОМЕНДАЦИЯ:**\n` +
                `Запишитесь на ближайшую тренировку!`,
                { format: 'markdown' }
            );
            await ctx.deleteMessage();
            return;
        }
        
        // Если сегодня тренировочный день - продолжаем обычную логику
        const todayPoll = dailyPolls[todayStr] || { yes: [], no: [], maybe: [] };
        const isEnrolled = todayPoll.yes && todayPoll.yes.includes(userName);
        
        if (isEnrolled) {
            await ctx.reply(
                `**📋 ВЫ УЖЕ ЗАПИСАНЫ НА СЕГОДНЯ!**\n\n` +
                `**Детали записи:**\n` +
                `└─ 📅 Дата: ${new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}\n` +
                `**📊 СТАТУС ОПРОСА:**\n` +
                `└─ ✅ Идут: ${todayPoll.yes ? todayPoll.yes.length : 0}\n` +
                `└─ ❓ Возможно: ${todayPoll.maybe ? todayPoll.maybe.length : 0}\n\n` +
                `**Чтобы отменить запись, используйте:**\n/отменить`,
                { format: 'markdown' }
            );
            await ctx.deleteMessage();
            return;
        }
        
        // Проверяем абонемент БЕЗ списания занятия
        const checkResult = checkSubscription(userId, 'yes', false);
        
        if (!checkResult.isValid) {
            await ctx.reply(
                `**❌ НЕВОЗМОЖНО ЗАПИСАТЬСЯ**\n\n` +
                `${checkResult.message}\n\n` +
                `**💡 РЕКОМЕНДАЦИИ:**\n` +
                `1. Приобретите абонемент через /купить\n` +
                `2. Или оплатите разовое посещение на месте\n\n` +
                `*После покупки абонемента вернитесь для записи.*`,
                { format: 'markdown' }
            );
            await ctx.deleteMessage();
            return;
        }
        
        const keyboard = Keyboard.inlineKeyboard([
            [
                Keyboard.button.callback('✅ Да, записаться', 'user_enroll_confirm'),
                Keyboard.button.callback('❌ Нет, отменить', 'user_schedule')
            ]
        ]);
        
        const response = `**✅ ЗАПИСЬ НА ТРЕНИРОВКУ**\n\n` +
            `**📅 ДЕТАЛИ ТРЕНИРОВКИ:**\n` +
            `└─ 📅 Дата: ${new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}\n` +
            `└─ 🎯 Тип: ВИИТ тренировка\n` +
            `└─ 📍 Место: мкр. Заря\n` +
            `└─ ⏰ Время: 20:00\n\n` +
            `**💳 СТАТУС АБОНЕМЕНТА:**\n` +
            `└─ ${checkResult.message}\n\n` +
            `**📊 СТАТУС ОПРОСА:**\n` +
            `└─ ✅ Идут: ${todayPoll.yes ? todayPoll.yes.length : 0}\n` +
            `└─ ❓ Возможно: ${todayPoll.maybe ? todayPoll.maybe.length : 0}\n\n` +
            `*Вы уверены, что хотите записаться?*\n` +
            `После записи с вашего абонемента спишется одно занятие.`;
        
        await ctx.reply(response, {
            format: 'markdown',
            attachments: [keyboard]
        });
        await ctx.deleteMessage();
        
    } catch (error) {
        logToFile(`❌ Ошибка user_schedule_enroll: ${error.message}`);
    }
});

// 3.2 Подтверждение записи
bot.action('user_enroll_confirm', async (ctx) => {
    try {
        // Используем существующую функцию записи
        await handlePollResponse(ctx, 'yes');
        
    } catch (error) {
        logToFile(`❌ Ошибка user_enroll_confirm: ${error.message}`);
    }
});

// 3.3 Мои записи
bot.action('user_schedule_my', async (ctx) => {
    try {
        // Удаляем предыдущее сообщение
        try {
            await ctx.deleteMessage();
        } catch (deleteError) {
            logToFile(`⚠️ Не удалось удалить сообщение: ${deleteError.message}`);
        }
        
        const userId = getUserId(ctx);
        const userName = getUserName(ctx);
        const stats = userStats[userId];
        
        const keyboard = Keyboard.inlineKeyboard([
            [
                Keyboard.button.callback('« Назад к расписанию', 'user_schedule')
            ]
        ]);
        
        let response = `**📅 МОИ ЗАПИСИ**\n\n`;
        
        if (!stats || !stats.history || stats.history.length === 0) {
            response += `📭 **Записей нет**\n\n`;
            response += `У вас еще нет записей на тренировки.\n`;
            response += `Запишитесь на ближайшую тренировку!`;
            
            await ctx.reply(response, {
                format: 'markdown',
                attachments: [keyboard]
            });
            return;
        }
        
        // Получаем будущие записи (сегодня и позже)
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const futureEnrollments = stats.history
            .filter(h => {
                if (h.action !== 'yes') return false;
                
                const visitDate = new Date(h.timestamp);
                visitDate.setHours(0, 0, 0, 0);
                
                // Проверяем, что дата сегодня или позже
                return visitDate >= today;
            })
            .filter((h, index, self) => {
                // Убираем дубликаты по дате
                const visitDate = new Date(h.timestamp).toDateString();
                return self.findIndex(item => 
                    new Date(item.timestamp).toDateString() === visitDate
                ) === index;
            })
            .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        
        // Прошедшие записи (последние 2)
        const pastEnrollments = stats.history
            .filter(h => {
                const visitDate = new Date(h.timestamp);
                return visitDate < today && h.action === 'yes';
            })
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
            .slice(0, 2);
        
        if (pastEnrollments.length > 0) {
            response += `**📅 ПРОШЕДШИЕ ТРЕНИРОВКИ:**\n\n`;
            
            pastEnrollments.forEach((enrollment, index) => {
                const date = new Date(enrollment.timestamp);
                response += `${index + 1}. ${date.toLocaleDateString('ru-RU')}\n`;
            });
            response += `\n`;
        }
        
        // Статистика записей
        const totalEnrollments = stats.history.filter(h => h.action === 'yes').length;
        const todayEnrollments = stats.history.filter(h => {
            const visitDate = new Date(h.timestamp);
            return visitDate.toDateString() === new Date().toDateString() && h.action === 'yes';
        }).length;
        
        response += `**📊 СТАТИСТИКА ЗАПИСЕЙ:**\n`;
        response += `└─ 🎯 Всего записей: ${totalEnrollments}\n`;
        response += `└─ 📅 Записей на сегодня: ${todayEnrollments}\n`;
        response += `└─ 📅 Будущих записей: ${futureEnrollments.length}\n\n`;
        
        response += `**💡 СОВЕТЫ:**\n`;
        response += `└─ 🎯 Записывайтесь заранее\n`;
        response += `└─ 🔄 Регулярно проверяйте расписание\n`;
        response += `└─ ⏰ Отменяйте запись если не сможете прийти\n`;
        
        await ctx.reply(response, {
            format: 'markdown',
            attachments: [keyboard]
        });
        
    } catch (error) {
        logToFile(`❌ Ошибка user_schedule_my: ${error.message}`);
    }
});

// 4. ПОКУПКА АБОНЕМЕНТА
bot.action('user_buy', async (ctx) => {
    try {
        // Удаляем предыдущее сообщение
        try {
            await ctx.deleteMessage();
        } catch (deleteError) {
            logToFile(`⚠️ Не удалось удалить сообщение: ${deleteError.message}`);
        }
        
        const userId = getUserId(ctx);
        const subscription = userSubscriptions[userId];
        
        const keyboard = Keyboard.inlineKeyboard([
            [
                Keyboard.button.callback('📅 8 зан/мес (4400 руб.)', 'buy_monthly_select'),
                Keyboard.button.callback('🎫 Разовое посещение (700 руб.)', 'buy_single_select')
            ],
            
            [
                Keyboard.button.callback('« Назад в панель', 'user_back')
            ]
        ]);
        
        let response = `**💳 ОПЛАТА**\n\n`;
        
        if (subscription) {
            response += `**✅ У ВАС ЕСТЬ АКТИВНЫЙ АБОНЕМЕНТ**\n\n`;
            response += `Тип: ${subscription.type === 'monthly' ? '📅 Месячный' : '🎫 Разовое посещение'}\n`;
            response += `Осталось занятий: ${subscription.lessons}\n\n`;
        }
                
        response += `**📅 МЕСЯЧНЫЙ АБОНЕМЕНТ**\n`;
        response += `└─ 🎫 8 занятий за 30 дней\n`;
        response += `└─ 💰 Цена: 4400 руб.\n`;
        response += `└─ 🎯 Цена за занятие: 550 руб.\n`;
        response += `└─ 💰 Экономия: 1200 руб.\n`;
        response += `└─ ⭐ Выгода: 21% скидка\n\n`;
        
        response += `**🎫 РАЗОВОЕ ПОСЕЩЕНИЕ**\n`;
        response += `└─ 🎫 1 занятие\n`;
        response += `└─ 💰 Цена: 700 руб.\n`;
        response += `└─ ⏰ Неограниченный срок\n`;
        
        response += `**💰 СПОСОБЫ ОПЛАТЫ:**\n`;
        response += `└─ 💰 Наличные на месте\n`;
        response += `└─ 🏦 Перевод на карту (Сбербанк, СПБ)\n`;
        
        response += `*Выберите для оплаты:*`;
        
        await ctx.reply(response, {
            format: 'markdown',
            attachments: [keyboard]
        });
        
    } catch (error) {
        logToFile(`❌ Ошибка user_buy: ${error.message}`);
    }
});



// 5. ПОМОЩЬ (только команды)
bot.action('user_help', async (ctx) => {
    try {
        // Удаляем предыдущее сообщение
        try {
            await ctx.deleteMessage();
        } catch (deleteError) {
            logToFile(`⚠️ Не удалось удалить сообщение: ${deleteError.message}`);
        }
        
        const keyboard = Keyboard.inlineKeyboard([
            [
                Keyboard.button.callback('📋 Все команды', 'user_help_commands'),
            ],
            [
                Keyboard.button.callback('« Назад в панель', 'user_back')
            ]
        ]);
        
        let response = `**❓ ПОМОЩЬ**\n\n`;
        
        response += `**🎯 ОСНОВНЫЕ ВОЗМОЖНОСТИ:**\n`;
        response += `└─ 📅 Запись на тренировки\n`;
        response += `└─ 💳 Покупка абонементов\n`;
        response += `└─ 📊 Ваша статистика\n\n`;
        
        response += `**🚀 КАК НАЧАТЬ:**\n`;
        response += `1. Используйте /мойкабинет для личного кабинета\n`;
        response += `2. Купите абонемент через /купить\n`;
        response += `3. Запишитесь на тренировку через /записаться\n\n`;
        
        response += `**📋 Все команды доступны по кнопке ниже:**`;
        
        await ctx.reply(response, {
            format: 'markdown',
            attachments: [keyboard]
        });
        
    } catch (error) {
        logToFile(`❌ Ошибка user_help: ${error.message}`);
    }
});

// 5.1 Команды
bot.action('user_help_commands', async (ctx) => {
    try {
        // Удаляем предыдущее сообщение
        try {
            await ctx.deleteMessage();
        } catch (deleteError) {
            logToFile(`⚠️ Не удалось удалить сообщение: ${deleteError.message}`);
        }
        
        const keyboard = Keyboard.inlineKeyboard([
            [
                Keyboard.button.callback('« Назад к помощи', 'user_help')
            ]
        ]);
        
        let response = `**📋 КОМАНДЫ БОТА**\n\n`;
        
        response += `**🏠 ОСНОВНЫЕ КОМАНДЫ:**\n`;
        response += `└─ /старт - начать работу с ботом\n`;
        response += `└─ /мойкабинет - ваш личный кабинет\n`;
        response += `└─ /помощь - показать это сообщение\n\n`;
        
        response += `**📊 СТАТИСТИКА:**\n`;
        response += `└─ /моя_статистика - ваша статистика\n`;
        response += `└─ /история - история посещений\n\n`;
        
        response += `**💳 АБОНЕМЕНТЫ:**\n`;
        response += `└─ /абонемент - информация об абонементе\n`;
        response += `└─ /моиабонементы - ваши абонементы\n`;
        response += `└─ /купить - купить абонемент\n\n`;
        
        response += `**🎯 В ОПРОСЕ:**\n`;
        response += `└─ ✅ Приду - запись на тренировку\n`;
        response += `└─ ❌ Не приду - отметка отсутствия\n`;
        response += `└─ ❓ Возможно - пока не решили\n`;
        response += `└─ ↩️ Отменить - удалить голос\n`;
        response += `└─ 👤 Мой кабинет - открыть панель (в ЛС)\n`;
        response += `└─ ℹ️ Помощь - справка по опросу (в ЛС)\n\n`;
        
        response += `**💡 СОВЕТЫ:**\n`;
        response += `└─ Все команды автоматически удаляются\n`;
        response += `└─ Используйте кнопки в группе для голосования\n`;
        response += `└─ Личный кабинет работает только в ЛС\n`;
        
        await ctx.reply(response, {
            format: 'markdown',
            attachments: [keyboard]
        });
        
    } catch (error) {
        logToFile(`❌ Ошибка user_help_commands: ${error.message}`);
    }
});

// КНОПКА НАЗАД В ГЛАВНУЮ ПАНЕЛЬ
bot.action('user_back', async (ctx) => {
    try {
        await showUserPanel(ctx);
    } catch (error) {
        logToFile(`❌ Ошибка user_back: ${error.message}`);
        await ctx.reply('Произошла ошибка при возврате в панель', { format: 'markdown' });
    }
});

// ========== КОМАНДЫ ДЛЯ ПОКУПКИ АБОНЕМЕНТОВ ==========
// Покупка месячного абонемента (из панели)
bot.action('user_buy_monthly', async (ctx) => {
    try {
        const userId = getUserId(ctx);
        const userName = getUserName(ctx);
        
        const keyboard = Keyboard.inlineKeyboard([
            [
                Keyboard.button.callback('✅ Да, покупаю', 'confirm_buy_monthly'),
                Keyboard.button.callback('❌ Нет, передумал', 'user_buy')
            ]
        ]);
        
        await ctx.reply(
            `**📅 ПОКУПКА МЕСЯЧНОГО АБОНЕМЕНТА**\n\n` +
            `**📋 ДЕТАЛИ АБОНЕМЕНТА:**\n` +
            `└─ 🎫 8 занятий за 30 дней\n` +
            `└─ 💰 Цена: 4400 руб.\n` +
            `└─ 🎯 Цена за занятие: 550 руб.\n` +
            `└─ 💰 Экономия: 1200 руб.\n` +
            `└─ ⭐ Выгода: 21% скидка\n\n` +
            
            `**💰 СПОСОБЫ ОПЛАТЫ:**\n` +
            `1. 💳 Наличные на месте\n` +
            `2. 🏦 Перевод на карту\n` +
            
            `**📞 ДЛЯ ОПЛАТЫ:**\n` +
            `Свяжитесь с администратором:\n` +
            `└─ 📱 +7 (925) 225-13-36\n` +
            
            `**✅ ПОСЛЕ ОПЛАТЫ:**\n` +
            `1. Сообщите администратору\n` +
            `2. Абонемент будет активирован\n` +
            `3. Начнется отсчет 30 дней\n` +
            `4. Можно записываться на тренировки!\n\n` +
            
            `**Вы подтверждаете покупку месячного абонемента?**`,
            {
                format: 'markdown',
                attachments: [keyboard]
            }
        );
        await ctx.deleteMessage();
        
    } catch (error) {
        logToFile(`❌ Ошибка user_buy_monthly: ${error.message}`);
    }
});

// Подтверждение покупки месячного абонемента
bot.action('confirm_buy_monthly', async (ctx) => {
    try {
        const userId = getUserId(ctx);
        const userName = getUserName(ctx);
        
        // Добавляем абонемент
        userSubscriptions[userId] = {
            type: 'monthly',
            lessons: 8,
            cost: 4400,
            startDate: new Date().toISOString(),
            lastUsed: null
        };
        
        saveSubscriptions();
        
        // Обновляем статистику
        const stats = userStats[userId] || updateUserStats(userId, userName, 'buy_monthly', null);
        if (!stats.subscriptionHistory) {
            stats.subscriptionHistory = [];
        }
        stats.subscriptionHistory.push({
            date: new Date().toISOString(),
            type: 'monthly',
            lessons: 8,
            startDate: new Date().toISOString(),
            lastUsed: null
        });
        saveUserStats();
        
        const keyboard = Keyboard.inlineKeyboard([
            [
                Keyboard.button.callback('✅ Записаться на тренировку', 'user_schedule_enroll'),
                Keyboard.button.callback('📊 Моя статистика', 'user_stats')
            ],
            [
                Keyboard.button.callback('🎫 Мои абонементы', 'user_subs')
            ]
        ]);
        
        await ctx.reply(
            `**✅ АБОНЕМЕНТ УСПЕШНО ОФОРМЛЕН!**\n\n` +
            `**📋 ДЕТАЛИ АБОНЕМЕНТА:**\n` +
            `└─ 📅 Тип: Месячный абонемент\n` +
            `└─ 🎫 Занятий: 8\n` +
            `└─ 💰 Стоимость: 4400 руб.\n` +
            `└─ 📅 Дата начала: ${new Date().toLocaleDateString('ru-RU')}\n` +
            `└─ ⏰ Действует до: ${new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString('ru-RU')}\n` +
            `└─ 🎯 Цена за занятие: 550 руб.\n\n` +
            
            `**💰 ВАША ВЫГОДА:**\n` +
            `└─ 🎫 8 занятий по 550 руб. вместо 700 руб.\n` +
            `└─ 💰 Экономия: 1200 руб.\n` +
            `└─ ⭐ Скидка: 21%\n\n` +
            
            `**🎯 ЧТО ДАЛЬШЕ:**\n` +
            `1. Запишитесь на ближайшую тренировку\n` +
            `2. Приходите за 10-15 минут до начала\n` +
            `3. Возьмите с собой воду и полотенце\n` +
            `4. Наслаждайтесь тренировкой!\n\n` +
            
            `**💪 УДАЧНЫХ ТРЕНИРОВОК!**`,
            {
                format: 'markdown',
                attachments: [keyboard]
            }
        );
        
        logToFile(`✅ Пользователь ${userName} (${userId}) купил месячный абонемент`);
        
    } catch (error) {
        logToFile(`❌ Ошибка confirm_buy_monthly: ${error.message}`);
    }
});

// Покупка разового абонемента (из панели)
bot.action('user_buy_single', async (ctx) => {
    try {
        const userId = getUserId(ctx);
        const userName = getUserName(ctx);
        
        const keyboard = Keyboard.inlineKeyboard([
            [
                Keyboard.button.callback('✅ Да, покупаю', 'confirm_buy_single'),
                Keyboard.button.callback('❌ Нет, передумал', 'user_buy')
            ]
        ]);
        
        await ctx.reply(
            `**🎫 ОПЛАТА РАЗОВОГО ПОСЕЩЕНИЯ**\n\n` +
            `**📋 ДЕТАЛИ:**\n` +
            `└─ 🎫 1 занятие\n` +
            `└─ 💰 Цена: 700 руб.\n` +
            `└─ ⏰ Неограниченный срок\n` +
            
            `**💰 СПОСОБЫ ОПЛАТЫ:**\n` +
            `1. 💳 Наличные на месте\n` +
            `2. 🏦 Перевод на карту\n` +
            
            `**📞 ДЛЯ ОПЛАТЫ:**\n` +
            `Свяжитесь с администратором:\n` +
            `└─ 📱 +7 (925) 225-13-36\n` +
            
            `**💡 КОГДА ВЫБРАТЬ Разовое посещение:**\n` +
            `✅ Если впервые на тренировке\n` +
            `✅ Если ходите редко (1 раз в неделю)\n` +
            `✅ Если не уверены в регулярности\n` +
            
            `**✅ ПОСЛЕ ОПЛАТЫ:**\n` +
            `1. Абонемент будет активирован\n` +
            `2. Можно записаться на тренировку!\n\n` +
            
            `*Вы подтверждаете оплату разового посещения?*`,
            {
                format: 'markdown',
                attachments: [keyboard]
            }
        );
        await ctx.deleteMessage();
        
    } catch (error) {
        logToFile(`❌ Ошибка user_buy_single: ${error.message}`);
    }
});

// Подтверждение покупки разового абонемента
bot.action('confirm_buy_single', async (ctx) => {
    try {
        const userId = getUserId(ctx);
        const userName = getUserName(ctx);
        
        // Добавляем абонемент
        userSubscriptions[userId] = {
            type: 'single',
            lessons: 1,
            cost: 700,
            startDate: new Date().toISOString(),
            lastUsed: null
        };
        
        saveSubscriptions();
        
        // Обновляем статистику
        const stats = userStats[userId] || updateUserStats(userId, userName, 'buy_single', null);
        if (!stats.subscriptionHistory) {
            stats.subscriptionHistory = [];
        }
        stats.subscriptionHistory.push({
            date: new Date().toISOString(),
            type: 'single',
            lessons: 1,
            startDate: new Date().toISOString(),
            lastUsed: null
        });
        saveUserStats();
        
        const keyboard = Keyboard.inlineKeyboard([
            [
                Keyboard.button.callback('✅ Записаться на тренировку', 'user_schedule_enroll'),
                Keyboard.button.callback('📊 Моя статистика', 'user_stats')
            ],
            [
                Keyboard.button.callback('🎫 Мои абонементы', 'user_subs')
            ]
        ]);
        
        const response = `**✅ АБОНЕМЕНТ УСПЕШНО ОФОРМЛЕН!**\n\n` +
            `*📋 ДЕТАЛИ:*\n` +
            `└─ 🎫 Тип: Разовое посещение\n` +
            `└─ 🎫 Занятий: 1\n` +
            `└─ 💰 Стоимость: 700 руб.\n` +
            `└─ 📅 Дата покупки: ${new Date().toLocaleDateString('ru-RU')}\n` +
            `└─ ⏰ Срок: Неограниченный\n\n` +
                        
            `*🎯 ДЛЯ ТРЕНИРОВКИ:*\n` +
            `1. 🕐 Приходите за 10-15 минут до начала\n` +
            `2. 💧 Возьмите бутылку воды\n` +
            `3. 👕 Наденьте удобную спортивную форму\n` +
            `4. 🧻 Полотенце будет полезно\n\n` +
            
            `**💪 НА САМОЙ ТРЕНИРОВКЕ:**\n` +
            `1. 🐢 Начинайте с умеренной интенсивности\n` +
            `2. 👂 Слушайте свое тело\n` +
            `3. 🎯 Следуйте указаниям тренера\n` +
            `4. 😊 Получайте удовольствие!\n\n` +
            
            `**📅 ЧТО ДАЛЬШЕ:**\n` +
            `1. Запишитесь на тренировку\n` +
            `2. Начните регулярно тренироваться\n` +
            `3. Достигайте своих целей!\n\n` +
            
            `**💪 УДАЧНОЙ ТРЕНИРОВКИ!**`;

        await ctx.reply(response, {
            format: 'markdown',
            attachments: [keyboard]
        });
        
        logToFile(`✅ Пользователь ${userName} (${userId}) купил Разовое посещение абонемент`);
        
    } catch (error) {
        logToFile(`❌ Ошибка confirm_buy_single: ${error.message}`);
    }
});

// Выбор месячного абонемента с последующим выбором оплаты
bot.action('buy_monthly_select', async (ctx) => {
    try {
        await ctx.deleteMessage();
        
        const keyboard = createPaymentMethodKeyboard('monthly');
        
        await ctx.reply(
            `**📅 ВЫБОР СПОСОБА ОПЛАТЫ**\n\n` +
            `**📋 ДЕТАЛИ ЗАКАЗА:**\n` +
            `└─ Тип: Месячный абонемент\n` +
            `└─ Занятий: 8\n` +
            `└─ Срок: 30 дней\n` +
            `└─ Цена: 4400 руб.\n` +
            `└─ Цена за занятие: 550 руб.\n\n` +
            
            `**💰 ДОСТУПНЫЕ СПОСОБЫ ОПЛАТЫ:**\n` +
            `1. 💰 **Наличные** - оплата на месте перед тренировкой\n` +
            `2. 🏦 **Банковский перевод** - через Сбербанк или СПБ\n` +
            
            `*Выберите способ оплаты:*`,
            {
                format: 'markdown',
                attachments: [keyboard]
            }
        );
        
    } catch (error) {
        logToFile(`❌ Ошибка buy_monthly_select: ${error.message}`);
    }
});

// Выбор разового абонемента с последующим выбором оплаты
bot.action('buy_single_select', async (ctx) => {
    try {
        await ctx.deleteMessage();
        
        const keyboard = createPaymentMethodKeyboard('single');
        
        await ctx.reply(
            `**🎫 ВЫБОР СПОСОБА ОПЛАТЫ**\n\n` +
            `**📋 ДЕТАЛИ ЗАКАЗА:**\n` +
            `└─ Тип: Разовое посещение\n` +
            `└─ Занятий: 1\n` +
            `└─ Срок: Неограниченный\n` +
            `└─ Цена: 700 руб.\n\n` +
            
            `**💰 ДОСТУПНЫЕ СПОСОБЫ ОПЛАТЫ:**\n` +
            `1. 💰 **Наличные** - оплата на месте перед тренировкой\n` +
            `2. 🏦 **Банковский перевод** - через Сбербанк или СПБ\n` +
            
            `*Выберите способ оплаты:*`,
            {
                format: 'markdown',
                attachments: [keyboard]
            }
        );
        
    } catch (error) {
        logToFile(`❌ Ошибка buy_single_select: ${error.message}`);
    }
});

// Оплата наличными
bot.action(/^pay_cash_(monthly|single)$/, async (ctx) => {
    try {
        const subscriptionType = ctx.match[1];
        const userId = getUserId(ctx);
        const userName = getUserName(ctx);
        
        await ctx.deleteMessage();
        
        const amount = subscriptionType === 'monthly' ? 4400 : 700;
        const lessons = subscriptionType === 'monthly' ? 8 : 1;
        const subscriptionName = subscriptionType === 'monthly' ? 'Месячный' : 'Разовое посещение';
        
        // Создаем запись о платеже
        const paymentId = `cash_${Date.now()}_${userId}`;
        pendingPayments[paymentId] = {
            userId,
            userName,
            subscriptionType,
            amount,
            lessons,
            paymentMethod: 'cash',
            status: 'pending',
            createdAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
        };
        
        const keyboard = Keyboard.inlineKeyboard([
            [
                Keyboard.button.callback('✅ Я оплатил на месте', `confirm_cash_${paymentId}`),
                Keyboard.button.callback('❌ Отменить заказ', 'user_buy')
            ]
        ]);
        
        await ctx.reply(
            `**💰 ОПЛАТА НАЛИЧНЫМИ**\n\n` +
            `**📋 ВАШ ЗАКАЗ:**\n` +
            `└─ Тип: ${subscriptionName}\n` +
            `└─ Занятий: ${lessons}\n` +
            `└─ Сумма к оплате: **${amount} руб.**\n\n` +
            
            `**📝 ИНСТРУКЦИЯ ПО ОПЛАТЕ:**\n` +
            `1. **Приходите на тренировку**\n` +
            `2. **Сообщите:** "Я оплачиваю наличными"\n` +
            `3. **Оплатите ${amount} руб.** наличными\n` +
            `4. **После оплаты** нажмите кнопку ниже\n\n` +
            
            `**📞 КОНТАКТЫ АДМИНИСТРАТОРА:**\n` +
            `Телефон: +7 (925) 225-13-36\n` +
            
            `**⏰ ВРЕМЯ ОПЛАТЫ:**\n` +
            `Вы можете оплатить на любой тренировке\n` +
            
            `**⚠️ ВНИМАНИЕ:**\n` +
            `Абонемент будет активирован только после подтверждения оплаты\n` +
            `Обычно это занимает не более 15 минут после оплаты\n\n` +
            
            `**После оплаты нажмите кнопку:**`,
            {
                format: 'markdown',
                attachments: [keyboard]
            }
        );
        
        logToFile(`💰 Создан заказ наличными: ${userName}, ${subscriptionName}, ${amount} руб.`);
        
    } catch (error) {
        logToFile(`❌ Ошибка pay_cash: ${error.message}`);
    }
});

// Банковский перевод
bot.action(/^pay_bank_(monthly|single)$/, async (ctx) => {
    try {
        const subscriptionType = ctx.match[1];
        const userId = getUserId(ctx);
        const userName = getUserName(ctx);
        
        await ctx.deleteMessage();
        
        const amount = subscriptionType === 'monthly' ? 4400 : 700;
        const lessons = subscriptionType === 'monthly' ? 8 : 1;
        const subscriptionName = subscriptionType === 'monthly' ? 'Месячный' : 'Разовое посещение';
        
        // Создаем запись о платеже
        const paymentId = `bank_${Date.now()}_${userId}`;
        pendingPayments[paymentId] = {
            userId,
            userName,
            subscriptionType,
            amount,
            lessons,
            paymentMethod: 'bank_transfer',
            status: 'pending',
            createdAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()
        };
        
        const keyboard = Keyboard.inlineKeyboard([
            [
                Keyboard.button.callback('🏦 Сбербанк', `bank_sber_${paymentId}`),
                Keyboard.button.callback('⚡ СПБ', `bank_spb_${paymentId}`)
            ],
            [
                Keyboard.button.callback('❌ Отменить заказ', 'user_buy')
            ]
        ]);
        
        await ctx.reply(
            `**🏦 БАНКОВСКИЙ ПЕРЕВОД**\n\n` +
            `**📋 ВАШ ЗАКАЗ:**\n` +
            `└─ Тип: ${subscriptionName}\n` +
            `└─ Занятий: ${lessons}\n` +
            `└─ Сумма к оплате: **${amount} руб.**\n\n` +
            
            `**📝 ИНСТРУКЦИЯ ПО ОПЛАТЕ:**\n` +
            `1. **Выберите способ перевода**\n` +
            `2. **Скопируйте реквизиты**\n` +
            `3. **Сделайте перевод** через приложение банка\n` +
            `4. **Абонемент активируется** в течение 15 минут\n\n` +
            
            `**🎯 ВЫБЕРИТЕ СПОСОБ ПЕРЕВОДА:**\n` +
            `• **🏦 Сбербанк** - перевод __номеру карты!__\n` +
            `• **⚡ СПБ** - мгновенный перевод на Альфа-Банк или Т-Банк\n\n` +
                        
            `*Выберите способ перевода:*`,
            {
                format: 'markdown',
                attachments: [keyboard]
            }
        );
        
        logToFile(`🏦 Создан заказ банковским переводом: ${userName}, ${subscriptionName}, ${amount} руб.`);
        
    } catch (error) {
        logToFile(`❌ Ошибка pay_bank: ${error.message}`);
    }
});

// Реквизиты Сбербанка
bot.action(/^bank_sber_(\w+)$/, async (ctx) => {
    try {
        const paymentId = ctx.match[1];
        const payment = pendingPayments[paymentId];
        
        if (!payment) {
            await ctx.reply('❌ Заказ не найден', { format: 'markdown' });
            return;
        }
        
        await ctx.deleteMessage();
        
        const bank = BANK_DETAILS.SBER;
        
        const keyboard = Keyboard.inlineKeyboard([
            [
                Keyboard.button.callback('✅ Я перевел деньги', `confirm_bank_${paymentId}`),
                Keyboard.button.callback('📞 Связаться с администратором', 'contact_admin')
            ],
            [
                Keyboard.button.callback('❌ Отменить заказ', 'user_buy')
            ]
        ]);
        
        await ctx.reply(
            `**🏦 РЕКВИЗИТЫ СБЕРБАНК**\n\n` +
            `**📋 ВАШ ЗАКАЗ:**\n` +
            `└─ Тип: ${payment.subscriptionType === 'monthly' ? 'Месячный' : 'Разовое посещение'}\n` +
            `└─ Сумма: **${payment.amount} руб.**\n\n` +
            
            `**🏛️ РЕКВИЗИТЫ ДЛЯ ПЕРЕВОДА:**\n` +
            `**Банк:** ${bank.name}\n` +
            `**Номер карты:** \`${bank.number}\`\n` +
            `**Получатель:** ${bank.nameHolder}\n` +
            
            `**📝 КАК СДЕЛАТЬ ПЕРЕВОД:**\n` +
            `1. Откройте приложение ${bank.name}\n` +
            `2. Выберите "Перевод по номеру карты"\n` +
            `3. Введите номер карты: \`${bank.number}\`\n` +
            `4. Сумма: **${payment.amount} руб.**\n` +
            `5. Подтвердите перевод\n\n` +
            
            `**📞 КОНТАКТЫ:**\n` +
            `Телефон: +7 (925) 225-13-36\n` +
            
            `**⏰ СРОК ОЖИДАНИЯ:**\n` +
            `Активация производится вручную\n` +
            `Обычно в течение 15 минут\n\n` +
            
            `*После перевода нажмите кнопку:*`,
            {
                format: 'markdown',
                attachments: [keyboard]
            }
        );
        
    } catch (error) {
        logToFile(`❌ Ошибка bank_sber: ${error.message}`);
    }
});

// Реквизиты СПБ (Альфа-Банк/Т-Банк)
bot.action(/^bank_spb_(\w+)$/, async (ctx) => {
    try {
        const paymentId = ctx.match[1];
        const payment = pendingPayments[paymentId];
        
        if (!payment) {
            await ctx.reply('❌ Заказ не найден', { format: 'markdown' });
            return;
        }
        
        await ctx.deleteMessage();
        
        const bank = BANK_DETAILS.SPB;
        
        const keyboard = Keyboard.inlineKeyboard([
            [
                Keyboard.button.callback('✅ Я перевел деньги', `confirm_bank_${paymentId}`),
                Keyboard.button.callback('📞 Связаться с администратором', 'contact_admin')
            ],
            [
                Keyboard.button.callback('❌ Отменить заказ', 'user_buy')
            ]
        ]);
        
        await ctx.reply(
            `**⚡ СПБ (СИСТЕМА БЫСТРЫХ ПЛАТЕЖЕЙ)**\n\n` +
            `**📋 ВАШ ЗАКАЗ:**\n` +
            `└─ Тип: ${payment.subscriptionType === 'monthly' ? 'Месячный' : 'Разовое посещение'}\n` +
            `└─ Сумма: **${payment.amount} руб.**\n\n` +
            
            `**🏛️ РЕКВИЗИТЫ ДЛЯ ПЕРЕВОДА:**\n` +
            `**👤 Получатель:** ${bank.nameHolder}\n` +
            `**📱 Телефон:** ${bank.phone}\n\n` +
            
            `**📝 КАК СДЕЛАТЬ ПЕРЕВОД ЧЕРЕЗ СПБ:**\n` +
            `**По номеру телефона:**\n` +
            `1. В приложении банка выберите "Перевод по телефону"\n` +
            `2. Введите номер: \`${bank.phone}\`\n` +
            `3. Сумма: **${payment.amount} руб.**\n` +
            `4. Подтвердите перевод\n\n` +
            
            `**🎯 ПРЕИМУЩЕСТВА СПБ:**\n` +
            `⚡ **Мгновенный перевод** (1-2 минуты)\n` +
            `💳 **Работает 24/7**\n` +
            `📱 **Удобно с телефона**\n` +
            `🎯 **Подходит для любых банков**\n\n` +
            
            `**📞 КОНТАКТЫ:**\n` +
            `После перевода свяжитесь с администратором:\n` +
            `Телефон: ${bank.phone}\n` +
            
            `**⏰ СРОК ОЖИДАНИЯ:**\n` +
            `Активация производится вручную\n` +
            `Обычно в течение 15 минут\n\n` +
            
            `*После перевода нажмите кнопку:*`,
            {
                format: 'markdown',
                attachments: [keyboard]
            }
        );
        
    } catch (error) {
        logToFile(`❌ Ошибка bank_spb: ${error.message}`);
    }
});

// Подтверждение оплаты наличными от пользователя
bot.action(/^confirm_cash_(\w+)$/, async (ctx) => {
    try {
        const paymentId = ctx.match[1];
        const payment = pendingPayments[paymentId];
        const userId = getUserId(ctx);
        const userName = getUserName(ctx);
        
        if (!payment) {
            await ctx.reply('❌ Заказ не найден или уже обработан', { format: 'markdown' });
            return;
        }
        
        // Исправляем сравнение ID
        if (String(payment.userId) !== String(userId)) {
            await ctx.reply('❌ Это не ваш заказ', { format: 'markdown' });
            return;
        }
        
        await ctx.deleteMessage();
        
        // Обновляем статус платежа
        payment.status = 'waiting_admin_confirmation';
        payment.userConfirmedAt = new Date().toISOString();
        payment.userConfirmed = true;
        
        const keyboard = Keyboard.inlineKeyboard([
            [
                Keyboard.button.callback('📞 Связаться с администратором', 'contact_admin')
            ],
            [
                Keyboard.button.callback('🏠 В главное меню', 'user_back')
            ]
        ]);
        
        await ctx.reply(
            `**✅ ВЫ ПОДТВЕРДИЛИ ОПЛАТУ НАЛИЧНЫМИ!**\n\n` +
            `**📋 ВАШ ЗАКАЗ:**\n` +
            `└─ Тип: ${payment.subscriptionType === 'monthly' ? 'Месячный' : 'Разовое посещение'}\n` +
            `└─ Сумма: ${payment.amount} руб.\n` +
            `└─ Способ оплаты: Наличные\n\n` +
            
            `**📝 ЧТО ДАЛЬШЕ:**\n` +
            `1. **Администратор получил уведомление**\n` +
            `2. **Подойдите к администратору** на тренировке\n` +
            `3. **Оплатите ${payment.amount} руб.** наличными\n` +
            `4. **После оплаты** администратор подтвердит активацию\n` +
            `5. **Вы получите сообщение** об активации\n\n` +
            
            `**⏰ ВРЕМЯ ОЖИДАНИЯ:**\n` +
            `Активация происходит после фактической оплаты\n` +
            `Обычно сразу после передачи денег администратору\n\n` +
            
            `**📞 КОНТАКТЫ:**\n` +
            `Телефон: +7 (925) 225-13-36\n\n` +
            
            `**Спасибо! Ждем вас на тренировке!**`,
            {
                format: 'markdown',
                attachments: [keyboard]
            }
        );
        
        logToFile(`✅ Пользователь ${userName} подтвердил оплату наличными: ${paymentId}`);
        
    } catch (error) {
        logToFile(`❌ Ошибка confirm_cash: ${error.message}`);
    }
});

// Подтверждение банковского перевода от пользователя
bot.action(/^confirm_bank_(\w+)$/, async (ctx) => {
    try {
        const paymentId = ctx.match[1];
        const payment = pendingPayments[paymentId];
        const userId = getUserId(ctx);
        const userName = getUserName(ctx);
        
        if (!payment) {
            await ctx.reply('❌ Заказ не найден или уже обработан', { format: 'markdown' });
            return;
        }
        
        // Исправляем сравнение ID
        if (String(payment.userId) !== String(userId)) {
            await ctx.reply('❌ Это не ваш заказ', { format: 'markdown' });
            return;
        }
        
        await ctx.deleteMessage();
        
        // Обновляем статус платежа
        payment.status = 'waiting_admin_confirmation';
        payment.userConfirmedAt = new Date().toISOString();
        payment.userConfirmed = true;
        
        const keyboard = Keyboard.inlineKeyboard([
            [
                Keyboard.button.callback('📞 Связаться', 'contact_admin')
            ],
            [
                Keyboard.button.callback('🏠 В главное меню', 'user_back')
            ]
        ]);
        
        await ctx.reply(
            `**✅ ВЫ ПОДТВЕРДИЛИ БАНКОВСКИЙ ПЕРЕВОД!**\n\n` +
            `**📋 ВАШ ЗАКАЗ:**\n` +
            `└─ Тип: ${payment.subscriptionType === 'monthly' ? 'Месячный' : 'Разовое посещение'}\n` +
            `└─ Сумма: ${payment.amount} руб.\n` +
            `└─ Способ оплаты: Банковский перевод\n\n` +
            
            `**📝 ЧТО ДАЛЬШЕ:**\n` +
            `1. **Отправьте чек** об оплате администратору\n` +
            `2. **Администратор проверит перевод**\n` +
            `3. **После подтверждения** абонемент будет активирован\n` +
            `4. **Вы получите сообщение** об активации\n\n` +
            
            `**⏰ ВРЕМЯ ОЖИДАНИЯ:**\n` +
            `Активация производится вручную администратором\n` +
            `Обычно в течение 15 минут после получения чека\n\n` +
            
            `**📞 КОНТАКТЫ:**\n` +
            `Телефон: +7 (925) 225-13-36\n\n` +
            
            `**Спасибо за покупку!**`,
            {
                format: 'markdown',
                attachments: [keyboard]
            }
        );
        
        logToFile(`✅ Пользователь ${userName} подтвердил банковский перевод: ${paymentId}`);
        
    } catch (error) {
        logToFile(`❌ Ошибка confirm_bank: ${error.message}`);
    }
});

// ========== КОМАНДА ДЛЯ БЫСТРОГО ДОСТУПА К ПАНЕЛИ ==========
bot.command('моиабонементы', async (ctx) => {
    try {
        const userId = getUserId(ctx);
        const userName = getUserName(ctx);
        
        if (!userId) {
            await ctx.reply('❌ Не удалось определить ваш профиль', { format: 'markdown' });
            await ctx.deleteMessage();
            return;
        }
        
        const subscription = userSubscriptions[userId];
        
        const keyboard = Keyboard.inlineKeyboard([
            [
                Keyboard.button.callback('📅 Купить месячный', 'user_buy_monthly'),
                Keyboard.button.callback('🎫 Купить Разовое посещение', 'user_buy_single')
            ],
            [
                Keyboard.button.callback('📋 История покупок', 'user_subs_history'),
            ],
            [
                Keyboard.button.callback('👤 В мой кабинет', 'user_panel')
            ]
        ]);
        
        let response = `**🎫 МОИ АБОНЕМЕНТЫ**\n\n`;
        
        if (subscription) {
            const startDate = new Date(subscription.startDate);
            const endDate = new Date(startDate);
            endDate.setDate(startDate.getDate() + 30);
            const daysLeft = Math.max(0, Math.ceil((endDate - new Date()) / (1000 * 60 * 60 * 24)));
            
            response += `**✅ АКТИВНЫЙ АБОНЕМЕНТ**\n\n`;
            response += `📋 Тип: ${subscription.type === 'monthly' ? '📅 Месячный' : '🎫 Разовое посещение'}\n`;
            response += `🎫 Осталось занятий: ${subscription.lessons}\n`;
            response += `💰 Стоимость: ${subscription.cost} руб.\n`;
            response += `📅 Действует до: ${endDate.toLocaleDateString('ru-RU')}\n`;
            response += `⌛ Осталось дней: ${daysLeft}\n`;
            
            if (subscription.lastUsed) {
                response += `🔄 Последнее использование: ${new Date(subscription.lastUsed).toLocaleDateString('ru-RU')}\n`;
            }
        } else {
            response += `**❌ НЕТ АКТИВНОГО АБОНЕМЕНТА**\n\n`;
            response += `Для записи на тренировки необходим абонемент.\n\n`;
            response += `🎯 **ДОСТУПНЫЕ ВАРИАНТЫ:**\n`;
            response += `📅 Месячный (8 занятий) - 4400 руб.\n`;
            response += `🎫 Разовое посещение (1 занятие) - 700 руб.\n`;
        }
        
        await ctx.reply(response, {
            format: 'markdown',
            attachments: [keyboard]
        });
        
        await ctx.deleteMessage();
        logToFile(`✅ /моиабонементы от ${userName}`);
        
    } catch (error) {
        logToFile(`❌ Ошибка команды моиабонементы: ${error.message}`);
        await ctx.reply('Произошла ошибка', { format: 'markdown' });
    }
});

// Команда для быстрой записи
bot.command('записаться', async (ctx) => {
    try {
        const userId = getUserId(ctx);
        const userName = getUserName(ctx);
        
        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];
        
        // Проверяем, есть ли сегодня тренировка
        const dayOfWeek = today.getDay();
        const isTrainingDay = dayOfWeek === 1 || dayOfWeek === 3;
        
        if (!isTrainingDay) {
            const days = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
            const dayName = days[dayOfWeek];
            
            // Находим следующий тренировочный день
            let nextTrainingDate = new Date(today);
            nextTrainingDate.setDate(nextTrainingDate.getDate() + 1);
            
            while (!(nextTrainingDate.getDay() === 1 || nextTrainingDate.getDay() === 3)) {
                nextTrainingDate.setDate(nextTrainingDate.getDate() + 1);
            }
            
            const nextDayName = days[nextTrainingDate.getDay()];
            const nextDateFormatted = nextTrainingDate.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
            
            await ctx.reply(
                `**📅 СЕГОДНЯ ТРЕНИРОВОК НЕТ**\n\n` +
                `Сегодня **${dayName}, ${today.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}** тренировки не проводятся.\n\n` +
                `**🎯 РАСПИСАНИЕ ТРЕНИРОВОК:**\n` +
                `└─ 📅 Дни: Понедельник, Среда\n` +
                `└─ 📍 Место: мкр. Заря\n` +
                `└─ ⏰ Время: 20:00\n\n` +
                `**📅 БЛИЖАЙШАЯ ТРЕНИРОВКА:**\n` +
                `└─ ${nextDateFormatted}\n` +
                `└─ 🎯 ВИИТ тренировка\n` +
                `└─ 📍 мкр. Заря\n` +
                `└─ ⏰ 20:00\n\n` +
                { format: 'markdown' }
            );
            await ctx.deleteMessage();
            return;
        }
        
        // Если сегодня тренировочный день - проверяем, не записан ли уже
        const todayPoll = dailyPolls[todayStr] || { yes: [], no: [], maybe: [] };
        const isEnrolled = todayPoll.yes && todayPoll.yes.includes(userName);
        
        if (isEnrolled) {
            await ctx.reply(
                `**📋 ВЫ УЖЕ ЗАПИСАНЫ НА СЕГОДНЯ!**\n\n` +
                `**Детали записи:**\n` +
                `└─ 📅 Дата: ${new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}\n` +
                `└─ 🎯 Тип: ВИИТ тренировка\n` +
                `└─ 📍 Место: мкр. Заря\n` +
                `└─ ⏰ Время: 20:00\n\n` +
                `**📊 СТАТУС ОПРОСА:**\n` +
                `└─ ✅ Идут: ${todayPoll.yes ? todayPoll.yes.length : 0}\n` +
                `└─ ❓ Возможно: ${todayPoll.maybe ? todayPoll.maybe.length : 0}\n\n` +
                `**Чтобы отменить запись, используйте:**\n/отменить`,
                { format: 'markdown' }
            );
            await ctx.deleteMessage();
            return;
        }
        
        // Проверяем абонемент БЕЗ списания занятия
        const checkResult = checkSubscription(userId, 'yes', false);
        
        if (!checkResult.isValid) {
            await ctx.reply(
                `**❌ НЕВОЗМОЖНО ЗАПИСАТЬСЯ**\n\n` +
                `${checkResult.message}\n\n` +
                `**💡 РЕКОМЕНДАЦИИ:**\n` +
                `1. Приобретите абонемент через /купить\n` +
                `2. Или оплатите разовое посещение на месте\n\n` +
                `**После оплаты вернитесь для записи.**`,
                { format: 'markdown' }
            );
            await ctx.deleteMessage();
            return;
        }
        
        const keyboard = Keyboard.inlineKeyboard([
            [
                Keyboard.button.callback('✅ Да, записаться', 'user_enroll_confirm'),
                Keyboard.button.callback('❌ Нет, отменить', 'user_schedule')
            ]
        ]);
        
        const response = `**✅ ЗАПИСЬ НА ТРЕНИРОВКУ**\n\n` +
            `**📅 ДЕТАЛИ ТРЕНИРОВКИ:**\n` +
            `└─ 📅 Дата: ${new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}\n` +
            `└─ 🎯 Тип: ВИИТ тренировка\n` +
            `└─ 📍 Место: мкр. Заря\n` +
            `└─ ⏰ Время: 20:00\n\n` +
            `**💳 СТАТУС АБОНЕМЕНТА:**\n` +
            `└─ ${checkResult.message}\n\n` +
            `**📊 СТАТУС ОПРОСА:**\n` +
            `└─ ✅ Идут: ${todayPoll.yes ? todayPoll.yes.length : 0}\n` +
            `└─ ❓ Возможно: ${todayPoll.maybe ? todayPoll.maybe.length : 0}\n\n` +
            `**Вы уверены, что хотите записаться?**\n` +
            `После записи с вашего абонемента спишется одно занятие.`;
        
        await ctx.reply(response, {
            format: 'markdown',
            attachments: [keyboard]
        });
        await ctx.deleteMessage();
        
    } catch (error) {
        logToFile(`❌ Ошибка команды записаться: ${error.message}`);
        try {
            await ctx.reply('Произошла ошибка при записи', { format: 'markdown' });
        } catch {}
    }
});

// Обработчик кнопки связи с администратором
bot.action('contact_admin', async (ctx) => {
    try {
        await ctx.reply(
            `**📞 КОНТАКТЫ АДМИНИСТРАТОРА**\n\n` +
            `**Для связи используйте:**\n\n` +
            `**📱 Телефон:**\n` +
            `+7 (925) 225-13-36\n\n` +
            
            `**⏰ Время работы:**\n` +
            `Пн-Пт: 10:00 - 22:00\n` +
            `Сб-Вс: 11:00 - 20:00\n\n` +
            
            `**💡 КАК СВЯЗАТЬСЯ:**\n` +
            `1. **Позвоните** по телефону\n` +
            `2. **Опишите** вопрос или проблему\n\n` +
            
            `**Мы ответим вам в ближайшее время!**`,
            { format: 'markdown' }
        );
        
        try {
            await ctx.deleteMessage();
        } catch (e) {
            logToFile(`ℹ️ Не удалось удалить сообщение: ${e.message}`);
        }
        
    } catch (error) {
        logToFile(`❌ Ошибка contact_admin: ${error.message}`);
    }
});

// ========== АДМИН КОМАНДЫ ==========
// Команда для просмотра ID чата
bot.command('ид_чата', async (ctx) => {
    try {
        const userId = getUserId(ctx);
        if (!isAdmin(userId)) return;
        
        const chatId = getChatId(ctx);
        await ctx.reply(`🆔 ID этого чата: \`${chatId}\``, { format: 'markdown' });
        await ctx.deleteMessage();
        
    } catch (error) {
        logToFile(`❌ Ошибка команды ид_чата: ${error.message}`);
    }
});

// Команда для просмотра всех ID сообщений опроса
bot.command('ид_опросов', async (ctx) => {
    try {
        const userId = getUserId(ctx);
        if (!isAdmin(userId)) return;
        
        let response = `*📋 ID СООБЩЕНИЙ ОПРОСОВ*\n\n`;
        response += `Всего записей: ${Object.keys(pollMessages).length}\n\n`;
        
        Object.entries(pollMessages).forEach(([key, mid], index) => {
            if (index < 10) {
                response += `${key}: ${mid}\n`;
            }
        });
        
        if (Object.keys(pollMessages).length > 10) {
            response += `\n... и еще ${Object.keys(pollMessages).length - 10} записей`;
        }
        
        await ctx.reply(response, { format: 'markdown' });
        await ctx.deleteMessage();
        
    } catch (error) {
        logToFile(`❌ Ошибка команды ид_опросов: ${error.message}`);
    }
});

// Главная админ-панель
bot.command('админ', async (ctx) => {
    try {
        const userId = getUserId(ctx);
        
        if (!isAdmin(userId)) {
            await ctx.reply('❌ *Доступ запрещен!*', { format: 'markdown' });
            await ctx.deleteMessage();
            return;
        }
        
        const today = new Date().toISOString().split('T')[0];
        const currentPoll = dailyPolls[today] || { yes: [], no: [], maybe: [] };
        const pollParticipants = (currentPoll.yes ? currentPoll.yes.length : 0) + 
                                (currentPoll.no ? currentPoll.no.length : 0) + 
                                (currentPoll.maybe ? currentPoll.maybe.length : 0);
        
        const totalUsers = Object.keys(userStats).length;
        const totalSubs = Object.keys(userSubscriptions).length;
        
        // Подсчет активных абонементов
        let activeSubs = 0;
        Object.values(userSubscriptions).forEach(sub => {
            if (sub.lessons > 0) {
                const endDate = new Date(sub.startDate);
                endDate.setDate(endDate.getDate() + 30);
                if (new Date() <= endDate) {
                    activeSubs++;
                }
            }
        });
        
        const keyboard = Keyboard.inlineKeyboard([
            [
                Keyboard.button.callback('📊 Статистика', 'admin_stats'),
                Keyboard.button.callback('👥 Пользователи', 'admin_users')
            ],
            [
                Keyboard.button.callback('📋 Абонементы', 'admin_subs'),
                Keyboard.button.callback('💰 Платежи', 'ожидающие_платежи')
            ],
            [
                Keyboard.button.callback('🗑️ Удалить', 'admin_delete')
            ]
        ]);
        
        await ctx.reply(
            `*👑 АДМИН ПАНЕЛЬ*\n\n` +
            `*📈 СИСТЕМНАЯ СТАТИСТИКА:*\n` +
            `👥 Пользователей: *${totalUsers}*\n` +
            `📋 Абонементов: *${totalSubs}*\n` +
            `✅ Активных: *${activeSubs}*\n\n` +
            
            `*📅 СЕГОДНЯШНИЙ ОПРОС:*\n` +
            `✅ Идут: *${currentPoll.yes ? currentPoll.yes.length : 0}*\n` +
            `❌ Не идут: *${currentPoll.no ? currentPoll.no.length : 0}*\n` +
            `❓ Возможно: *${currentPoll.maybe ? currentPoll.maybe.length : 0}*\n` +
            `👥 Всего: *${pollParticipants}*\n\n` +
            
            `*📅 Дата:* ${new Date().toLocaleDateString('ru-RU')}\n` +
            `*⏰ Время:* ${new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}\n\n` +
            
            `*Выберите действие:*`,
            {
                attachments: [keyboard],
                format: 'markdown'
            }
        );
        
        await ctx.deleteMessage();
        
    } catch (error) {
        logToFile(`❌ Ошибка /админ: ${error.message}`);
    }
});

// Команда для просмотра ожидающих платежей
bot.command('ожидающие_платежи', async (ctx) => {
    try {
        const adminId = getUserId(ctx);
        if (!isAdmin(adminId)) return;
        
        await ctx.deleteMessage();
        
        // Находим ожидающие платежи
        const pendingPaymentsList = Object.entries(pendingPayments)
            .filter(([id, payment]) => payment.status === 'pending' || payment.status === 'waiting_admin_confirmation')
            .sort((a, b) => new Date(a[1].createdAt) - new Date(b[1].createdAt));
        
        if (pendingPaymentsList.length === 0) {
            await ctx.reply(
                `**📭 НЕТ ОЖИДАЮЩИХ ПЛАТЕЖЕЙ**\n\n` +
                `Все платежи обработаны.\n` +
                `Новых ожидающих платежей нет.`,
                { format: 'markdown' }
            );
            return;
        }
        
        // Создаем клавиатуру с кнопками для каждого платежа
        const keyboardButtons = [];
        
        pendingPaymentsList.slice(0, 10).forEach(([paymentId, payment], index) => {
            const paymentMethod = payment.paymentMethod === 'cash' ? '💰' : 
                                 payment.paymentMethod === 'bank_transfer' ? '🏦' : '💳';
            const subscriptionType = payment.subscriptionType === 'monthly' ? '📅' : '🎫';
            const userName = payment.userName.length > 15 ? payment.userName.substring(0, 15) + '...' : payment.userName;
            
            keyboardButtons.push([
                Keyboard.button.callback(
                    `${index + 1}. ${paymentMethod} ${subscriptionType} ${userName} - ${payment.amount} руб.`,
                    `view_payment_${paymentId}`
                )
            ]);
        });
        
        // Кнопка обновления
        keyboardButtons.push([
            Keyboard.button.callback('🔄 Обновить список', 'ожидающие_платежи'),
            Keyboard.button.callback('« В админ панель', 'admin_back')
        ]);
        
        const keyboard = Keyboard.inlineKeyboard(keyboardButtons);
        
        let response = `**💰 ОЖИДАЮЩИЕ ПЛАТЕЖИ**\n\n`;
        response += `Всего ожидающих платежей: **${pendingPaymentsList.length}**\n\n`;
        response += `**Легенда:**\n`;
        response += `💰 - Наличные\n`;
        response += `🏦 - Банковский перевод\n`;
        response += `💳 - Онлайн оплата\n`;
        response += `📅 - Месячный абонемент\n`;
        response += `🎫 - Разовое посещение абонемент\n\n`;
        
        response += `**Выберите платеж для просмотра:**`;
        
        await ctx.reply(response, {
            format: 'markdown',
            attachments: [keyboard]
        });
        
    } catch (error) {
        logToFile(`❌ Ошибка команды ожидающие_платежи: ${error.message}`);
    }
});

// ========== ИСПРАВЛЕНИЕ КНОПКИ ПЛАТЕЖИ ==========

// Action для кнопки "Платежи" в админ-панели
bot.action('ожидающие_платежи', async (ctx) => {
    try {
        const adminId = getUserId(ctx);
        if (!isAdmin(adminId)) return;
        
        // Удаляем предыдущее сообщение
        try {
            await ctx.deleteMessage();
        } catch (deleteError) {
            logToFile(`⚠️ Не удалось удалить сообщение: ${deleteError.message}`);
        }
        
        // Находим ожидающие платежи
        const pendingPaymentsList = Object.entries(pendingPayments)
            .filter(([id, payment]) => payment.status === 'pending' || payment.status === 'waiting_admin_confirmation')
            .sort((a, b) => new Date(a[1].createdAt) - new Date(b[1].createdAt));
        
        if (pendingPaymentsList.length === 0) {
            await ctx.reply(
                `**📭 НЕТ ОЖИДАЮЩИХ ПЛАТЕЖЕЙ**\n\n` +
                `Все платежи обработаны.\n` +
                `Новых ожидающих платежей нет.`,
                { format: 'markdown' }
            );
            return;
        }
        
        // Создаем клавиатуру с кнопками для каждого платежа
        const keyboardButtons = [];
        
        pendingPaymentsList.slice(0, 10).forEach(([paymentId, payment], index) => {
            const paymentMethod = payment.paymentMethod === 'cash' ? '💰' : 
                                 payment.paymentMethod === 'bank_transfer' ? '🏦' : '💳';
            const subscriptionType = payment.subscriptionType === 'monthly' ? '📅' : '🎫';
            const userName = payment.userName.length > 15 ? payment.userName.substring(0, 15) + '...' : payment.userName;
            
            keyboardButtons.push([
                Keyboard.button.callback(
                    `${index + 1}. ${paymentMethod} ${subscriptionType} ${userName} - ${payment.amount} руб.`,
                    `admin_view_payment_${paymentId}`
                )
            ]);
        });
        
        // Кнопка обновления и возврата
        keyboardButtons.push([
            Keyboard.button.callback('🔄 Обновить список', 'ожидающие_платежи'),
            Keyboard.button.callback('« В админ панель', 'admin_back')
        ]);
        
        const keyboard = Keyboard.inlineKeyboard(keyboardButtons);
        
        let response = `**💰 ОЖИДАЮЩИЕ ПЛАТЕЖИ**\n\n`;
        response += `Всего ожидающих платежей: **${pendingPaymentsList.length}**\n\n`;
        response += `**Легенда:**\n`;
        response += `💰 - Наличные\n`;
        response += `🏦 - Банковский перевод\n`;
        response += `📅 - Месячный абонемент\n`;
        response += `🎫 - Разовое посещение абонемент\n\n`;
        
        response += `**📊 СТАТУС ПЛАТЕЖЕЙ:**\n`;
        const pendingCount = pendingPaymentsList.filter(([_, p]) => p.status === 'pending').length;
        const waitingConfirmCount = pendingPaymentsList.filter(([_, p]) => p.status === 'waiting_admin_confirmation').length;
        
        response += `⏳ Ожидают подтверждения пользователя: **${pendingCount}**\n`;
        response += `✅ Подтверждены пользователем (ждут админа): **${waitingConfirmCount}**\n\n`;
        
        response += `**Выберите платеж для просмотра:**`;
        
        await ctx.reply(response, {
            format: 'markdown',
            attachments: [keyboard]
        });
        
    } catch (error) {
        logToFile(`❌ Ошибка action ожидающие_платежи: ${error.message}`);
    }
});

// 1. Обработчик подтверждения отклонения (должен быть ПЕРВЫМ)
bot.action(/^admin_reject_payment_confirm_(.+)$/, async (ctx) => {
    try {
        console.log('=== ОБРАБОТЧИК CONFIRM (ПОДТВЕРЖДЕНИЕ ОТКЛОНЕНИЯ) ===');
        console.log('PaymentId:', ctx.match[1]);
        
        const adminId = getUserId(ctx);
        if (!isAdmin(adminId)) return;
        
        const paymentId = ctx.match[1];
        const payment = pendingPayments[paymentId];
        
        if (!payment) {
            await ctx.reply('❌ Платеж не найден', { format: 'markdown' });
            return;
        }
        
        // Удаляем предыдущее сообщение
        try {
            await ctx.deleteMessage();
        } catch (deleteError) {
            logToFile(`⚠️ Не удалось удалить сообщение: ${deleteError.message}`);
        }
        
        // Удаляем платеж
        delete pendingPayments[paymentId];
        
        // Отправляем уведомление пользователю
        try {
            await bot.api.sendMessageToUser(
                payment.userId,
                `**❌ ПЛАТЕЖ ОТКЛОНЕН**\n\n` +
                `Ваш платеж на сумму **${payment.amount} руб.** был отклонен администратором.\n\n` +
                `**💡 ВОЗМОЖНЫЕ ПРИЧИНЫ:**\n` +
                `• Деньги не поступили на счет\n` +
                `• Неверная сумма перевода\n` +
                `• Техническая ошибка\n` +
                `• Другая причина\n\n` +
                `**🎯 ЧТО ДЕЛАТЬ:**\n` +
                `1. Проверьте статус перевода в приложении банка\n` +
                `2. Свяжитесь с администратором: +7 (925) 225-13-36\n` +
                `3. Создайте новый заказ через /купить\n\n` +
                `**Приносим извинения за неудобства!**`,
                { format: 'markdown' }
            );
        } catch (userError) {
            logToFile(`⚠️ Не удалось отправить уведомление пользователю: ${userError.message}`);
        }
        
        const keyboard = Keyboard.inlineKeyboard([
            [
                Keyboard.button.callback('« Назад к платежам', 'ожидающие_платежи')
            ]
        ]);
        
        await ctx.reply(
            `**❌ ПЛАТЕЖ ОТКЛОНЕН**\n\n` +
            `**🆔 ID платежа:** ${paymentId}\n` +
            `**👤 Пользователь:** ${payment.userName}\n` +
            `**💰 Сумма:** ${payment.amount} руб.\n\n` +
            
            `**📋 ПЛАТЕЖ УДАЛЕН ИЗ СИСТЕМЫ**\n\n` +
            `**📨 УВЕДОМЛЕНИЕ:**\n` +
            `Пользователь получил сообщение об отклонении платежа.\n\n` +
            
            `**✅ ОПЕРАЦИЯ ЗАВЕРШЕНА**`,
            {
                format: 'markdown',
                attachments: [keyboard]
            }
        );
        
        logToFile(`❌ Админ ${adminId} отклонил платеж ${paymentId} для пользователя ${payment.userName}`);
        
    } catch (error) {
        logToFile(`❌ Ошибка admin_reject_payment_confirm: ${error.message}`);
    }
});

// 2. Обработчик выбора причины отклонения (должен быть ВТОРЫМ)
bot.action(/^admin_reject_payment_(.+)$/, async (ctx) => {
    try {
        console.log('=== ОБРАБОТЧИК REJECT (ВЫБОР ПРИЧИНЫ) ===');
        console.log('PaymentId:', ctx.match[1]);
        
        const adminId = getUserId(ctx);
        if (!isAdmin(adminId)) return;
        
        const paymentId = ctx.match[1];
        const payment = pendingPayments[paymentId];
        
        if (!payment) {
            await ctx.reply('❌ Платеж не найден', { format: 'markdown' });
            return;
        }
        
        // Удаляем предыдущее сообщение
        try {
            await ctx.deleteMessage();
        } catch (deleteError) {
            logToFile(`⚠️ Не удалось удалить сообщение: ${deleteError.message}`);
        }
        
        const keyboard = Keyboard.inlineKeyboard([
            [
                Keyboard.button.callback('✅ Да, отклонить', `admin_reject_payment_confirm_${paymentId}`),
                Keyboard.button.callback('❌ Нет, отмена', `admin_view_payment_${paymentId}`)
            ]
        ]);
        
        await ctx.reply(
            `**❌ ОТКЛОНЕНИЕ ПЛАТЕЖА**\n\n` +
            `**⚠️ ВНИМАНИЕ:**\n` +
            `Вы собираетесь отклонить платеж.\n\n` +
            
            `**📋 ИНФОРМАЦИЯ О ПЛАТЕЖЕ:**\n` +
            `Пользователь: **${payment.userName}**\n` +
            `Сумма: ${payment.amount} руб.\n` +
            `Тип: ${payment.subscriptionType === 'monthly' ? 'Месячный' : 'Разовое посещение'}\n` +
            `Способ оплаты: ${payment.paymentMethod === 'cash' ? 'Наличные' : 'Банковский перевод'}\n\n` +
            
            `**💡 ПРИЧИНЫ ОТКЛОНЕНИЯ:**\n` +
            `1. Деньги не поступили\n` +
            `2. Неверная сумма\n` +
            `3. Ошибка в заказе\n` +
            `4. Другая причина\n\n` +
            
            `**📨 ПОСЛЕ ОТКЛОНЕНИЯ:**\n` +
            `1. Пользователь получит уведомление\n` +
            `2. Платеж будет удален из системы\n` +
            `3. Пользователь может создать новый заказ\n\n` +
            
            `**Вы уверены, что хотите отклонить этот платеж?**`,
            {
                format: 'markdown',
                attachments: [keyboard]
            }
        );
        
    } catch (error) {
        logToFile(`❌ Ошибка admin_reject_payment: ${error.message}`);
    }
});

// Отклонение платежа
bot.action(/^admin_reject_payment_(.+)$/, async (ctx) => {
    try {
        const adminId = getUserId(ctx);
        if (!isAdmin(adminId)) return;
        
        const paymentId = ctx.match[1];
        const payment = pendingPayments[paymentId];
        
        if (!payment) {
            await ctx.reply('❌ Платеж не найден', { format: 'markdown' });
            return;
        }
        
        // Удаляем предыдущее сообщение
        try {
            await ctx.deleteMessage();
        } catch (deleteError) {
            logToFile(`⚠️ Не удалось удалить сообщение: ${deleteError.message}`);
        }
        
        const keyboard = Keyboard.inlineKeyboard([
            [
                Keyboard.button.callback('✅ Да, отклонить', `admin_reject_payment_confirm_${paymentId}`),
                Keyboard.button.callback('❌ Нет, отмена', `admin_view_payment_${paymentId}`)
            ]
        ]);
        
        await ctx.reply(
            `**❌ ОТКЛОНЕНИЕ ПЛАТЕЖА**\n\n` +
            `**⚠️ ВНИМАНИЕ:**\n` +
            `Вы собираетесь отклонить платеж.\n\n` +
            
            `**📋 ИНФОРМАЦИЯ О ПЛАТЕЖЕ:**\n` +
            `Пользователь: **${payment.userName}**\n` +
            `Сумма: ${payment.amount} руб.\n` +
            `Тип: ${payment.subscriptionType === 'monthly' ? 'Месячный' : 'Разовое посещение'}\n` +
            `Способ оплаты: ${payment.paymentMethod === 'cash' ? 'Наличные' : 'Банковский перевод'}\n\n` +
            
            `**💡 ПРИЧИНЫ ОТКЛОНЕНИЯ:**\n` +
            `1. Деньги не поступили\n` +
            `2. Неверная сумма\n` +
            `3. Ошибка в заказе\n` +
            `4. Другая причина\n\n` +
            
            `**📨 ПОСЛЕ ОТКЛОНЕНИЯ:**\n` +
            `1. Пользователь получит уведомление\n` +
            `2. Платеж будет удален из системы\n` +
            `3. Пользователь может создать новый заказ\n\n` +
            
            `**Вы уверены, что хотите отклонить этот платеж?**`,
            {
                format: 'markdown',
                attachments: [keyboard]
            }
        );
        
    } catch (error) {
        logToFile(`❌ Ошибка admin_reject_payment: ${error.message}`);
    }
});
// Просмотр деталей платежа
bot.action(/^admin_view_payment_(.+)$/, async (ctx) => {
    try {
        const adminId = getUserId(ctx);
        if (!isAdmin(adminId)) return;
        
        const paymentId = ctx.match[1];
        const payment = pendingPayments[paymentId];
        
        if (!payment) {
            await ctx.reply('❌ Платеж не найден или уже обработан', { format: 'markdown' });
            return;
        }
        
        // Удаляем предыдущее сообщение
        try {
            await ctx.deleteMessage();
        } catch (deleteError) {
            logToFile(`⚠️ Не удалось удалить сообщение: ${deleteError.message}`);
        }
        
        const user = userStats[payment.userId];
        const subscription = userSubscriptions[payment.userId];
        
        const keyboard = Keyboard.inlineKeyboard([
            [
                Keyboard.button.callback('✅ Подтвердить оплату', `admin_confirm_payment_${paymentId}`),
                Keyboard.button.callback('❌ Отклонить платеж', `admin_reject_payment_${paymentId}`)
            ],
            [
                Keyboard.button.callback('📞 Связаться с пользователем', `admin_contact_user_${payment.userId}`)
            ],
            [
                Keyboard.button.callback('« Назад к платежам', 'ожидающие_платежи')
            ]
        ]);
        
        // Форматируем даты
        const createdAt = new Date(payment.createdAt);
        const expiresAt = new Date(payment.expiresAt);
        
        let response = `**💰 ПОДРОБНОСТИ ПЛАТЕЖА**\n\n`;
        
        response += `**🆔 ID платежа:** ${paymentId}\n`;
        response += `**📅 Дата создания:** ${createdAt.toLocaleDateString('ru-RU')} ${createdAt.toLocaleTimeString('ru-RU')}\n`;
        response += `**⏰ Действует до:** ${expiresAt.toLocaleDateString('ru-RU')} ${expiresAt.toLocaleTimeString('ru-RU')}\n\n`;
        
        response += `**👤 ИНФОРМАЦИЯ О ПОЛЬЗОВАТЕЛЕ:**\n`;
        response += `Имя: **${payment.userName}**\n`;
        response += `ID: ${payment.userId}\n`;
        if (user) {
            response += `Посещений: ${user.attended || 0}\n`;
            response += `Последняя активность: ${new Date(user.lastActivity).toLocaleDateString('ru-RU')}\n`;
        }
        response += `\n`;
        
        response += `**🛒 ИНФОРМАЦИЯ О ЗАКАЗЕ:**\n`;
        response += `Тип абонемента: ${payment.subscriptionType === 'monthly' ? '📅 Месячный' : '🎫 Разовое посещение'}\n`;
        response += `Количество занятий: ${payment.lessons}\n`;
        response += `Сумма: **${payment.amount} руб.**\n`;
        response += `Способ оплаты: ${payment.paymentMethod === 'cash' ? '💰 Наличные' : '🏦 Банковский перевод'}\n\n`;
        
        response += `**📊 СТАТУС:**\n`;
        response += `Статус платежа: `;
        switch (payment.status) {
            case 'pending':
                response += `⏳ **Ожидает подтверждения пользователя**\n`;
                response += `Пользователь должен подтвердить оплату\n`;
                break;
            case 'waiting_admin_confirmation':
                response += `✅ **Подтвержден пользователем**\n`;
                response += `Ожидает подтверждения администратором\n`;
                if (payment.userConfirmedAt) {
                    response += `Пользователь подтвердил: ${new Date(payment.userConfirmedAt).toLocaleDateString('ru-RU')}\n`;
                }
                break;
            default:
                response += `${payment.status}\n`;
        }
        response += `\n`;
        
        // Дополнительная информация в зависимости от способа оплаты
        if (payment.paymentMethod === 'cash') {
            response += `**💰 ИНСТРУКЦИЯ ДЛЯ НАЛИЧНЫХ:**\n`;
            response += `1. Пользователь должен принести деньги на тренировку\n`;
            response += `2. Получите ${payment.amount} руб. наличными\n`;
            response += `3. Подтвердите получение кнопкой ниже\n`;
            response += `4. Абонемент будет активирован автоматически\n\n`;
        } else if (payment.paymentMethod === 'bank_transfer') {
            response += `**🏦 ИНСТРУКЦИЯ ДЛЯ БАНКОВСКОГО ПЕРЕВОДА:**\n`;
            response += `1. Проверьте поступление ${payment.amount} руб. на счет\n`;
            response += `2. Убедитесь, что перевод от ${payment.userName}\n`;
            response += `3. Если деньги получены - подтвердите платеж\n`;
            response += `4. Абонемент будет активирован автоматически\n\n`;
        }
        
        // Проверяем, есть ли уже активный абонемент
        if (subscription) {
            response += `**⚠️ ВНИМАНИЕ:**\n`;
            response += `У пользователя уже есть активный абонемент!\n`;
            response += `Тип: ${subscription.type === 'monthly' ? '📅 Месячный' : '🎫 Разовое посещение'}\n`;
            response += `Осталось занятий: ${subscription.lessons}\n`;
            response += `Действует до: ${new Date(new Date(subscription.startDate).getTime() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString('ru-RU')}\n\n`;
            
            if (subscription.type === 'monthly' && payment.subscriptionType === 'monthly') {
                response += `**💡 РЕКОМЕНДАЦИЯ:**\n`;
                response += `У пользователя уже есть месячный абонемент.\n`;
                response += `Можно добавить занятия к текущему или создать новый.\n`;
            }
        }
        
        response += `**Выберите действие:**`;
        
        await ctx.reply(response, {
            format: 'markdown',
            attachments: [keyboard]
        });
        
    } catch (error) {
        logToFile(`❌ Ошибка admin_view_payment: ${error.message}`);
    }
});

// Подтверждение оплаты администратором
bot.action(/^admin_confirm_payment_(.+)$/, async (ctx) => {
    try {
        const adminId = getUserId(ctx);
        if (!isAdmin(adminId)) return;
        
        const paymentId = ctx.match[1];
        const payment = pendingPayments[paymentId];
        
        if (!payment) {
            await ctx.reply('❌ Платеж не найден', { format: 'markdown' });
            return;
        }
        
        // Удаляем предыдущее сообщение
        try {
            await ctx.deleteMessage();
        } catch (deleteError) {
            logToFile(`⚠️ Не удалось удалить сообщение: ${deleteError.message}`);
        }
        
        // Добавляем абонемент пользователю
        userSubscriptions[payment.userId] = {
            type: payment.subscriptionType,
            lessons: payment.lessons,
            cost: payment.amount,
            startDate: new Date().toISOString(),
            lastUsed: null
        };
        
        saveSubscriptions();
        
        // Обновляем статистику
        const stats = userStats[payment.userId] || updateUserStats(payment.userId, payment.userName, 'payment', null);
        if (!stats.subscriptionHistory) {
            stats.subscriptionHistory = [];
        }
        stats.subscriptionHistory.push({
            date: new Date().toISOString(),
            type: payment.subscriptionType,
            lessons: payment.lessons,
            startDate: new Date().toISOString(),
            lastUsed: null
        });
        saveUserStats();
        
        // Удаляем платеж из ожидающих
        delete pendingPayments[paymentId];
        
        // Отправляем уведомление пользователю
        try {
            await bot.api.sendMessageToUser(
                payment.userId,
                `**✅ ОПЛАТА ПОДТВЕРЖДЕНА!**\n\n` +
                `Ваш платеж на сумму **${payment.amount} руб.** подтвержден администратором.\n\n` +
                `**📋 АБОНЕМЕНТ АКТИВИРОВАН:**\n` +
                `Тип: ${payment.subscriptionType === 'monthly' ? '📅 Месячный' : '🎫 Разовое посещение'}\n` +
                `Занятий: ${payment.lessons}\n` +
                `Дата активации: ${new Date().toLocaleDateString('ru-RU')}\n` +
                `Срок действия: ${payment.subscriptionType === 'monthly' ? '30 дней' : 'неограничен'}\n\n` +
                `**🎯 Теперь вы можете записываться на тренировки!**\n` +
                `Используйте /записаться или кнопку в опросе.`,
                { format: 'markdown' }
            );
        } catch (userError) {
            logToFile(`⚠️ Не удалось отправить уведомление пользователю: ${userError.message}`);
        }
        
        const keyboard = Keyboard.inlineKeyboard([
            [
                Keyboard.button.callback('« Назад к платежам', 'ожидающие_платежи')
            ]
        ]);
        
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + 30);
        
        await ctx.reply(
            `**✅ ПЛАТЕЖ ПОДТВЕРЖДЕН!**\n\n` +
            `**🆔 ID платежа:** ${paymentId}\n` +
            `**👤 Пользователь:** ${payment.userName}\n` +
            `**💰 Сумма:** ${payment.amount} руб.\n\n` +
            
            `**📋 АБОНЕМЕНТ АКТИВИРОВАН:**\n` +
            `Тип: ${payment.subscriptionType === 'monthly' ? '📅 Месячный' : '🎫 Разовое посещение'}\n` +
            `Занятий: ${payment.lessons}\n` +
            `Дата начала: ${new Date().toLocaleDateString('ru-RU')}\n` +
            `Действует до: ${payment.subscriptionType === 'monthly' ? endDate.toLocaleDateString('ru-RU') : 'неограниченно'}\n\n` +
            
            `**📨 УВЕДОМЛЕНИЕ:**\n` +
            `Пользователь получил сообщение об активации абонемента.\n\n` +
            
            `**✅ ОПЕРАЦИЯ УСПЕШНО ЗАВЕРШЕНА**`,
            {
                format: 'markdown',
                attachments: [keyboard]
            }
        );
        
        logToFile(`✅ Админ ${adminId} подтвердил платеж ${paymentId} для пользователя ${payment.userName}`);
        
    } catch (error) {
        logToFile(`❌ Ошибка admin_confirm_payment: ${error.message}`);
    }
});


// Связь с пользователем
bot.action(/^admin_contact_user_(\d+)$/, async (ctx) => {
    try {
        const adminId = getUserId(ctx);
        if (!isAdmin(adminId)) return;
        
        const userId = ctx.match[1];
        const user = userStats[userId];
        
        if (!user) {
            await ctx.reply('❌ Пользователь не найден', { format: 'markdown' });
            return;
        }
        
        // Удаляем предыдущее сообщение
        try {
            await ctx.deleteMessage();
        } catch (deleteError) {
            logToFile(`⚠️ Не удалось удалить сообщение: ${deleteError.message}`);
        }
        
        const keyboard = Keyboard.inlineKeyboard([
            [
                Keyboard.button.callback('« Назад', 'ожидающие_платежи')
            ]
        ]);
        
        await ctx.reply(
            `**📞 КОНТАКТЫ ПОЛЬЗОВАТЕЛЯ**\n\n` +
            `**👤 ИНФОРМАЦИЯ:**\n` +
            `Имя: **${user.name}**\n` +
            `ID: ${userId}\n` +
            `Посещений: ${user.attended || 0}\n` +
            `Последняя активность: ${new Date(user.lastActivity).toLocaleDateString('ru-RU')}\n\n` +
            
            `**💡 КАК СВЯЗАТЬСЯ:**\n` +
            `1. **Напишите пользователю в личные сообщения**\n` +
            `2. **Используйте команду:**\n` +
            `\`/msg ${userId} Ваше сообщение\`\n\n` +
            
            `**📞 ТЕЛЕФОН АДМИНИСТРАТОРА:**\n` +
            `+7 (925) 225-13-36\n\n` +
            
            `**💬 ШАБЛОНЫ СООБЩЕНИЙ:**\n` +
            `• "Здравствуйте, это администратор. Уточните пожалуйста детали платежа."\n` +
            `• "Ваш платеж подтвержден, абонемент активирован!"\n` +
            `• "Проверьте пожалуйста перевод, деньги не поступили."`,
            {
                format: 'markdown',
                attachments: [keyboard]
            }
        );
        
    } catch (error) {
        logToFile(`❌ Ошибка admin_contact_user: ${error.message}`);
    }
});
// Обработчик кнопки "Добавить абонемент"
bot.action('admin_add_subscription', async (ctx) => {
    try {
        const adminId = getUserId(ctx);
        if (!isAdmin(adminId)) return;
        
        // Удаляем предыдущее сообщение
        try {
            await ctx.deleteMessage();
        } catch (deleteError) {
            logToFile(`⚠️ Не удалось удалить сообщение: ${deleteError.message}`);
        }
        
        // Получаем список пользователей (например, последние 20 активных)
        const users = Object.entries(userStats)
            .sort((a, b) => new Date(b[1].lastActivity) - new Date(a[1].lastActivity))
            .slice(0, 20);
        
        if (users.length === 0) {
            await ctx.reply(
                '**📭 НЕТ ПОЛЬЗОВАТЕЛЕЙ**\n\n' +
                'В системе пока нет пользователей.',
                { format: 'markdown' }
            );
            return;
        }
        
        // Создаем клавиатуру с пользователями
        const keyboardButtons = [];
        
        users.forEach(([userId, user], index) => {
            const userName = user.name || `Пользователь ${userId}`;
            const visited = user.attended || 0;
            const lastActive = new Date(user.lastActivity).toLocaleDateString('ru-RU');
            
            keyboardButtons.push([
                Keyboard.button.callback(
                    `${index + 1}. ${userName} (📅 ${lastActive}, 🏃 ${visited} пос.)`,
                    `admin_select_user_${userId}`
                )
            ]);
        });
        
        // Кнопки назад и обновления
        keyboardButtons.push([
            Keyboard.button.callback('🔄 Обновить список', 'admin_add_subscription'),
            Keyboard.button.callback('« В админ панель', 'admin_back')
        ]);
        
        const keyboard = Keyboard.inlineKeyboard(keyboardButtons);
        
        await ctx.reply(
            `**📝 ВЫБОР ПОЛЬЗОВАТЕЛЯ ДЛЯ АБОНЕМЕНТА**\n\n` +
            `**Всего пользователей:** ${users.length}\n\n` +
            `**📋 ИНФОРМАЦИЯ:**\n` +
            `• Выберите пользователя для добавления абонемента\n` +
            `• Показаны последние 20 активных пользователей\n` +
            `• Можно обновить список кнопкой ниже\n\n` +
            `**👇 Выберите пользователя:**`,
            {
                format: 'markdown',
                attachments: [keyboard]
            }
        );
        
    } catch (error) {
        logToFile(`❌ Ошибка admin_add_subscription: ${error.message}`);
    }
});
// Обработчик выбора пользователя
bot.action(/^admin_select_user_(\d+)$/, async (ctx) => {
    try {
        const adminId = getUserId(ctx);
        if (!isAdmin(adminId)) return;
        
        const userId = ctx.match[1];
        const user = userStats[userId];
        
        if (!user) {
            await ctx.reply('❌ Пользователь не найден', { format: 'markdown' });
            return;
        }
        
        // Удаляем предыдущее сообщение
        try {
            await ctx.deleteMessage();
        } catch (deleteError) {
            logToFile(`⚠️ Не удалось удалить сообщение: ${deleteError.message}`);
        }
        
        const userName = user.name || `Пользователь ${userId}`;
        const currentSubscription = userSubscriptions[userId];
        
        // Создаем клавиатуру с типами абонементов
        const keyboard = Keyboard.inlineKeyboard([
            [
                Keyboard.button.callback('🎫 Разовое посещение', `admin_select_subscription_type_${userId}_single`),
                Keyboard.button.callback('📅 Месячный абонемент', `admin_select_subscription_type_${userId}_monthly`)
            ],
            [
                Keyboard.button.callback('« Назад к выбору пользователя', 'admin_add_subscription')
            ]
        ]);
        
        let response = `**📝 ВЫБОР ТИПА АБОНЕМЕНТА**\n\n`;
        
        response += `**👤 ПОЛЬЗОВАТЕЛЬ:**\n`;
        response += `Имя: **${userName}**\n`;
        response += `ID: ${userId}\n`;
        response += `Посещений: ${user.attended || 0}\n`;
        response += `Последняя активность: ${new Date(user.lastActivity).toLocaleDateString('ru-RU')}\n\n`;
        
        if (currentSubscription) {
            response += `**⚠️ ВНИМАНИЕ:**\n`;
            response += `У пользователя уже есть активный абонемент!\n`;
            response += `Тип: ${currentSubscription.type === 'monthly' ? '📅 Месячный' : '🎫 Разовое посещение'}\n`;
            response += `Осталось занятий: ${currentSubscription.lessons}\n`;
            response += `Дата начала: ${new Date(currentSubscription.startDate).toLocaleDateString('ru-RU')}\n\n`;
            
            response += `**💡 РЕКОМЕНДАЦИЯ:**\n`;
            if (currentSubscription.type === 'monthly') {
                response += `Можно добавить занятия к текущему абонементу.\n`;
            }
            response += `Или создать новый абонемент (старый будет заменен).\n\n`;
        }
        
        response += `**🎫 ТИПЫ АБОНЕМЕНТОВ:**\n`;
        response += `• **Разовое посещение** - 1 занятие\n`;
        response += `• **Месячный абонемент** - 8 занятий на 30 дней\n\n`;
        
        response += `**👇 Выберите тип абонемента:**`;
        
        await ctx.reply(response, {
            format: 'markdown',
            attachments: [keyboard]
        });
        
    } catch (error) {
        logToFile(`❌ Ошибка admin_select_user: ${error.message}`);
    }
});
// Обработчик выбора типа абонемента
bot.action(/^admin_select_subscription_type_(\d+)_(.+)$/, async (ctx) => {
    try {
        const adminId = getUserId(ctx);
        if (!isAdmin(adminId)) return;
        
        const userId = ctx.match[1];
        const subscriptionType = ctx.match[2]; // 'single' или 'monthly'
        const user = userStats[userId];
        
        if (!user) {
            await ctx.reply('❌ Пользователь не найден', { format: 'markdown' });
            return;
        }
        
        // Удаляем предыдущее сообщение
        try {
            await ctx.deleteMessage();
        } catch (deleteError) {
            logToFile(`⚠️ Не удалось удалить сообщение: ${deleteError.message}`);
        }
        
        const userName = user.name || `Пользователь ${userId}`;
        
        // Определяем параметры в зависимости от типа
        let lessonOptions = [];
        
        if (subscriptionType === 'single') {
            // Разовые посещения
            lessonOptions = [
                { lessons: 1, price: 700 },
                { lessons: 2, price: 1400 }
            ];
        } else { 
            // Месячный абонемент
            lessonOptions = [
                { lessons: 2, price: 1025 },   // 2 занятия
                { lessons: 6, price: 3300 },   // 6 занятий
                { lessons: 8, price: 4400 },   // 8 занятий (стандартный)
                { lessons: 8, price: 4100, discount: true } // 8 занятий со скидкой
            ];
        }
        
        // Создаем клавиатуру с количеством занятий
        const keyboardButtons = [];
        
        // Создаем кнопки в зависимости от количества опций
        if (lessonOptions.length <= 2) {
            // Для 1-2 опций в один ряд
            const row = lessonOptions.map(option => {
                const label = option.discount ? 
                    `🎁 ${option.lessons} занятий - ${option.price} руб. (скидка!)` :
                    `${option.lessons} занятий - ${option.price} руб.`;
                
                return Keyboard.button.callback(
                    label,
                    `admin_select_lessons_${userId}_${subscriptionType}_${option.lessons}_${option.price}_${option.discount ? 'discount' : 'regular'}`
                );
            });
            keyboardButtons.push(row);
        } else {
            // Для большего количества опций распределяем по рядам
            const firstRow = lessonOptions.slice(0, 2).map(option => {
                const label = option.discount ? 
                    `🎁 ${option.lessons} занятий - ${option.price} руб.` :
                    `${option.lessons} занятий - ${option.price} руб.`;
                
                return Keyboard.button.callback(
                    label,
                    `admin_select_lessons_${userId}_${subscriptionType}_${option.lessons}_${option.price}_${option.discount ? 'discount' : 'regular'}`
                );
            });
            keyboardButtons.push(firstRow);
            
            const secondRow = lessonOptions.slice(2).map(option => {
                const label = option.discount ? 
                    `🎁 ${option.lessons} занятий - ${option.price} руб. (скидка!)` :
                    `${option.lessons} занятий - ${option.price} руб.`;
                
                return Keyboard.button.callback(
                    label,
                    `admin_select_lessons_${userId}_${subscriptionType}_${option.lessons}_${option.price}_${option.discount ? 'discount' : 'regular'}`
                );
            });
            keyboardButtons.push(secondRow);
        }
        
        // Кнопки назад
        keyboardButtons.push([
            Keyboard.button.callback('« Назад к выбору типа', `admin_select_user_${userId}`)
        ]);
        
        const keyboard = Keyboard.inlineKeyboard(keyboardButtons);
        
        let response = `**📝 ВЫБОР КОЛИЧЕСТВА ЗАНЯТИЙ**\n\n`;
        
        response += `**👤 ПОЛЬЗОВАТЕЛЬ:** ${userName}\n`;
        response += `**📋 ТИП АБОНЕМЕНТА:** ${subscriptionType === 'monthly' ? '📅 Месячный' : '🎫 Разовое посещение'}\n\n`;
        
        if (subscriptionType === 'single') {
            response += `**🎫 РАЗОВЫЕ ПОСЕЩЕНИЯ:**\n`;
            response += `• Цена за занятие: 700 руб.\n`;
            response += `• Срок действия: неограничен\n`;
            response += `• Можно использовать в любое время\n\n`;
            
            response += `**💰 СТОИМОСТЬ:**\n`;
            response += `• 1 занятие: **700 руб.**\n`;
            response += `• 2 занятия: **1400 руб.**\n`;
            
        } else {
            response += `**📅 МЕСЯЧНЫЙ АБОНЕМЕНТ:**\n`;
            response += `• Действует 30 дней с момента активации\n`;
            response += `• Можно посещать любые тренировки\n`;
            response += `• Неиспользованные занятия сгорают\n\n`;
            
            response += `**💰 СТОИМОСТЬ:**\n`;
            response += `• 2 занятия: **1025 руб.** (512.5 руб./занятие)\n`;
            response += `• 6 занятий: **3300 руб.** (550 руб./занятие)\n`;
            response += `• 8 занятий: **4400 руб.** (550 руб./занятие)\n`;
            response += `• 🎁 8 занятий со скидкой: **4100 руб.** (512.5 руб./занятие)\n`;
            
            response += `\n**💡 ВЫГОДА:**\n`;
            response += `• 8 занятий со скидкой экономит **300 руб.**\n`;
            response += `• По сравнению со стандартным 8-занятиями\n`;
        }
        
        response += `\n**👇 Выберите количество занятий:**`;
        
        await ctx.reply(response, {
            format: 'markdown',
            attachments: [keyboard]
        });
        
    } catch (error) {
        logToFile(`❌ Ошибка admin_select_subscription_type: ${error.message}`);
    }
});

// Обработчик выбора количества занятий
bot.action(/^admin_select_lessons_(\d+)_(.+)_(\d+)_(\d+)_(.+)$/, async (ctx) => {
    try {
        const adminId = getUserId(ctx);
        if (!isAdmin(adminId)) return;
        
        const userId = ctx.match[1];
        const subscriptionType = ctx.match[2]; // 'single' или 'monthly'
        const lessons = parseInt(ctx.match[3]);
        const amount = parseInt(ctx.match[4]);
        const discountType = ctx.match[5]; // 'regular' или 'discount'
        const user = userStats[userId];
        
        if (!user) {
            await ctx.reply('❌ Пользователь не найден', { format: 'markdown' });
            return;
        }
        
        // Удаляем предыдущее сообщение
        try {
            await ctx.deleteMessage();
        } catch (deleteError) {
            logToFile(`⚠️ Не удалось удалить сообщение: ${deleteError.message}`);
        }
        
        const userName = user.name || `Пользователь ${userId}`;
        
        // Проверяем текущий абонемент
        const currentSubscription = userSubscriptions[userId];
        
        // Создаем клавиатуру для подтверждения
        const keyboard = Keyboard.inlineKeyboard([
            [
                Keyboard.button.callback('✅ Да, добавить абонемент', `admin_confirm_add_subscription_${userId}_${subscriptionType}_${lessons}_${amount}_${discountType}`),
                Keyboard.button.callback('❌ Нет, отмена', `admin_select_user_${userId}`)
            ]
        ]);
        
        let response = `**✅ ПОДТВЕРЖДЕНИЕ ДОБАВЛЕНИЯ АБОНЕМЕНТА**\n\n`;
        
        response += `**👤 ПОЛЬЗОВАТЕЛЬ:** ${userName}\n`;
        response += `**📋 ТИП АБОНЕМЕНТА:** ${subscriptionType === 'monthly' ? '📅 Месячный' : '🎫 Разовое посещение'}\n`;
        response += `**🎫 КОЛИЧЕСТВО ЗАНЯТИЙ:** ${lessons}\n`;
        response += `**💰 СТОИМОСТЬ:** ${amount} руб.\n`;
        
        if (discountType === 'discount') {
            response += `**🎁 ТИП:** Абонемент со скидкой\n`;
            
            // Рассчитываем экономию
            let regularPrice = 0;
            if (lessons === 8) regularPrice = 4400;
            
            if (regularPrice > 0) {
                const savings = regularPrice - amount;
                response += `**💎 ЭКОНОМИЯ:** ${savings} руб.\n`;
            }
        }
        
        response += `\n`;
        
        if (currentSubscription) {
            response += `**⚠️ ВНИМАНИЕ:**\n`;
            response += `У пользователя уже есть активный абонемент!\n`;
            response += `Тип: ${currentSubscription.type === 'monthly' ? '📅 Месячный' : '🎫 Разовое посещение'}\n`;
            response += `Осталось занятий: ${currentSubscription.lessons}\n`;
            response += `Дата начала: ${new Date(currentSubscription.startDate).toLocaleDateString('ru-RU')}\n\n`;
            
            response += `**💡 ДЕЙСТВИЕ:**\n`;
            response += `Текущий абонемент будет **ЗАМЕНЕН** на новый!\n`;
            response += `Неиспользованные занятия сгорят.\n\n`;
        }
        
        response += `**📅 ПАРАМЕТРЫ НОВОГО АБОНЕМЕНТА:**\n`;
        response += `• Дата активации: ${new Date().toLocaleDateString('ru-RU')}\n`;
        
        if (subscriptionType === 'monthly') {
            const endDate = new Date();
            endDate.setDate(endDate.getDate() + 30);
            response += `• Действует до: ${endDate.toLocaleDateString('ru-RU')}\n`;
            
            // Рассчитываем цену за занятие
            const pricePerLesson = Math.round(amount / lessons);
            response += `• Цена за занятие: ${pricePerLesson} руб.\n`;
        } else {
            response += `• Срок действия: неограничен\n`;
            response += `• Цена за занятие: ${amount / lessons} руб.\n`;
        }
        
        response += `• Занятий: ${lessons}\n`;
        response += `• Стоимость: ${amount} руб.\n\n`;
        
        if (discountType === 'discount') {
            response += `**🎁 **Это абонемент со специальной скидкой!\n\n`;
        }
        
        response += `**Вы уверены, что хотите добавить этот абонемент?**`;
        
        await ctx.reply(response, {
            format: 'markdown',
            attachments: [keyboard]
        });
        
    } catch (error) {
        logToFile(`❌ Ошибка admin_select_lessons: ${error.message}`);
    }
});

// Обработчик подтверждения добавления абонемента
bot.action(/^admin_confirm_add_subscription_(\d+)_(.+)_(\d+)_(\d+)_(.+)$/, async (ctx) => {
    try {
        const adminId = getUserId(ctx);
        if (!isAdmin(adminId)) return;
        
        const userId = ctx.match[1];
        const subscriptionType = ctx.match[2];
        const lessons = parseInt(ctx.match[3]);
        const amount = parseInt(ctx.match[4]);
        const discountType = ctx.match[5]; // 'regular' или 'discount'
        const user = userStats[userId];
        
        if (!user) {
            await ctx.reply('❌ Пользователь не найден', { format: 'markdown' });
            return;
        }
        
        // Удаляем предыдущее сообщение
        try {
            await ctx.deleteMessage();
        } catch (deleteError) {
            logToFile(`⚠️ Не удалось удалить сообщение: ${deleteError.message}`);
        }
        
        const userName = user.name || `Пользователь ${userId}`;
        const currentSubscription = userSubscriptions[userId];
        
        // Сохраняем старый абонемент для истории
        if (currentSubscription) {
            if (!user.subscriptionHistory) {
                user.subscriptionHistory = [];
            }
            user.subscriptionHistory.push({
                ...currentSubscription,
                replacedAt: new Date().toISOString(),
                replacedBy: {
                    type: subscriptionType,
                    lessons: lessons,
                    cost: amount,
                    discount: discountType === 'discount',
                    startDate: new Date().toISOString()
                }
            });
        }
        
        // Создаем новый абонемент
        userSubscriptions[userId] = {
            type: subscriptionType,
            lessons: lessons,
            cost: amount,
            startDate: new Date().toISOString(),
            lastUsed: null,
            addedByAdmin: true,
            adminId: adminId,
            addedAt: new Date().toISOString(),
            discount: discountType === 'discount' // Добавляем флаг скидки
        };
        
        // Обновляем историю в статистике
        if (!user.subscriptionHistory) {
            user.subscriptionHistory = [];
        }
        user.subscriptionHistory.push({
            date: new Date().toISOString(),
            type: subscriptionType,
            lessons: lessons,
            cost: amount,
            startDate: new Date().toISOString(),
            addedByAdmin: true,
            adminId: adminId,
            discount: discountType === 'discount'
        });
        
        // Сохраняем данные
        saveSubscriptions();
        saveUserStats();
        
        // Отправляем уведомление пользователю
        try {
            let userMessage = `**🎉 ВАМ ДОБАВЛЕН АБОНЕМЕНТ!**\n\n`;
            userMessage += `Администратор добавил вам новый абонемент.\n\n`;
            userMessage += `**📋 ДЕТАЛИ АБОНЕМЕНТА:**\n`;
            userMessage += `• Тип: ${subscriptionType === 'monthly' ? '📅 Месячный' : '🎫 Разовое посещение'}\n`;
            userMessage += `• Занятий: ${lessons}\n`;
            
            if (discountType === 'discount') {
                userMessage += `• 🎁 **Абонемент со скидкой**\n`;
                
                // Показываем экономию
                if (lessons === 8) {
                    const regularPrice = 4400;
                    const savings = regularPrice - amount;
                    userMessage += `• 💎 **Экономия: ${savings} руб.**\n`;
                }
            }
            
            if (subscriptionType === 'monthly') {
                const endDate = new Date();
                endDate.setDate(endDate.getDate() + 30);
                userMessage += `• Действует до: ${endDate.toLocaleDateString('ru-RU')}\n`;
                
                // Цена за занятие
                const pricePerLesson = Math.round(amount / lessons);
                userMessage += `• Цена за занятие: ${pricePerLesson} руб.\n`;
            } else {
                userMessage += `• Срок действия: неограничен\n`;
                userMessage += `• Цена за занятие: ${amount / lessons} руб.\n`;
            }
            
            userMessage += `• Дата активации: ${new Date().toLocaleDateString('ru-RU')}\n`;
            userMessage += `• Стоимость: ${amount} руб.\n\n`;
            
            if (currentSubscription) {
                userMessage += `**📝 ПРИМЕЧАНИЕ:**\n`;
                userMessage += `Предыдущий абонемент был заменен на новый.\n\n`;
            }
            
            userMessage += `**🎯 Теперь вы можете записываться на тренировки!**\n`;
            userMessage += `Используйте /записаться или кнопку в опросе.\n\n`;
            userMessage += `Спасибо, что занимаетесь у нас! 💪`;
            
            await bot.api.sendMessageToUser(userId, userMessage, { format: 'markdown' });
        } catch (userError) {
            logToFile(`⚠️ Не удалось отправить уведомление пользователю: ${userError.message}`);
        }
        
        // Создаем клавиатуру
        const keyboard = Keyboard.inlineKeyboard([
            [
                Keyboard.button.callback('➕ Добавить еще абонемент', 'admin_add_subscription'),
                Keyboard.button.callback('« В админ панель', 'admin_back')
            ]
        ]);
        
        let response = `**✅ АБОНЕМЕНТ УСПЕШНО ДОБАВЛЕН!**\n\n`;
        
        response += `**👤 ПОЛЬЗОВАТЕЛЬ:** ${userName}\n`;
        response += `**📋 ТИП АБОНЕМЕНТА:** ${subscriptionType === 'monthly' ? '📅 Месячный' : '🎫 Разовое посещение'}\n`;
        response += `**🎫 КОЛИЧЕСТВО ЗАНЯТИЙ:** ${lessons}\n`;
        response += `**💰 СТОИМОСТЬ:** ${amount} руб.\n`;
        
        if (discountType === 'discount') {
            response += `**🎁 ТИП:** Абонемент со скидкой\n`;
            
            // Показываем экономию
            if (lessons === 8) {
                const regularPrice = 4400;
                const savings = regularPrice - amount;
                response += `**💎 ЭКОНОМИЯ:** ${savings} руб.\n`;
            }
        }
        
        response += `**📅 ДАТА АКТИВАЦИИ:** ${new Date().toLocaleDateString('ru-RU')}\n`;
        
        if (subscriptionType === 'monthly') {
            const endDate = new Date();
            endDate.setDate(endDate.getDate() + 30);
            response += `**⏰ ДЕЙСТВУЕТ ДО:** ${endDate.toLocaleDateString('ru-RU')}\n`;
            
            // Цена за занятие
            const pricePerLesson = Math.round(amount / lessons);
            response += `**🏷️ ЦЕНА ЗА ЗАНЯТИЕ:** ${pricePerLesson} руб.\n`;
        }
        
        response += `\n**✅ ВЫПОЛНЕННЫЕ ДЕЙСТВИЯ:**\n`;
        response += `1. Абонемент создан и активирован ✅\n`;
        response += `2. Данные сохранены в системе ✅\n`;
        response += `3. Пользователь получил уведомление ✅\n`;
        
        if (currentSubscription) {
            response += `4. Старый абонемент заменен ✅\n`;
        }
        
        if (discountType === 'discount') {
            response += `5. Скидка применена ✅\n`;
        }
        
        response += `\n**🎯 ОПЕРАЦИЯ УСПЕШНО ЗАВЕРШЕНА**`;
        
        await ctx.reply(response, {
            format: 'markdown',
            attachments: [keyboard]
        });
        
        logToFile(`✅ Админ ${adminId} добавил абонемент пользователю ${userName} (ID: ${userId}): ${subscriptionType}, ${lessons} занятий, ${amount} руб.${discountType === 'discount' ? ' (со скидкой)' : ''}`);
        
    } catch (error) {
        logToFile(`❌ Ошибка admin_confirm_add_subscription: ${error.message}`);
        await ctx.reply('❌ Произошла ошибка при добавлении абонемента', { format: 'markdown' });
    }
});
// Команда для отправки сообщения пользователю (для админов)
bot.command('msg', async (ctx) => {
    try {
        const adminId = getUserId(ctx);
        if (!isAdmin(adminId)) {
            await ctx.reply('❌ Доступ запрещен!', { format: 'markdown' });
            await ctx.deleteMessage();
            return;
        }
        
        const messageText = ctx.message.text;
        const parts = messageText.split(' ');
        
        if (parts.length < 3) {
            await ctx.reply(
                `*❌ НЕВЕРНЫЙ ФОРМАТ КОМАНДЫ*\n\n` +
                `Правильный формат:\n` +
                `\`/msg ID_пользователя Текст сообщения\`\n\n` +
                `Пример:\n` +
                `\`/msg 12345678 Привет, это администратор!\``,
                { format: 'markdown' }
            );
            await ctx.deleteMessage();
            return;
        }
        
        const targetUserId = parts[1];
        const userMessage = parts.slice(2).join(' ');
        
        // Пытаемся отправить сообщение пользователю
        try {
            await bot.api.sendMessageToUser(
                targetUserId,
                `**📨 СООБЩЕНИЕ ОТ АДМИНИСТРАТОРА**\n\n` +
                `${userMessage}\n\n` +
                `---\n` +
                `*Это автоматическое сообщение от системы.*`,
                { format: 'markdown' }
            );
            
            await ctx.reply(
                `✅ *СООБЩЕНИЕ ОТПРАВЛЕНО!*\n\n` +
                `👤 *Кому:* ${targetUserId}\n` +
                `📝 *Текст:* ${userMessage}\n\n` +
                `Пользователь получит ваше сообщение.`,
                { format: 'markdown' }
            );
            
            logToFile(`📨 Админ ${adminId} отправил сообщение пользователю ${targetUserId}: ${userMessage}`);
            
        } catch (sendError) {
            await ctx.reply(
                `❌ *НЕ УДАЛОСЬ ОТПРАВИТЬ СООБЩЕНИЕ*\n\n` +
                `Пользователь с ID ${targetUserId} не найден или заблокировал бота.\n\n` +
                `Попробуйте связаться другим способом.`,
                { format: 'markdown' }
            );
            logToFile(`❌ Не удалось отправить сообщение пользователю ${targetUserId}: ${sendError.message}`);
        }
        
        await ctx.deleteMessage();
        
    } catch (error) {
        logToFile(`❌ Ошибка команды /msg: ${error.message}`);
    }
});
// ========== ОБРАБОТЧИКИ АДМИН-ПАНЕЛИ ==========

// Кнопка "Назад в админ"
bot.action('admin_back', async (ctx) => {
    try {
        const userId = getUserId(ctx);
        if (!isAdmin(userId)) return;
        
        await ctx.deleteMessage();
        
        // Создаем админ-панель
        const today = new Date().toISOString().split('T')[0];
        const currentPoll = dailyPolls[today] || { yes: [], no: [], maybe: [] };
        const pollParticipants = (currentPoll.yes ? currentPoll.yes.length : 0) + 
                                (currentPoll.no ? currentPoll.no.length : 0) + 
                                (currentPoll.maybe ? currentPoll.maybe.length : 0);
        
        const totalUsers = Object.keys(userStats).length;
        const totalSubs = Object.keys(userSubscriptions).length;
        
        let activeSubs = 0;
        Object.values(userSubscriptions).forEach(sub => {
            if (sub.lessons > 0) {
                const endDate = new Date(sub.startDate);
                endDate.setDate(endDate.getDate() + 30);
                if (new Date() <= endDate) {
                    activeSubs++;
                }
            }
        });
        
        const keyboard = Keyboard.inlineKeyboard([
            [
                Keyboard.button.callback('📊 Статистика', 'admin_stats'),
                Keyboard.button.callback('👥 Пользователи', 'admin_users')
            ],
            [
                Keyboard.button.callback('📋 Абонементы', 'admin_subs'),
                Keyboard.button.callback('💰 Платежи', 'ожидающие_платежи')
            ],
            [
                Keyboard.button.callback('🗑️ Удалить', 'admin_delete')
            ]
        ]);
        
        await ctx.reply(
            `*👑 АДМИН ПАНЕЛЬ*\n\n` +
            `*📈 СИСТЕМНАЯ СТАТИСТИКА:*\n` +
            `👥 Пользователей: *${totalUsers}*\n` +
            `📋 Абонементов: *${totalSubs}*\n` +
            `✅ Активных: *${activeSubs}*\n\n` +
            
            `*📅 СЕГОДНЯШНИЙ ОПРОС:*\n` +
            `✅ Идут: *${currentPoll.yes ? currentPoll.yes.length : 0}*\n` +
            `❌ Не идут: *${currentPoll.no ? currentPoll.no.length : 0}*\n` +
            `❓ Возможно: *${currentPoll.maybe ? currentPoll.maybe.length : 0}*\n` +
            `👥 Всего: *${pollParticipants}*\n\n` +
            
            `*📅 Дата:* ${new Date().toLocaleDateString('ru-RU')}\n` +
            `*⏰ Время:* ${new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}\n\n` +
            
            `*Выберите действие:*`,
            {
                attachments: [keyboard],
                format: 'markdown'
            }
        );
        
    } catch (error) {
        logToFile(`❌ Ошибка admin_back: ${error.message}`);
    }
});

// 1. ОБЩАЯ СТАТИСТИКА
bot.action('admin_stats', async (ctx) => {
    try {
        const userId = getUserId(ctx);
        if (!isAdmin(userId)) return;
        
        await ctx.deleteMessage();
        
        const keyboard = Keyboard.inlineKeyboard([
            [
                Keyboard.button.callback('📊 Детальная финансовая', 'admin_stats_finance')
            ],
            [
                Keyboard.button.callback('« Назад в админ', 'admin_back')
            ]
        ]);
        
        // Расчет финансовой статистики
        let monthlyRevenue = 0;
        let singleRevenue = 0;
        let monthlyCount = 0;
        let singleCount = 0;
        let totalRevenue = 0;
        
        Object.values(userSubscriptions).forEach(sub => {
            if (sub.type === 'monthly') {
                monthlyRevenue += 4400;
                monthlyCount++;
            } else {
                singleRevenue += 700;
                singleCount++;
            }
        });
        
        totalRevenue = monthlyRevenue + singleRevenue;
        const totalCount = monthlyCount + singleCount;
        
        // Активные абонементы
        let activeSubs = 0;
        Object.values(userSubscriptions).forEach(sub => {
            if (sub.lessons > 0) {
                const endDate = new Date(sub.startDate);
                endDate.setDate(endDate.getDate() + 30);
                if (new Date() <= endDate) {
                    activeSubs++;
                }
            }
        });
        
        let response = `**📊 ФИНАНСОВАЯ СТАТИСТИКА**\n\n`;
        
        response += `**💰 ОБЩАЯ ВЫРУЧКА:**\n`;
        response += `Всего: **${totalRevenue} руб.**\n`;
        response += `Месячные абонементы: **${monthlyRevenue} руб.**\n`;
        response += `Разовые абонементы: **${singleRevenue} руб.**\n\n`;
        
        response += `**📦 КОЛИЧЕСТВО ПРОДАЖ:**\n`;
        response += `Всего продаж: **${totalCount}**\n`;
        response += `Месячных: **${monthlyCount}**\n`;
        response += `Разовых: **${singleCount}**\n`;
        response += `Средний чек: **${totalCount > 0 ? Math.round(totalRevenue / totalCount) : 0} руб.**\n\n`;
        
        response += `**📊 ДОЛИ В ВЫРУЧКЕ:**\n`;
        const monthlyPercent = totalRevenue > 0 ? Math.round((monthlyRevenue / totalRevenue) * 100) : 0;
        const singlePercent = totalRevenue > 0 ? Math.round((singleRevenue / totalRevenue) * 100) : 0;
        response += `Месячные: **${monthlyPercent}%**\n`;
        response += `Разовые: **${singlePercent}%**\n\n`;
        
        response += `**✅ АКТИВНЫЕ АБОНЕМЕНТЫ:**\n`;
        response += `Всего активных: **${activeSubs}**\n`;
        response += `Из них месяцных: **${Object.values(userSubscriptions).filter(sub => 
            sub.type === 'monthly' && sub.lessons > 0
        ).length}**\n`;
        response += `Из них разовых: **${Object.values(userSubscriptions).filter(sub => 
            sub.type === 'single' && sub.lessons > 0
        ).length}**\n\n`;
        
        // Конверсия
        const totalUsers = Object.keys(userStats).length;
        const conversionRate = totalCount > 0 ? Math.round((totalCount / totalUsers) * 100) : 0;
        response += `**📈 КОНВЕРСИЯ:**\n`;
        response += `Пользователей: **${totalUsers}**\n`;
        response += `Купивших абонемент: **${totalCount}**\n`;
        response += `Конверсия: **${conversionRate}%**\n\n`;
        
        // Рекомендации
        response += `**💡 РЕКОМЕНДАЦИИ:**\n`;
        if (monthlyPercent < 60) {
            response += `📈 Увеличить продажи месячных абонементов\n`;
        }
        if (conversionRate < 30) {
            response += `🎯 Улучшить конверсию из пользователей в покупателей\n`;
        }
        if (activeSubs < totalCount * 0.3) {
            response += `⏰ Много неиспользованных абонементов\n`;
        }
        
        await ctx.reply(response, {
            format: 'markdown',
            attachments: [keyboard]
        });
        
    } catch (error) {
        logToFile(`❌ Ошибка admin_stats: ${error.message}`);
    }
});

// 1.1 Финансовая статистика
bot.action('admin_stats_finance', async (ctx) => {
    try {
        const userId = getUserId(ctx);
        if (!isAdmin(userId)) return;
        
        await ctx.deleteMessage();
        
        const keyboard = Keyboard.inlineKeyboard([
            [
                Keyboard.button.callback('« Назад к статистике', 'admin_stats')
            ]
        ]);
        
        // Расчет финансов
        let monthlyRevenue = 0;
        let singleRevenue = 0;
        let monthlyCount = 0;
        let singleCount = 0;
        const monthlyUsage = {};
        const singleUsage = {};
        
        Object.values(userSubscriptions).forEach(sub => {
            if (sub.type === 'monthly') {
                monthlyRevenue += 4400;
                monthlyCount++;
                
                // Статистика использования месячных абонементов
                const used = 8 - sub.lessons;
                if (!monthlyUsage[used]) monthlyUsage[used] = 0;
                monthlyUsage[used]++;
            } else {
                singleRevenue += 700;
                singleCount++;
                
                // Статистика использования разовых абонементов
                const used = sub.lessons === 0 ? 1 : 0;
                if (!singleUsage[used]) singleUsage[used] = 0;
                singleUsage[used]++;
            }
        });
        
        const totalRevenue = monthlyRevenue + singleRevenue;
        const totalCount = monthlyCount + singleCount;
        
        let response = `*💰 ФИНАНСОВАЯ СТАТИСТИКА*\n\n`;
        
        response += `*📊 ОБЩАЯ ИНФОРМАЦИЯ:*\n`;
        response += `Общая выручка: *${totalRevenue} руб.*\n`;
        response += `Всего продаж: *${totalCount}*\n`;
        response += `Средний чек: *${totalCount > 0 ? Math.round(totalRevenue / totalCount) : 0} руб.*\n\n`;
        
        response += `*📅 МЕСЯЧНЫЕ АБОНЕМЕНТЫ:*\n`;
        response += `Количество: *${monthlyCount}*\n`;
        response += `Выручка: *${monthlyRevenue} руб.*\n`;
        response += `Доля от общей: *${totalRevenue > 0 ? Math.round((monthlyRevenue / totalRevenue) * 100) : 0}%*\n`;
        response += `Средняя цена: *${monthlyCount > 0 ? Math.round(monthlyRevenue / monthlyCount) : 0} руб.*\n\n`;
        
        response += `*🎫 РАЗОВЫЕ АБОНЕМЕНТЫ:*\n`;
        response += `Количество: *${singleCount}*\n`;
        response += `Выручка: *${singleRevenue} руб.*\n`;
        response += `Доля от общей: *${totalRevenue > 0 ? Math.round((singleRevenue / totalRevenue) * 100) : 0}%*\n\n`;
        
        // Статистика использования
        response += `*📈 ИСПОЛЬЗОВАНИЕ МЕСЯЧНЫХ:*\n`;
        Object.entries(monthlyUsage).sort((a, b) => parseInt(a[0]) - parseInt(b[0])).forEach(([used, count]) => {
            const percentage = Math.round((count / monthlyCount) * 100) || 0;
            const bar = '█'.repeat(Math.round(percentage / 10)) + '░'.repeat(10 - Math.round(percentage / 10));
            response += `${used} занятий: ${bar} ${percentage}% (${count})\n`;
        });
        
        response += `\n*🎯 КОНВЕРСИЯ:*\n`;
        const totalUsers = Object.keys(userStats).length;
        const conversionRate = totalCount > 0 ? Math.round((totalCount / totalUsers) * 100) : 0;
        response += `Пользователей: ${totalUsers}\n`;
        response += `Купивших абонемент: ${totalCount}\n`;
        response += `Конверсия: ${conversionRate}%\n`;
        
        if (conversionRate < 30) {
            response += `⚠️ *Низкая конверсия*\n`;
        } else if (conversionRate < 60) {
            response += `👍 *Средняя конверсия*\n`;
        } else {
            response += `🔥 *Высокая конверсия*\n`;
        }
        
        response += `\n*💡 РЕКОМЕНДАЦИИ:*\n`;
        if (monthlyRevenue < singleRevenue) {
            response += `🎯 Активнее продвигать месячные абонементы\n`;
        }
        if (singleCount > monthlyCount * 2) {
            response += `🎯 Предлагать апгрейд на месячные\n`;
        }
        
        await ctx.reply(response, {
            format: 'markdown',
            attachments: [keyboard]
        });
        
    } catch (error) {
        logToFile(`❌ Ошибка admin_stats_finance: ${error.message}`);
    }
});

// 2. УПРАВЛЕНИЕ ПОЛЬЗОВАТЕЛЯМИ
bot.action('admin_users', async (ctx) => {
    try {
        const userId = getUserId(ctx);
        if (!isAdmin(userId)) return;
        
        await ctx.deleteMessage();
        
        const keyboard = Keyboard.inlineKeyboard([
            [
                Keyboard.button.callback('✅ Активные', 'admin_users_active'),
                Keyboard.button.callback('🎯 С абонементами', 'admin_users_subs')
            ],
            [
                Keyboard.button.callback('« Назад в админ', 'admin_back')
            ]
        ]);
        
        const totalUsers = Object.keys(userStats).length;
        
        // Активные пользователи (за последние 30 дней)
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const activeUsers = Object.values(userStats).filter(u => 
            new Date(u.lastActivity) > thirtyDaysAgo
        ).length;
        
        // Пользователи с абонементами
        const usersWithSubs = Object.keys(userSubscriptions).length;
        
        let response = `**👥 УПРАВЛЕНИЕ ПОЛЬЗОВАТЕЛЯМИ**\n\n`;
        
        response += `**📊 СТАТИСТИКА:**\n`;
        response += `Всего пользователей: **${totalUsers}**\n`;
        response += `Активных (30 дней): **${activeUsers}**\n`;
        response += `С абонементами: **${usersWithSubs}**\n`;
        response += `Без абонементов: **${totalUsers - usersWithSubs}**\n\n`;
        
        // Топ 3 самых активных пользователей
        const topActive = Object.entries(userStats)
            .sort((a, b) => (b[1].attended || 0) - (a[1].attended || 0))
            .slice(0, 3);
        
        if (topActive.length > 0) {
            response += `**🏆 ТОП-3 ПО АКТИВНОСТИ:**\n`;
            topActive.forEach(([id, user], index) => {
                const sub = userSubscriptions[id];
                response += `${index + 1}. **${user.name}**\n`;
                response += `└─ Посещений: ${user.attended || 0}\n`;
                response += `└─ Абонемент: ${sub ? '✅' : '❌'}\n`;
                response += `└─ Последняя активность: ${new Date(user.lastActivity).toLocaleDateString('ru-RU')}\n`;
            });
            response += `\n`;
        }
        
        response += `**Выберите раздел:**`;
        
        await ctx.reply(response, {
            format: 'markdown',
            attachments: [keyboard]
        });
        
    } catch (error) {
        logToFile(`❌ Ошибка admin_users: ${error.message}`);
    }
});
// 2.1 Активные пользователи
bot.action('admin_users_active', async (ctx) => {
    try {
        const userId = getUserId(ctx);
        if (!isAdmin(userId)) return;
        
        await ctx.deleteMessage();
        
        const keyboard = Keyboard.inlineKeyboard([
            [
                Keyboard.button.callback('« Назад к пользователям', 'admin_users')
            ]
        ]);
        
        // Активные пользователи (за последние 30 дней)
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        
        const activeUsers = Object.entries(userStats)
            .filter(([id, user]) => new Date(user.lastActivity) > thirtyDaysAgo)
            .sort((a, b) => new Date(b[1].lastActivity) - new Date(a[1].lastActivity));
        
        let response = `**✅ АКТИВНЫЕ ПОЛЬЗОВАТЕЛЬ (30 ДНЕЙ)**\n\n`;
        
        if (activeUsers.length === 0) {
            response += `Нет активных пользователей за последние 30 дней\n`;
        } else {
            response += `Всего активных: **${activeUsers.length}**\n\n`;
            
            // Показываем только 10 первых
            activeUsers.slice(0, 10).forEach(([id, user], index) => {
                const daysAgo = Math.floor((new Date() - new Date(user.lastActivity)) / (1000 * 60 * 60 * 24));
                const sub = userSubscriptions[id];
                
                response += `${index + 1}. **${user.name || 'Без имени'}**\n`;
                response += `   🆔 ID: ${id}\n`;
                response += `   🕐 Последняя активность: ${daysAgo} дней назад\n`;
                response += `   🎯 Посещений: ${user.attended || 0}\n`;
                response += `   💳 Абонемент: ${sub ? '✅ ' + (sub.type === 'monthly' ? '📅' : '🎫') : '❌'}\n\n`;
            });
            
            if (activeUsers.length > 10) {
                response += `\n📌 Показано 10 из ${activeUsers.length} активных пользователей`;
            }
        }
        
        response += `\n**💡 СТАТИСТИКА АКТИВНОСТИ:**\n`;
        response += `Общее количество пользователей: ${Object.keys(userStats).length}\n`;
        response += `Процент активных: ${Math.round((activeUsers.length / Object.keys(userStats).length) * 100)}%\n`;
        response += `Среднее посещений: ${activeUsers.length > 0 ? 
            Math.round(activeUsers.reduce((sum, [_, user]) => sum + (user.attended || 0), 0) / activeUsers.length) : 0}\n`;
        
        await ctx.reply(response, {
            format: 'markdown',
            attachments: [keyboard]
        });
        
    } catch (error) {
        logToFile(`❌ Ошибка admin_users_active: ${error.message}`);
    }
});

// 2.2 Пользователи с абонементами
bot.action('admin_users_subs', async (ctx) => {
    try {
        const userId = getUserId(ctx);
        if (!isAdmin(userId)) return;
        
        await ctx.deleteMessage();
        
        const keyboard = Keyboard.inlineKeyboard([
            [
                Keyboard.button.callback('« Назад к пользователям', 'admin_users')
            ]
        ]);
        
        // Пользователи с активными абонементами
        const usersWithSubs = Object.entries(userSubscriptions)
            .filter(([id, sub]) => {
                // Проверяем, что абонемент активен (есть занятия и не истек)
                if (sub.lessons <= 0) return false;
                
                if (sub.type === 'monthly') {
                    const endDate = new Date(sub.startDate);
                    endDate.setDate(endDate.getDate() + 30);
                    return new Date() <= endDate;
                }
                
                return true; // Для разовых всегда активен, пока есть занятия
            })
            .map(([id, sub]) => {
                const user = userStats[id];
                return {
                    id,
                    name: user ? user.name : 'Неизвестно',
                    subscription: sub,
                    lastActivity: user ? user.lastActivity : null
                };
            })
            .sort((a, b) => {
                // Сначала сортируем по количеству оставшихся занятий
                return b.subscription.lessons - a.subscription.lessons;
            });
        
        let response = `**💳 ПОЛЬЗОВАТЕЛИ С АКТИВНЫМИ АБОНЕМЕНТАМИ**\n\n`;
        
        if (usersWithSubs.length === 0) {
            response += `Нет пользователей с активными абонементами\n`;
        } else {
            response += `Всего с активными абонементами: **${usersWithSubs.length}**\n\n`;
            
            usersWithSubs.slice(0, 10).forEach((user, index) => {
                const sub = user.subscription;
                const endDate = new Date(sub.startDate);
                endDate.setDate(endDate.getDate() + 30);
                const daysLeft = Math.ceil((endDate - new Date()) / (1000 * 60 * 60 * 24));
                
                response += `${index + 1}. **${user.name}**\n`;
                response += `   🆔 ID: ${user.id}\n`;
                response += `   🎫 Тип: ${sub.type === 'monthly' ? '📅 Месячный' : '🎫 Разовое посещение'}\n`;
                response += `   📊 Осталось занятий: ${sub.lessons}\n`;
                
                if (sub.type === 'monthly') {
                    response += `   📅 Действует до: ${endDate.toLocaleDateString('ru-RU')}\n`;
                    response += `   ⌛ Осталось дней: ${daysLeft}\n`;
                }
                
                if (user.lastActivity) {
                    const daysAgo = Math.floor((new Date() - new Date(user.lastActivity)) / (1000 * 60 * 60 * 24));
                    response += `   🕐 Активность: ${daysAgo} дней назад\n`;
                }
                
                response += `\n`;
            });
            
            if (usersWithSubs.length > 10) {
                response += `\n📌 Показано 10 из ${usersWithSubs.length} пользователей`;
            }
        }
        
        // Статистика по абонементам
        const monthlyActive = usersWithSubs.filter(u => u.subscription.type === 'monthly').length;
        const singleActive = usersWithSubs.filter(u => u.subscription.type === 'single').length;
        const totalLessons = usersWithSubs.reduce((sum, user) => sum + user.subscription.lessons, 0);
        
        response += `\n**📊 СТАТИСТИКА:**\n`;
        response += `Месячных абонементов: ${monthlyActive}\n`;
        response += `Разовых абонементов: ${singleActive}\n`;
        response += `Всего занятий доступно: ${totalLessons}\n`;
        response += `Среднее занятий на пользователя: ${Math.round(totalLessons / usersWithSubs.length)}\n`;
        
        await ctx.reply(response, {
            format: 'markdown',
            attachments: [keyboard]
        });
        
    } catch (error) {
        logToFile(`❌ Ошибка admin_users_subs: ${error.message}`);
    }
});

// 3. УПРАВЛЕНИЕ АБОНЕМЕНТАМИ
bot.action('admin_subs', async (ctx) => {
    try {
        const userId = getUserId(ctx);
        if (!isAdmin(userId)) return;
        
        await ctx.deleteMessage();
        
        const keyboard = Keyboard.inlineKeyboard([
            [
                Keyboard.button.callback('✅ Активные', 'admin_subs_active'),
                Keyboard.button.callback('⏰ Истекшие', 'admin_subs_expired')
            ],
            [
                Keyboard.button.callback('📅 Месячные', 'admin_subs_monthly'),
                Keyboard.button.callback('🎫 Разовые', 'admin_subs_single')
            ],
            [
Keyboard.button.callback('📝 Добавить абонемент', 'admin_add_subscription'),
                Keyboard.button.callback('📊 Статистика', 'admin_subs_stats')
            ],
            [
                Keyboard.button.callback('« Назад в админ', 'admin_back')
            ]
        ]);
        
        const totalSubs = Object.keys(userSubscriptions).length;
        
        let activeSubs = 0;
        let expiredSubs = 0;
        let monthlySubs = 0;
        let singleSubs = 0;
        
        Object.values(userSubscriptions).forEach(sub => {
            const endDate = new Date(sub.startDate);
            endDate.setDate(endDate.getDate() + 30);
            
            if (new Date() > endDate) {
                expiredSubs++;
            } else if (sub.lessons > 0) {
                activeSubs++;
            }
            
            if (sub.type === 'monthly') {
                monthlySubs++;
            } else {
                singleSubs++;
            }
        });
        
        // Ближайшие к истечению (менее 7 дней)
        const expiringSoon = Object.values(userSubscriptions)
            .filter(sub => {
                const endDate = new Date(sub.startDate);
                endDate.setDate(endDate.getDate() + 30);
                const daysLeft = Math.ceil((endDate - new Date()) / (1000 * 60 * 60 * 24));
                return daysLeft > 0 && daysLeft <= 7 && sub.lessons > 0;
            }).length;
        
        let response = `**📋 УПРАВЛЕНИЕ АБОНЕМЕНТАМИ**\n\n`;
        response += `**📊 СТАТИСТИКА:**\n`;
        response += `Всего абонементов: **${totalSubs}**\n`;
        response += `Активных: **${activeSubs}**\n`;
        response += `Истекших: **${expiredSubs}**\n`;
        response += `Месячных: **${monthlySubs}**\n`;
        response += `Разовых: **${singleSubs}**\n\n`;
        
        if (expiringSoon > 0) {
            response += `**⚠️ БЛИЖАЙШИЕ К ИСТЕЧЕНИЮ:**\n`;
            response += `Срок истекает ≤7 дней: **${expiringSoon}** абонементов\n\n`;
        }
        
        // Абонементы с малым количеством занятий
        const lowLessons = Object.values(userSubscriptions)
            .filter(sub => sub.lessons > 0 && sub.lessons <= 2 && sub.type === 'monthly')
            .length;
        
        if (lowLessons > 0) {
            response += `**🎯 МАЛО ЗАНЯТИЙ ОСТАЛОСЬ:**\n`;
            response += `≤2 занятий осталось: **${lowLessons}** абонементов\n\n`;
        }
        
        response += `**Выберите раздел:**`;
        
        await ctx.reply(response, {
            format: 'markdown',
            attachments: [keyboard]
        });
        
    } catch (error) {
        logToFile(`❌ Ошибка admin_subs: ${error.message}`);
    }
});
// 3.1 Активные абонементы
bot.action('admin_subs_active', async (ctx) => {
    try {
        const userId = getUserId(ctx);
        if (!isAdmin(userId)) return;
        
        await ctx.deleteMessage();
        
        const keyboard = Keyboard.inlineKeyboard([
            [
                Keyboard.button.callback('« Назад к абонементам', 'admin_subs')
            ]
        ]);
        
        // Активные абонементы (не истекли и есть занятия)
        const activeSubscriptions = Object.entries(userSubscriptions)
            .filter(([id, sub]) => {
                if (sub.lessons <= 0) return false;
                
                const endDate = new Date(sub.startDate);
                endDate.setDate(endDate.getDate() + 30);
                return new Date() <= endDate;
            })
            .map(([id, sub]) => {
                const user = userStats[id];
                return {
                    id,
                    userName: user ? user.name : 'Неизвестно',
                    subscription: sub
                };
            })
            .sort((a, b) => {
                // Сортируем по дате окончания
                const endDateA = new Date(a.subscription.startDate);
                endDateA.setDate(endDateA.getDate() + 30);
                const endDateB = new Date(b.subscription.startDate);
                endDateB.setDate(endDateB.getDate() + 30);
                return endDateA - endDateB;
            });
        
        let response = `**✅ АКТИВНЫЕ АБОНЕМЕНТЫ**\n\n`;
        
        if (activeSubscriptions.length === 0) {
            response += `Нет активных абонементов\n`;
        } else {
            response += `Всего активных: **${activeSubscriptions.length}**\n\n`;
            
            activeSubscriptions.slice(0, 10).forEach((item, index) => {
                const sub = item.subscription;
                const endDate = new Date(sub.startDate);
                endDate.setDate(endDate.getDate() + 30);
                const daysLeft = Math.ceil((endDate - new Date()) / (1000 * 60 * 60 * 24));
                
                response += `${index + 1}. **${item.userName}**\n`;
                response += `   🆔 ID: ${item.id}\n`;
                response += `   🎫 Тип: ${sub.type === 'monthly' ? '📅 Месячный' : '🎫 Разовое посещение'}\n`;
                response += `   📊 Осталось занятий: ${sub.lessons}\n`;
                response += `   📅 Действует до: ${endDate.toLocaleDateString('ru-RU')}\n`;
                response += `   ⌛ Осталось дней: ${daysLeft}\n\n`;
            });
            
            if (activeSubscriptions.length > 10) {
                response += `\n📌 Показано 10 из ${activeSubscriptions.length} абонементов`;
            }
        }
        
        // Статистика
        const monthlyCount = activeSubscriptions.filter(item => item.subscription.type === 'monthly').length;
        const singleCount = activeSubscriptions.filter(item => item.subscription.type === 'single').length;
        const totalLessons = activeSubscriptions.reduce((sum, item) => sum + item.subscription.lessons, 0);
        
        response += `\n**📊 СТАТИСТИКА:**\n`;
        response += `Месячных: ${monthlyCount}\n`;
        response += `Разовых: ${singleCount}\n`;
        response += `Всего занятий доступно: ${totalLessons}\n`;
        response += `Среднее занятий на абонемент: ${Math.round(totalLessons / activeSubscriptions.length)}\n`;
        
        await ctx.reply(response, {
            format: 'markdown',
            attachments: [keyboard]
        });
        
    } catch (error) {
        logToFile(`❌ Ошибка admin_subs_active: ${error.message}`);
    }
});

// 3.2 Истекшие абонементы
bot.action('admin_subs_expired', async (ctx) => {
    try {
        const userId = getUserId(ctx);
        if (!isAdmin(userId)) return;
        
        await ctx.deleteMessage();
        
        const keyboard = Keyboard.inlineKeyboard([
            [
                Keyboard.button.callback('« Назад к абонементам', 'admin_subs')
            ]
        ]);
        
        // Истекшие абонементы (дата окончания прошла)
        const expiredSubscriptions = Object.entries(userSubscriptions)
            .filter(([id, sub]) => {
                const endDate = new Date(sub.startDate);
                endDate.setDate(endDate.getDate() + 30);
                return new Date() > endDate;
            })
            .map(([id, sub]) => {
                const user = userStats[id];
                return {
                    id,
                    userName: user ? user.name : 'Неизвестно',
                    subscription: sub
                };
            })
            .sort((a, b) => {
                // Сортируем по дате окончания (сначала старые)
                const endDateA = new Date(a.subscription.startDate);
                endDateA.setDate(endDateA.getDate() + 30);
                const endDateB = new Date(b.subscription.startDate);
                endDateB.setDate(endDateB.getDate() + 30);
                return endDateA - endDateB;
            });
        
        let response = `**⏰ ИСТЕКШИЕ АБОНЕМЕНТЫ**\n\n`;
        
        if (expiredSubscriptions.length === 0) {
            response += `Нет истекших абонементов\n`;
        } else {
            response += `Всего истекших: **${expiredSubscriptions.length}**\n\n`;
            
            expiredSubscriptions.slice(0, 10).forEach((item, index) => {
                const sub = item.subscription;
                const endDate = new Date(sub.startDate);
                endDate.setDate(endDate.getDate() + 30);
                const daysAgo = Math.floor((new Date() - endDate) / (1000 * 60 * 60 * 24));
                
                response += `${index + 1}. **${item.userName}**\n`;
                response += `   🆔 ID: ${item.id}\n`;
                response += `   🎫 Тип: ${sub.type === 'monthly' ? '📅 Месячный' : '🎫 Разовое посещение'}\n`;
                response += `   📊 Осталось занятий: ${sub.lessons}\n`;
                response += `   📅 Истек: ${endDate.toLocaleDateString('ru-RU')}\n`;
                response += `   ⌛ Дней назад: ${daysAgo}\n\n`;
            });
            
            if (expiredSubscriptions.length > 10) {
                response += `\n📌 Показано 10 из ${expiredSubscriptions.length} абонементов`;
            }
        }
        
        // Статистика по потерянным занятиям
        const lostLessons = expiredSubscriptions.reduce((sum, item) => {
            return sum + item.subscription.lessons;
        }, 0);
        
        response += `\n**📊 СТАТИСТИКА:**\n`;
        response += `Всего потеряно занятий: ${lostLessons}\n`;
        response += `Месячных: ${expiredSubscriptions.filter(item => item.subscription.type === 'monthly').length}\n`;
        response += `Разовых: ${expiredSubscriptions.filter(item => item.subscription.type === 'single').length}\n`;
        
        if (lostLessons > 0) {
            response += `\n**⚠️ ВНИМАНИЕ:**\n`;
            response += `Пользователи потеряли ${lostLessons} занятий!\n`;
            response += `Рекомендуется связаться с этими пользователями.\n`;
        }
        
        await ctx.reply(response, {
            format: 'markdown',
            attachments: [keyboard]
        });
        
    } catch (error) {
        logToFile(`❌ Ошибка admin_subs_expired: ${error.message}`);
    }
});

// 3.3 Месячные абонементы
bot.action('admin_subs_monthly', async (ctx) => {
    try {
        const userId = getUserId(ctx);
        if (!isAdmin(userId)) return;
        
        await ctx.deleteMessage();
        
        const keyboard = Keyboard.inlineKeyboard([
            [
                Keyboard.button.callback('« Назад к абонементам', 'admin_subs')
            ]
        ]);
        
        // Только месячные абонементы
        const monthlySubscriptions = Object.entries(userSubscriptions)
            .filter(([id, sub]) => sub.type === 'monthly')
            .map(([id, sub]) => {
                const user = userStats[id];
                return {
                    id,
                    userName: user ? user.name : 'Неизвестно',
                    subscription: sub
                };
            })
            .sort((a, b) => {
                // Сортируем по дате начала (сначала новые)
                return new Date(b.subscription.startDate) - new Date(a.subscription.startDate);
            });
        
        let response = `**📅 МЕСЯЧНЫЕ АБОНЕМЕНТЫ**\n\n`;
        
        if (monthlySubscriptions.length === 0) {
            response += `Нет месячных абонементов\n`;
        } else {
            response += `Всего месячных: **${monthlySubscriptions.length}**\n\n`;
            
            monthlySubscriptions.slice(0, 10).forEach((item, index) => {
                const sub = item.subscription;
                const endDate = new Date(sub.startDate);
                endDate.setDate(endDate.getDate() + 30);
                const daysLeft = Math.ceil((endDate - new Date()) / (1000 * 60 * 60 * 24));
                const isActive = new Date() <= endDate && sub.lessons > 0;
                
                response += `${index + 1}. **${item.userName}**\n`;
                response += `   🆔 ID: ${item.id}\n`;
                response += `   📊 Осталось занятий: ${sub.lessons}\n`;
                response += `   💰 Стоимость: ${sub.cost || 4400} руб.\n`;
                response += `   📅 Начало: ${new Date(sub.startDate).toLocaleDateString('ru-RU')}\n`;
                response += `   📅 Действует до: ${endDate.toLocaleDateString('ru-RU')}\n`;
                response += `   ⌛ Осталось дней: ${daysLeft}\n`;
                response += `   📊 Статус: ${isActive ? '✅ Активен' : '❌ Не активен'}\n\n`;
            });
            
            if (monthlySubscriptions.length > 10) {
                response += `\n📌 Показано 10 из ${monthlySubscriptions.length} абонементов`;
            }
        }
        
        // Статистика
        const activeMonthly = monthlySubscriptions.filter(item => {
            const endDate = new Date(item.subscription.startDate);
            endDate.setDate(endDate.getDate() + 30);
            return new Date() <= endDate && item.subscription.lessons > 0;
        }).length;
        
        const expiredMonthly = monthlySubscriptions.filter(item => {
            const endDate = new Date(item.subscription.startDate);
            endDate.setDate(endDate.getDate() + 30);
            return new Date() > endDate;
        }).length;
        
        const totalLessons = monthlySubscriptions.reduce((sum, item) => sum + item.subscription.lessons, 0);
        const usedLessons = monthlySubscriptions.reduce((sum, item) => sum + (8 - item.subscription.lessons), 0);
        const revenue = monthlySubscriptions.length * 4400;
        
        response += `\n**📊 СТАТИСТИКА МЕСЯЧНЫХ:**\n`;
        response += `Всего продано: ${monthlySubscriptions.length}\n`;
        response += `Активных: ${activeMonthly}\n`;
        response += `Истекших: ${expiredMonthly}\n`;
        response += `Использовано занятий: ${usedLessons}\n`;
        response += `Доступно занятий: ${totalLessons}\n`;
        response += `Выручка: ${revenue} руб.\n`;
        response += `Средняя загрузка: ${Math.round((usedLessons / (monthlySubscriptions.length * 8)) * 100)}%\n`;
        
        await ctx.reply(response, {
            format: 'markdown',
            attachments: [keyboard]
        });
        
    } catch (error) {
        logToFile(`❌ Ошибка admin_subs_monthly: ${error.message}`);
    }
});

// 3.4 Разовые абонементы
bot.action('admin_subs_single', async (ctx) => {
    try {
        const userId = getUserId(ctx);
        if (!isAdmin(userId)) return;
        
        await ctx.deleteMessage();
        
        const keyboard = Keyboard.inlineKeyboard([
            [
                Keyboard.button.callback('« Назад к абонементам', 'admin_subs')
            ]
        ]);
        
        // Только разовые абонементы
        const singleSubscriptions = Object.entries(userSubscriptions)
            .filter(([id, sub]) => sub.type === 'single')
            .map(([id, sub]) => {
                const user = userStats[id];
                return {
                    id,
                    userName: user ? user.name : 'Неизвестно',
                    subscription: sub
                };
            })
            .sort((a, b) => {
                // Сортируем по дате начала (сначала новые)
                return new Date(b.subscription.startDate) - new Date(a.subscription.startDate);
            });
        
        let response = `**🎫 РАЗОВЫЕ АБОНЕМЕНТЫ**\n\n`;
        
        if (singleSubscriptions.length === 0) {
            response += `Нет разовых абонементов\n`;
        } else {
            response += `Всего разовых: **${singleSubscriptions.length}**\n\n`;
            
            singleSubscriptions.slice(0, 10).forEach((item, index) => {
                const sub = item.subscription;
                const purchaseDate = new Date(sub.startDate);
                const isUsed = sub.lessons === 0;
                
                response += `${index + 1}. **${item.userName}**\n`;
                response += `   🆔 ID: ${item.id}\n`;
                response += `   📊 Осталось занятий: ${sub.lessons}\n`;
                response += `   💰 Стоимость: ${sub.cost || 700} руб.\n`;
                response += `   📅 Покупка: ${purchaseDate.toLocaleDateString('ru-RU')}\n`;
                response += `   📊 Статус: ${isUsed ? '✅ Использован' : '🎯 Не использован'}\n`;
                
                if (sub.lastUsed) {
                    response += `   🔄 Использован: ${new Date(sub.lastUsed).toLocaleDateString('ru-RU')}\n`;
                }
                
                response += `\n`;
            });
            
            if (singleSubscriptions.length > 10) {
                response += `\n📌 Показано 10 из ${singleSubscriptions.length} абонементов`;
            }
        }
        
        // Статистика
        const usedSingles = singleSubscriptions.filter(item => item.subscription.lessons === 0).length;
        const unusedSingles = singleSubscriptions.filter(item => item.subscription.lessons > 0).length;
        const revenue = singleSubscriptions.length * 700;
        
        response += `\n**📊 СТАТИСТИКА РАЗОВЫХ:**\n`;
        response += `Всего продано: ${singleSubscriptions.length}\n`;
        response += `Использовано: ${usedSingles}\n`;
        response += `Не использовано: ${unusedSingles}\n`;
        response += `Конверсия в использование: ${Math.round((usedSingles / singleSubscriptions.length) * 100)}%\n`;
        response += `Выручка: ${revenue} руб.\n`;
        
        if (unusedSingles > 0) {
            response += `\n**⚠️ ВНИМАНИЕ:**\n`;
            response += `Есть ${unusedSingles} неиспользованных разовых абонементов!\n`;
            response += `Рекомендуется напомнить пользователям.\n`;
        }
        
        await ctx.reply(response, {
            format: 'markdown',
            attachments: [keyboard]
        });
        
    } catch (error) {
        logToFile(`❌ Ошибка admin_subs_single: ${error.message}`);
    }
});

// 3.5 Статистика абонементов
bot.action('admin_subs_stats', async (ctx) => {
    try {
        const userId = getUserId(ctx);
        if (!isAdmin(userId)) return;
        
        await ctx.deleteMessage();
        
        const keyboard = Keyboard.inlineKeyboard([
            [
                Keyboard.button.callback('« Назад к абонементам', 'admin_subs')
            ]
        ]);
        
        // Анализ всех абонементов
        let totalSubs = 0;
        let monthlySubs = 0;
        let singleSubs = 0;
        let activeSubs = 0;
        let expiredSubs = 0;
        let totalLessons = 0;
        let usedLessons = 0;
        let totalRevenue = 0;
        let monthlyRevenue = 0;
        let singleRevenue = 0;
        
        Object.values(userSubscriptions).forEach(sub => {
            totalSubs++;
            
            if (sub.type === 'monthly') {
                monthlySubs++;
                monthlyRevenue += 4400;
                totalLessons += sub.lessons;
                usedLessons += (8 - sub.lessons);
            } else {
                singleSubs++;
                singleRevenue += 700;
                totalLessons += sub.lessons;
                usedLessons += (1 - sub.lessons);
            }
            
            const endDate = new Date(sub.startDate);
            endDate.setDate(endDate.getDate() + 30);
            
            if (new Date() > endDate) {
                expiredSubs++;
            } else if (sub.lessons > 0) {
                activeSubs++;
            }
        });
        
        totalRevenue = monthlyRevenue + singleRevenue;
        
        // Расчет средней загрузки
        const totalPossibleLessons = (monthlySubs * 8) + singleSubs;
        const loadPercentage = totalPossibleLessons > 0 ? Math.round((usedLessons / totalPossibleLessons) * 100) : 0;
        
        let response = `**📊 СТАТИСТИКА АБОНЕМЕНТОВ**\n\n`;
        
        response += `**📈 ОБЩАЯ СТАТИСТИКА:**\n`;
        response += `Всего абонементов: **${totalSubs}**\n`;
        response += `Активных: **${activeSubs}**\n`;
        response += `Истекших: **${expiredSubs}**\n`;
        response += `Месячных: **${monthlySubs}**\n`;
        response += `Разовых: **${singleSubs}**\n\n`;
        
        response += `**🎯 ИСПОЛЬЗОВАНИЕ:**\n`;
        response += `Всего занятий доступно: **${totalLessons}**\n`;
        response += `Использовано занятий: **${usedLessons}**\n`;
        response += `Всего возможных занятий: **${totalPossibleLessons}**\n`;
        response += `Загрузка системы: **${loadPercentage}%**\n\n`;
        
        response += `**💰 ФИНАНСЫ:**\n`;
        response += `Общая выручка: **${totalRevenue} руб.**\n`;
        response += `Месячные: **${monthlyRevenue} руб.**\n`;
        response += `Разовые: **${singleRevenue} руб.**\n`;
        response += `Средний чек: **${totalSubs > 0 ? Math.round(totalRevenue / totalSubs) : 0} руб.**\n\n`;
        
        // Анализ эффективности
        const monthlyCostPerLesson = monthlySubs > 0 ? Math.round(monthlyRevenue / (monthlySubs * 8)) : 0;
        const singleCostPerLesson = 700;
        const economyPerLesson = singleCostPerLesson - monthlyCostPerLesson;
        const totalEconomy = economyPerLesson * usedLessons;
        
        response += `**💡 АНАЛИЗ ЭФФЕКТИВНОСТИ:**\n`;
        response += `Цена за занятие (месячный): **${monthlyCostPerLesson} руб.**\n`;
        response += `Цена за занятие (Разовое посещение): **${singleCostPerLesson} руб.**\n`;
        response += `Экономия за занятие: **${economyPerLesson} руб.**\n`;
        response += `Общая экономия пользователей: **${totalEconomy} руб.**\n\n`;
        
        // Рекомендации
        response += `**🎯 РЕКОМЕНДАЦИИ:**\n`;
        
        if (monthlySubs < singleSubs) {
            response += `1. 📈 **Увеличить продажи месячных абонементов**\n`;
            response += `   └─ Сейчас: ${monthlySubs} месячных vs ${singleSubs} разовых\n`;
            response += `   └─ Цель: Увеличить долю месячных до 60%\n\n`;
        }
        
        if (loadPercentage < 50) {
            response += `2. 🎯 **Повысить использование абонементов**\n`;
            response += `   └─ Текущая загрузка: ${loadPercentage}%\n`;
            response += `   └─ Цель: Довести до 70-80%\n\n`;
        }
        
        if (expiredSubs > 0) {
            response += `3. ⏰ **Работать с истекшими абонементами**\n`;
            response += `   └─ ${expiredSubs} абонементов истекли\n`;
            response += `   └─ Предложить продление или новые условия\n`;
        }
        
        await ctx.reply(response, {
            format: 'markdown',
            attachments: [keyboard]
        });
        
    } catch (error) {
        logToFile(`❌ Ошибка admin_subs_stats: ${error.message}`);
    }
});

// 6. УДАЛЕНИЕ (обновленная версия с кнопкой очистки статистики)
bot.action('admin_delete', async (ctx) => {
    try {
        const userId = getUserId(ctx);
        if (!isAdmin(userId)) return;
        
        await ctx.deleteMessage();
        
        const keyboard = Keyboard.inlineKeyboard([
            [
                Keyboard.button.callback('🗑️ Удалить пользователя', 'admin_delete_user_select'),
                Keyboard.button.callback('🎫 Удалить абонемент', 'admin_delete_sub_select')
            ],
            [
                Keyboard.button.callback('📊 Очистить статистику', 'admin_clear_stats'),
                Keyboard.button.callback('🗑️ Очистить историю', 'admin_clear_history')
            ],
            [
                Keyboard.button.callback('« Назад в админ', 'admin_back')
            ]
        ]);
        
        // Подсчет текущих данных для информации
        const totalUsers = Object.keys(userStats).length;
        let totalHistoryEntries = 0;
        let totalAttended = 0;
        
        Object.values(userStats).forEach(user => {
            if (user.history) {
                totalHistoryEntries += user.history.length;
            }
            totalAttended += user.attended || 0;
        });
        
        let response = `**🗑️ УДАЛЕНИЕ И ОЧИСТКА ДАННЫХ**\n\n`;
        
        response += `**📊 ТЕКУЩАЯ СТАТИСТИКА СИСТЕМЫ:**\n`;
        response += `👥 Пользователей: **${totalUsers}**\n`;
        response += `📝 Записей истории: **${totalHistoryEntries}**\n`;
        response += `✅ Посещений: **${totalAttended}**\n\n`;
        
        response += `**⚠️ ОПАСНЫЕ ОПЕРАЦИИ:**\n\n`;
        
        response += `**🗑️ УДАЛИТЬ ПОЛЬЗОВАТЕЛЯ:**\n`;
        response += `└─ Полное удаление всех данных пользователя\n`;
        response += `└─ **НЕОБРАТИМАЯ ОПЕРАЦИЯ!**\n\n`;
        
        response += `**🎫 УДАЛИТЬ АБОНЕМЕНТ:**\n`;
        response += `└─ Удаление активного абонемента\n`;
        response += `└─ Сохранение статистики пользователя\n`;
        response += `└─ Пользователь не сможет записываться\n\n`;
        
        response += `**📊 ОЧИСТИТЬ СТАТИСТИКУ:**\n`;
        response += `└─ Сброс счетчиков и истории\n`;
        response += `└─ Начало нового отчетного периода\n`;
        response += `└─ **ДАННЫЕ ПОТЕРЯНЫ НАВСЕГДА!**\n\n`;
        
        response += `**🗑️ ОЧИСТИТЬ ИСТОРИЮ:**\n`;
        response += `└─ Удаление истории посещений\n`;
        response += `└─ Очистка устаревших данных\n`;
        response += `└─ **ВОССТАНОВИТЬ НЕЛЬЗЯ!**\n\n`;
        
        response += `**💡 РЕКОМЕНДАЦИИ:**\n`;
        response += `1. Всегда делайте резервные копии\n`;
        response += `2. Дважды проверяйте перед удалением\n`;
        response += `3. Уведомляйте пользователей об изменениях\n`;
        response += `4. Ведите журнал операций\n\n`;
        
        response += `**Выберите действие:**`;
        
        await ctx.reply(response, {
            format: 'markdown',
            attachments: [keyboard]
        });
        
    } catch (error) {
        logToFile(`❌ Ошибка admin_delete: ${error.message}`);
    }
});

// 6.1 Выбор пользователя для удаления
bot.action('admin_delete_user_select', async (ctx) => {
    try {
        const userId = getUserId(ctx);
        if (!isAdmin(userId)) return;
        
        await ctx.deleteMessage();
        
        // Получаем список пользователей для удаления (топ 10 по последней активности)
        const usersToDelete = Object.entries(userStats)
            .sort((a, b) => new Date(b[1].lastActivity) - new Date(a[1].lastActivity))
            .slice(0, 10);
        
        if (usersToDelete.length === 0) {
            await ctx.reply('Нет пользователей для удаления', { format: 'markdown' });
            return;
        }
        
        const keyboardButtons = [];
        
        usersToDelete.forEach(([id, user], index) => {
            const userName = user.name || 'Без имени';
            const shortName = userName.length > 15 ? userName.substring(0, 15) + '...' : userName;
            const lastActivity = new Date(user.lastActivity).toLocaleDateString('ru-RU');
            
            keyboardButtons.push([
                Keyboard.button.callback(
                    `${index + 1}. ${shortName} (${lastActivity})`,
                    `admin_delete_user_${id}`
                )
            ]);
        });
        
        keyboardButtons.push([
            Keyboard.button.callback('« Назад к удалению', 'admin_delete')
        ]);
        
        const keyboard = Keyboard.inlineKeyboard(keyboardButtons);
        
        await ctx.reply(
            `**🗑️ ВЫБОР ПОЛЬЗОВАТЕЛЯ ДЛЯ УДАЛЕНИЯ**\n\n` +
            `**⚠️ ВНИМАНИЕ:**\n` +
            `При удалении пользователя будут удалены:\n` +
            `• Вся статистика\n` +
            `• Абонементы\n` +
            `• История посещений\n` +
            `• Все данные о пользователе\n\n` +
            
            `**📋 ВЫБЕРИТЕ ПОЛЬЗОВАТЕЛЯ:**\n` +
            `Показаны 10 пользователей по последней активности\n`,
            {
                format: 'markdown',
                attachments: [keyboard]
            }
        );
        
    } catch (error) {
        logToFile(`❌ Ошибка admin_delete_user_select: ${error.message}`);
    }
});

// 6.2 Подтверждение удаления пользователя
bot.action(/^admin_delete_user_(\d+)$/, async (ctx) => {
    try {
        const userId = getUserId(ctx);
        if (!isAdmin(userId)) return;
        
        const targetUserId = ctx.match[1];
        const user = userStats[targetUserId];
        
        if (!user) {
            await ctx.reply('❌ Пользователь не найден', { format: 'markdown' });
            return;
        }
        
        await ctx.deleteMessage();
        
        const keyboard = Keyboard.inlineKeyboard([
            [
                Keyboard.button.callback('✅ Да, удалить навсегда', `admin_delete_user_confirm_${targetUserId}`),
                Keyboard.button.callback('❌ Нет, отменить', 'admin_delete_user_select')
            ]
        ]);
        
        const sub = userSubscriptions[targetUserId];
        const lastActivity = new Date(user.lastActivity).toLocaleDateString('ru-RU');
        
        await ctx.reply(
            `**⚠️ ПОДТВЕРЖДЕНИЕ УДАЛЕНИЯ ПОЛЬЗОВАТЕЛЯ**\n\n` +
            `**📋 ИНФОРМАЦИЯ О ПОЛЬЗОВАТЕЛЕ:**\n` +
            `👤 Имя: **${user.name}**\n` +
            `🆔 ID: ${targetUserId}\n` +
            `📅 Первая активность: ${new Date(user.firstSeen).toLocaleDateString('ru-RU')}\n` +
            `🔄 Последняя активность: ${lastActivity}\n` +
            `🎯 Посещений тренировок: ${user.attended || 0}\n` +
            `💳 Абонемент: ${sub ? '✅ ' + (sub.type === 'monthly' ? '📅 Месячный' : '🎫 Разовое посещение') : '❌ Нет'}\n\n` +
            
            `**🗑️ ЧТО БУДЕТ УДАЛЕНО:**\n` +
            `1. Статистика пользователя\n` +
            `2. История посещений (${user.history ? user.history.length : 0} записей)\n` +
            `3. Абонементы (${sub ? '1 абонемент' : 'нет'})\n` +
            `4. Все данные из системы\n\n` +
            
            `**❌ ЭТУ ОПЕРАЦИЮ НЕЛЬЗЯ ОТМЕНИТЬ!**\n\n` +
            `Вы уверены, что хотите удалить пользователя **${user.name}**?`,
            {
                format: 'markdown',
                attachments: [keyboard]
            }
        );
        
    } catch (error) {
        logToFile(`❌ Ошибка admin_delete_user: ${error.message}`);
    }
});

// 6.3 Фактическое удаление пользователя
bot.action(/^admin_delete_user_confirm_(\d+)$/, async (ctx) => {
    try {
        const userId = getUserId(ctx);
        if (!isAdmin(userId)) return;
        
        const targetUserId = ctx.match[1];
        const user = userStats[targetUserId];
        
        if (!user) {
            await ctx.reply('❌ Пользователь уже удален', { format: 'markdown' });
            return;
        }
        
        await ctx.deleteMessage();
        
        const userName = user.name;
        const hasSub = userSubscriptions[targetUserId] ? true : false;
        const historyCount = user.history ? user.history.length : 0;
        
        // Удаляем данные пользователя
        delete userStats[targetUserId];
        delete userSubscriptions[targetUserId];
        
        // Сохраняем изменения
        saveUserStats();
        saveSubscriptions();
        
        // Логируем удаление
        logToFile(`🗑️ Админ ${userId} удалил пользователя ${userName} (${targetUserId})`);
        
        const keyboard = Keyboard.inlineKeyboard([
            [
                Keyboard.button.callback('« Назад к удалению', 'admin_delete')
            ]
        ]);
        
        await ctx.reply(
            `✅ **ПОЛЬЗОВАТЕЛЬ УСПЕШНО УДАЛЕН!**\n\n` +
            `**🗑️ УДАЛЕННЫЕ ДАННЫЕ:**\n` +
            `👤 Пользователь: **${userName}**\n` +
            `🆔 ID: ${targetUserId}\n` +
            `📊 Статистика: удалена\n` +
            `📅 История посещений: ${historyCount} записей удалено\n` +
            `💳 Абонемент: ${hasSub ? 'удален' : 'не было'}\n\n` +
            
            `**📝 ДАННЫЕ БЫЛИ БЕЗВОЗВРАТНО УДАЛЕНЫ ИЗ СИСТЕМЫ.**\n\n` +
            `Для восстановления потребуется создание нового пользователя.`,
            {
                format: 'markdown',
                attachments: [keyboard]
            }
        );
        
    } catch (error) {
        logToFile(`❌ Ошибка admin_delete_user_confirm: ${error.message}`);
    }
});
// ========== УДАЛЕНИЕ АБОНЕМЕНТА В АДМИН-ПАНЕЛИ ==========

// 6.3 Выбор пользователя для удаления абонемента
bot.action('admin_delete_sub_select', async (ctx) => {
    try {
        const userId = getUserId(ctx);
        if (!isAdmin(userId)) return;
        
        await ctx.deleteMessage();
        
        // Получаем пользователей с абонементами для удаления
        const usersWithSubs = Object.entries(userSubscriptions)
            .map(([id, sub]) => {
                const user = userStats[id];
                return {
                    id,
                    userName: user ? user.name : 'Неизвестно',
                    subscription: sub
                };
            })
            .sort((a, b) => {
                // Сортируем по имени пользователя
                return a.userName.localeCompare(b.userName);
            })
            .slice(0, 15); // Ограничиваем 15 пользователями
        
        if (usersWithSubs.length === 0) {
            await ctx.reply(
                `**📭 НЕТ ПОЛЬЗОВАТЕЛЕЙ С АБОНЕМЕНТАМИ**\n\n` +
                `В системе нет абонементов для удаления.`,
                { format: 'markdown' }
            );
            return;
        }
        
        const keyboardButtons = [];
        
        usersWithSubs.forEach((user, index) => {
            const subType = user.subscription.type === 'monthly' ? '📅' : '🎫';
            const lessons = user.subscription.lessons;
            const userName = user.userName.length > 15 ? user.userName.substring(0, 15) + '...' : user.userName;
            
            keyboardButtons.push([
                Keyboard.button.callback(
                    `${index + 1}. ${subType} ${userName} (${lessons} занятий)`,
                    `admin_delete_sub_user_${user.id}`
                )
            ]);
        });
        
        keyboardButtons.push([
            Keyboard.button.callback('🔍 Поиск по ID', 'admin_delete_sub_search')
        ]);
        
        keyboardButtons.push([
            Keyboard.button.callback('« Назад к удалению', 'admin_delete')
        ]);
        
        const keyboard = Keyboard.inlineKeyboard(keyboardButtons);
        
        await ctx.reply(
            `**🗑️ ВЫБОР ПОЛЬЗОВАТЕЛЯ ДЛЯ УДАЛЕНИЯ АБОНЕМЕНТА**\n\n` +
            `**⚠️ ВНИМАНИЕ:**\n` +
            `При удалении абонемента будут удалены:\n` +
            `• Текущий активный абонемент\n` +
            `• Оставшиеся занятия\n` +
            `• Информация о покупке\n\n` +
            
            `**📋 ЧТО СОХРАНИТСЯ:**\n` +
            `✅ Статистика пользователя\n` +
            `✅ История посещений\n` +
            `✅ История покупок (в статистике)\n\n` +
            
            `**📋 ВЫБЕРИТЕ ПОЛЬЗОВАТЕЛЯ:**\n` +
            `Показаны пользователи с активными абонементами\n` +
            `📅 - Месячный абонемент\n` +
            `🎫 - Разовое посещение абонемент\n`,
            {
                format: 'markdown',
                attachments: [keyboard]
            }
        );
        
    } catch (error) {
        logToFile(`❌ Ошибка admin_delete_sub_select: ${error.message}`);
    }
});

// 6.4 Подтверждение удаления абонемента пользователя
bot.action(/^admin_delete_sub_user_(\d+)$/, async (ctx) => {
    try {
        const userId = getUserId(ctx);
        if (!isAdmin(userId)) return;
        
        const targetUserId = ctx.match[1];
        const user = userStats[targetUserId];
        const subscription = userSubscriptions[targetUserId];
        
        if (!user) {
            await ctx.reply('❌ Пользователь не найден', { format: 'markdown' });
            return;
        }
        
        if (!subscription) {
            await ctx.reply(
                `**❌ АБОНЕМЕНТ НЕ НАЙДЕН**\n\n` +
                `У пользователя **${user.name}** нет активного абонемента.`,
                { format: 'markdown' }
            );
            return;
        }
        
        await ctx.deleteMessage();
        
        const keyboard = Keyboard.inlineKeyboard([
            [
                Keyboard.button.callback('✅ Да, удалить абонемент', `admin_delete_sub_confirm_${targetUserId}`),
                Keyboard.button.callback('❌ Нет, отменить', 'admin_delete_sub_select')
            ]
        ]);
        
        const subType = subscription.type === 'monthly' ? '📅 Месячный' : '🎫 Разовое посещение';
        const startDate = new Date(subscription.startDate);
        const endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + 30);
        const daysLeft = Math.ceil((endDate - new Date()) / (1000 * 60 * 60 * 24));
        
        await ctx.reply(
            `**⚠️ ПОДТВЕРЖДЕНИЕ УДАЛЕНИЯ АБОНЕМЕНТА**\n\n` +
            `**📋 ИНФОРМАЦИЯ О ПОЛЬЗОВАТЕЛЕ:**\n` +
            `👤 Имя: **${user.name}**\n` +
            `🆔 ID: ${targetUserId}\n` +
            `📅 Регистрация: ${new Date(user.firstSeen).toLocaleDateString('ru-RU')}\n` +
            `🎯 Посещений: ${user.attended || 0}\n\n` +
            
            `**💳 ИНФОРМАЦИЯ ОБ АБОНЕМЕНТЕ:**\n` +
            `Тип: ${subType}\n` +
            `Осталось занятий: ${subscription.lessons}\n` +
            `Стоимость: ${subscription.cost || (subscription.type === 'monthly' ? 4400 : 700)} руб.\n` +
            `Начало: ${startDate.toLocaleDateString('ru-RU')}\n` +
            `Действует до: ${subscription.type === 'monthly' ? endDate.toLocaleDateString('ru-RU') : 'неограниченно'}\n` +
            `Осталось дней: ${subscription.type === 'monthly' ? daysLeft : '∞'}\n\n` +
            
            `**🗑️ ЧТО БУДЕТ УДАЛЕНО:**\n` +
            `1. Активный абонемент пользователя\n` +
            `2. Доступ к записи на тренировки (пока не купит новый)\n` +
            `3. Информация об абонементе в системе\n\n` +
            
            `**✅ ЧТО СОХРАНИТСЯ:**\n` +
            `1. Статистика пользователя\n` +
            `2. История посещений\n` +
            `3. История покупок (в статистике)\n` +
            `4. Возможность купить новый абонемент\n\n` +
            
            `**📨 УВЕДОМЛЕНИЕ:**\n` +
            `Пользователь **НЕ** получит автоматическое уведомление.\n` +
            `Рекомендуется сообщить пользователю вручную.\n\n` +
            
            `Вы уверены, что хотите удалить абонемент у пользователя **${user.name}**?`,
            {
                format: 'markdown',
                attachments: [keyboard]
            }
        );
        
    } catch (error) {
        logToFile(`❌ Ошибка admin_delete_sub_user: ${error.message}`);
    }
});

// 6.5 Фактическое удаление абонемента
bot.action(/^admin_delete_sub_confirm_(\d+)$/, async (ctx) => {
    try {
        const userId = getUserId(ctx);
        if (!isAdmin(userId)) return;
        
        const targetUserId = ctx.match[1];
        const user = userStats[targetUserId];
        const subscription = userSubscriptions[targetUserId];
        
        if (!user) {
            await ctx.reply('❌ Пользователь не найден', { format: 'markdown' });
            return;
        }
        
        if (!subscription) {
            await ctx.reply('❌ Абонемент уже удален', { format: 'markdown' });
            return;
        }
        
        await ctx.deleteMessage();
        
        const subType = subscription.type === 'monthly' ? '📅 Месячный' : '🎫 Разовое посещение';
        const lessons = subscription.lessons;
        const cost = subscription.cost || (subscription.type === 'monthly' ? 4400 : 700);
        
        // Удаляем абонемент
        delete userSubscriptions[targetUserId];
        saveSubscriptions();
        
        // Логируем удаление
        logToFile(`🗑️ Админ ${userId} удалил абонемент у пользователя ${user.name} (${targetUserId}): ${subType}, ${lessons} занятий, ${cost} руб.`);
        
        const keyboard = Keyboard.inlineKeyboard([
            [
                Keyboard.button.callback('📨 Сообщить пользователю', `admin_notify_user_${targetUserId}_sub_deleted`),
                Keyboard.button.callback('« Назад к удалению', 'admin_delete')
            ]
        ]);
        
        await ctx.reply(
            `✅ **АБОНЕМЕНТ УСПЕШНО УДАЛЕН!**\n\n` +
            `**🗑️ УДАЛЕННЫЕ ДАННЫЕ:**\n` +
            `👤 Пользователь: **${user.name}**\n` +
            `🆔 ID: ${targetUserId}\n` +
            `🎫 Тип абонемента: ${subType}\n` +
            `📊 Удалено занятий: ${lessons}\n` +
            `💰 Стоимость: ${cost} руб.\n` +
            `📅 Дата удаления: ${new Date().toLocaleDateString('ru-RU')}\n\n` +
            
            `**📊 ТЕКУЩИЙ СТАТУС ПОЛЬЗОВАТЕЛЯ:**\n` +
            `Активный абонемент: ❌ **НЕТ**\n` +
            `Может записываться: ❌ **НЕТ** (требуется абонемент)\n` +
            `Статистика сохранена: ✅ **ДА**\n\n` +
            
            `**💡 РЕКОМЕНДАЦИИ:**\n` +
            `1. Сообщите пользователю об удалении\n` +
            `2. Объясните причину (если нужно)\n` +
            `3. Предложите купить новый абонемент\n` +
            `4. Ответьте на возможные вопросы\n\n` +
            
            `**✅ ОПЕРАЦИЯ ЗАВЕРШЕНА**`,
            {
                format: 'markdown',
                attachments: [keyboard]
            }
        );
        
    } catch (error) {
        logToFile(`❌ Ошибка admin_delete_sub_confirm: ${error.message}`);
    }
});

// 6.6 Уведомление пользователя об удалении абонемента
bot.action(/^admin_notify_user_(\d+)_sub_deleted$/, async (ctx) => {
    try {
        const adminId = getUserId(ctx);
        if (!isAdmin(adminId)) return;
        
        const targetUserId = ctx.match[1];
        const user = userStats[targetUserId];
        
        if (!user) {
            await ctx.reply('❌ Пользователь не найден', { format: 'markdown' });
            return;
        }
        
        await ctx.deleteMessage();
        
        const keyboard = Keyboard.inlineKeyboard([
            [
                Keyboard.button.callback('💳 Предложить купить абонемент', `admin_offer_sub_${targetUserId}`),
                Keyboard.button.callback('✅ Готовое сообщение', `admin_prepared_msg_${targetUserId}`)
            ],
            [
                Keyboard.button.callback('« Назад', 'admin_delete')
            ]
        ]);
        
        await ctx.reply(
            `**📨 УВЕДОМЛЕНИЕ ПОЛЬЗОВАТЕЛЯ ОБ УДАЛЕНИИ АБОНЕМЕНТА**\n\n` +
            `**👤 ПОЛЬЗОВАТЕЛЬ:**\n` +
            `Имя: **${user.name}**\n` +
            `ID: ${targetUserId}\n\n` +
            
            `**💡 ВАРИАНТЫ СООБЩЕНИЙ:**\n\n` +
            `**1. СТАНДАРТНОЕ СООБЩЕНИЕ:**\n` +
            `"Здравствуйте! Ваш абонемент был удален из системы. Для записи на тренировки необходимо приобрести новый абонемент."\n\n` +
            
            `**2. С ИЗВИНЕНИЯМИ:**\n` +
            `"Здравствуйте! По техническим причинам ваш абонемент был удален. Приносим извинения за неудобства. Вы можете приобрести новый абонемент."\n\n` +
            
            `**3. С ПРЕДЛОЖЕНИЕМ:**\n` +
            `"Здравствуйте! Ваш абонемент истек/был удален. Предлагаем приобрести новый абонемент со скидкой 10%!"\n\n` +
            
            `**📝 КАК ОТПРАВИТЬ:**\n` +
            `Используйте команду:\n` +
            `\`/msg ${targetUserId} Ваш текст сообщения\`\n\n` +
            
            `**Выберите вариант:**`,
            {
                format: 'markdown',
                attachments: [keyboard]
            }
        );
        
    } catch (error) {
        logToFile(`❌ Ошибка admin_notify_user: ${error.message}`);
    }
});

// 6.7 Предложение купить абонемент
bot.action(/^admin_offer_sub_(\d+)$/, async (ctx) => {
    try {
        const adminId = getUserId(ctx);
        if (!isAdmin(adminId)) return;
        
        const targetUserId = ctx.match[1];
        const user = userStats[targetUserId];
        
        if (!user) {
            await ctx.reply('❌ Пользователь не найден', { format: 'markdown' });
            return;
        }
        
        await ctx.deleteMessage();
        
        const message = `Здравствуйте, ${user.name}! 👋\n\n` +
            `Мы заметили, что у вас нет активного абонемента. \n\n` +
            `**🎯 ПРЕДЛАГАЕМ ВАМ:**\n` +
            `📅 **Месячный абонемент** - 8 занятий за 4400 руб.\n` +
            `└─ Цена за занятие: 550 руб. (экономия 21%)\n` +
            `└─ Идеально для регулярных тренировок\n\n` +
            `🎫 **Разовое посещение абонемент** - 1 занятие за 700 руб.\n` +
            `└─ Неограниченный срок действия\n\n` +
            `**💳 КАК КУПИТЬ:**\n` +
            `1. Напишите /купить\n` +
            `2. Выберите тип абонемента\n` +
            `3. Оплатите удобным способом\n\n` +
            `**🏃‍♀️ ЖДЕМ ВАС НА ТРЕНИРОВКАХ!**`;
        
        const keyboard = Keyboard.inlineKeyboard([
            [
                Keyboard.button.callback('📨 Отправить это сообщение', `admin_send_offer_${targetUserId}`),
                Keyboard.button.callback('✏️ Редактировать', `admin_edit_offer_${targetUserId}`)
            ],
            [
                Keyboard.button.callback('« Назад', `admin_notify_user_${targetUserId}_sub_deleted`)
            ]
        ]);
        
        await ctx.reply(
            `**💳 ПРЕДЛОЖЕНИЕ КУПИТЬ АБОНЕМЕНТ**\n\n` +
            `**👤 ПОЛЬЗОВАТЕЛЬ:** ${user.name}\n\n` +
            `**📝 ТЕКСТ СООБЩЕНИЯ:**\n` +
            `${message}\n\n` +
            `**📨 ОТПРАВИТЬ ЭТО СООБЩЕНИЕ?**`,
            {
                format: 'markdown',
                attachments: [keyboard]
            }
        );
        
    } catch (error) {
        logToFile(`❌ Ошибка admin_offer_sub: ${error.message}`);
    }
});

// 6.8 Отправка предложения
bot.action(/^admin_send_offer_(\d+)$/, async (ctx) => {
    try {
        const adminId = getUserId(ctx);
        if (!isAdmin(adminId)) return;
        
        const targetUserId = ctx.match[1];
        const user = userStats[targetUserId];
        
        if (!user) {
            await ctx.reply('❌ Пользователь не найден', { format: 'markdown' });
            return;
        }
        
        // Отправляем сообщение пользователю
        try {
            await bot.api.sendMessageToUser(
                targetUserId,
                `Здравствуйте, ${user.name}! 👋\n\n` +
                `Мы заметили, что у вас нет активного абонемента. \n\n` +
                `**🎯 ПРЕДЛАГАЕМ ВАМ:**\n` +
                `📅 **Месячный абонемент** - 8 занятий за 4400 руб.\n` +
                `└─ Цена за занятие: 550 руб. (экономия 21%)\n` +
                `└─ Идеально для регулярных тренировок\n\n` +
                `🎫 **Разовое посещение абонемент** - 1 занятие за 700 руб.\n` +
                `└─ Для пробного посещения\n` +
                `└─ Неограниченный срок действия\n\n` +
                `**💳 КАК КУПИТЬ:**\n` +
                `1. Напишите /купить\n` +
                `2. Выберите тип абонемента\n` +
                `3. Оплатите удобным способом\n\n` +
                `**🏃‍♀️ ЖДЕМ ВАС НА ТРЕНИРОВКАХ!**`,
                { format: 'markdown' }
            );
            
            await ctx.reply(
                `✅ **СООБЩЕНИЕ ОТПРАВЛЕНО!**\n\n` +
                `Пользователь **${user.name}** получил предложение купить абонемент.\n\n` +
                `**📊 СТАТИСТИКА:**\n` +
                `Активных абонементов у пользователя: ${userSubscriptions[targetUserId] ? '✅' : '❌'}\n` +
                `Посещений тренировок: ${user.attended || 0}\n` +
                `Последняя активность: ${new Date(user.lastActivity).toLocaleDateString('ru-RU')}\n\n` +
                `**💡 СОВЕТ:**\n` +
                `Следите за активностью пользователя. Если не отреагирует, можно написать повторно через 2-3 дня.`,
                { format: 'markdown' }
            );
            
            logToFile(`📨 Админ ${adminId} отправил предложение купить абонемент пользователю ${user.name} (${targetUserId})`);
            
        } catch (sendError) {
            await ctx.reply(
                `❌ **НЕ УДАЛОСЬ ОТПРАВИТЬ СООБЩЕНИЕ**\n\n` +
                `Пользователь ${user.name} (${targetUserId}) не найден или заблокировал бота.\n\n` +
                `Попробуйте связаться другим способом: +7 (925) 225-13-36`,
                { format: 'markdown' }
            );
            logToFile(`❌ Не удалось отправить предложение пользователю ${targetUserId}: ${sendError.message}`);
        }
        
    } catch (error) {
        logToFile(`❌ Ошибка admin_send_offer: ${error.message}`);
    }
});

// 6.9 Поиск пользователя по ID для удаления абонемента
bot.action('admin_delete_sub_search', async (ctx) => {
    try {
        const adminId = getUserId(ctx);
        if (!isAdmin(adminId)) return;
        
        await ctx.deleteMessage();
        
        const keyboard = Keyboard.inlineKeyboard([
            [
                Keyboard.button.callback('« Назад', 'admin_delete_sub_select')
            ]
        ]);
        
        await ctx.reply(
            `**🔍 ПОИСК ПОЛЬЗОВАТЕЛЯ ПО ID**\n\n` +
            `**📝 ИНСТРУКЦИЯ:**\n` +
            `Чтобы удалить абонемент по ID пользователя:\n\n` +
            `1. Узнайте ID пользователя (можно через /ид_чата если он в чате)\n` +
            `2. Используйте команду:\n` +
            `\`/deletesub ID_пользователя\`\n\n` +
            `**Пример:**\n` +
            `\`/deletesub 123456789\`\n\n` +
            `**⚠️ ВНИМАНИЕ:**\n` +
            `Команда сразу удалит абонемент без дополнительных подтверждений!\n` +
            `Используйте осторожно.`,
            {
                format: 'markdown',
                attachments: [keyboard]
            }
        );
        
    } catch (error) {
        logToFile(`❌ Ошибка admin_delete_sub_search: ${error.message}`);
    }
});
// ========== ОЧИСТКА СТАТИСТИКИ ==========

// 6.10 Очистка статистики (главное меню)
bot.action('admin_clear_stats', async (ctx) => {
    try {
        const userId = getUserId(ctx);
        if (!isAdmin(userId)) return;
        
        await ctx.deleteMessage();
        
        const keyboard = Keyboard.inlineKeyboard([
            [
                Keyboard.button.callback('📊 Общая статистика', 'admin_clear_stats_main'),
                Keyboard.button.callback('👤 По пользователям', 'admin_clear_stats_users')
            ],
            [
                Keyboard.button.callback('📅 История посещений', 'admin_clear_stats_history'),
                Keyboard.button.callback('💳 Покупки', 'admin_clear_stats_purchases')
            ],
            [
                Keyboard.button.callback('« Назад к удалению', 'admin_delete')
            ]
        ]);
        
        // Подсчет текущих данных
        const totalUsers = Object.keys(userStats).length;
        let totalHistoryEntries = 0;
        let totalSubs = Object.keys(userSubscriptions).length;
        
        Object.values(userStats).forEach(user => {
            if (user.history) {
                totalHistoryEntries += user.history.length;
            }
        });
        
        let response = `**🗑️ ОЧИСТКА СТАТИСТИКИ**\n\n`;
        
        response += `**📊 ТЕКУЩАЯ СТАТИСТИКА СИСТЕМЫ:**\n`;
        response += `👥 Пользователей: **${totalUsers}**\n`;
        response += `📝 Записей истории: **${totalHistoryEntries}**\n`;
        response += `💳 Абонементов: **${totalSubs}**\n\n`;
        
        response += `**⚠️ ВНИМАНИЕ:**\n`;
        response += `Очистка статистики - критическая операция!\n`;
        response += `Удаленные данные невозможно восстановить.\n\n`;
        
        response += `**🎯 ВАРИАНТЫ ОЧИСТКИ:**\n\n`;
        
        response += `**1. 📊 ОБЩАЯ СТАТИСТИКА:**\n`;
        response += `└─ Сброс счетчиков посещений\n`;
        response += `└─ Очистка общей активности\n`;
        response += `└─ Сохранение пользователей\n\n`;
        
        response += `**2. 👤 ПО ПОЛЬЗОВАТЕЛЯМ:**\n`;
        response += `└─ Выборочная очистка\n`;
        response += `└─ Удаление статистики конкретных пользователей\n`;
        response += `└─ Сохранение основных данных\n\n`;
        
        response += `**3. 📅 ИСТОРИЯ ПОСЕЩЕНИЙ:**\n`;
        response += `└─ Удаление истории тренировок\n`;
        response += `└─ Очистка устаревших записей\n`;
        response += `└─ Сохранение итоговой статистики\n\n`;
        
        response += `**4. 💳 ПОКУПКИ:**\n`;
        response += `└─ Очистка истории покупок\n`;
        response += `└─ Удаление старых транзакций\n`;
        response += `└─ Сохранение текущих абонементов\n\n`;
        
        response += `**💡 РЕКОМЕНДАЦИИ:**\n`;
        response += `• Перед очисткой сделайте резервную копию\n`;
        response += `• Используйте выборочную очистку когда возможно\n`;
        response += `• Сохраняйте важные данные вручную\n`;
        response += `• Информируйте пользователей о изменениях\n\n`;
        
        response += `**Выберите тип очистки:**`;
        
        await ctx.reply(response, {
            format: 'markdown',
            attachments: [keyboard]
        });
        
    } catch (error) {
        logToFile(`❌ Ошибка admin_clear_stats: ${error.message}`);
    }
});

// 6.11 Очистка общей статистики
bot.action('admin_clear_stats_main', async (ctx) => {
    try {
        const userId = getUserId(ctx);
        if (!isAdmin(userId)) return;
        
        await ctx.deleteMessage();
        
        const keyboard = Keyboard.inlineKeyboard([
            [
                Keyboard.button.callback('✅ Да, очистить всю статистику', 'admin_clear_stats_main_confirm'),
                Keyboard.button.callback('📊 Сбросить только счетчики', 'admin_clear_stats_counters')
            ],
            [
                Keyboard.button.callback('❌ Нет, отменить', 'admin_clear_stats')
            ]
        ]);
        
        // Подсчет текущих данных
        const totalUsers = Object.keys(userStats).length;
        let totalAttended = 0;
        let totalMissed = 0;
        let totalMaybe = 0;
        
        Object.values(userStats).forEach(user => {
            totalAttended += user.attended || 0;
            totalMissed += user.missed || 0;
            totalMaybe += user.maybe || 0;
        });
        
        let response = `**📊 ОЧИСТКА ОБЩЕЙ СТАТИСТИКИ**\n\n`;
        
        response += `**📈 ТЕКУЩАЯ СТАТИСТИКА:**\n`;
        response += `👥 Пользователей: **${totalUsers}**\n`;
        response += `✅ Посещений: **${totalAttended}**\n`;
        response += `❌ Пропусков: **${totalMissed}**\n`;
        response += `❓ Возможно: **${totalMaybe}**\n\n`;
        
        response += `**⚠️ ВАРИАНТЫ ОЧИСТКИ:**\n\n`;
        
        response += `**1. ПОЛНАЯ ОЧИСТКА:**\n`;
        response += `└─ Удаление всей статистики\n`;
        response += `└─ Сброс всех счетчиков\n`;
        response += `└─ Очистка истории активности\n`;
        response += `└─ **НЕОБРАТИМО!**\n\n`;
        
        response += `**2. СБРОС СЧЕТЧИКОВ:**\n`;
        response += `└─ Обнуление посещений/пропусков\n`;
        response += `└─ Сохранение пользователей\n`;
        response += `└─ Сохранение истории покупок\n`;
        response += `└─ Можно восстановить активность\n\n`;
        
        response += `**💡 ЧТО СОХРАНИТСЯ ПРИ СБРОСЕ СЧЕТЧИКОВ:**\n`;
        response += `✅ Данные пользователей\n`;
        response += `✅ Абонементы\n`;
        response += `✅ История покупок\n`;
        response += `✅ Личные настройки\n\n`;
        
        response += `**📅 ПОСЛЕ ОЧИСТКИ:**\n`;
        response += `• Начнется новый отсчет статистики\n`;
        response += `• Пользователи сохранятся в системе\n`;
        response += `• Можно продолжать работу\n\n`;
        
        response += `**Выберите вариант:**`;
        
        await ctx.reply(response, {
            format: 'markdown',
            attachments: [keyboard]
        });
        
    } catch (error) {
        logToFile(`❌ Ошибка admin_clear_stats_main: ${error.message}`);
    }
});

// 6.12 Подтверждение полной очистки статистики
bot.action('admin_clear_stats_main_confirm', async (ctx) => {
    try {
        const userId = getUserId(ctx);
        if (!isAdmin(userId)) return;
        
        await ctx.deleteMessage();
        
        const keyboard = Keyboard.inlineKeyboard([
            [
                Keyboard.button.callback('⚠️ ДА, Я ПОНИМАЮ!', 'admin_clear_stats_main_execute'),
                Keyboard.button.callback('❌ НЕТ, Я ПЕРЕДУМАЛ', 'admin_clear_stats_main')
            ]
        ]);
        
        // Подсчет данных для удаления
        const totalUsers = Object.keys(userStats).length;
        let totalHistoryEntries = 0;
        let totalAttended = 0;
        
        Object.values(userStats).forEach(user => {
            if (user.history) {
                totalHistoryEntries += user.history.length;
            }
            totalAttended += user.attended || 0;
        });
        
        let response = `**⚠️ ПОСЛЕДНЕЕ ПРЕДУПРЕЖДЕНИЕ!**\n\n`;
        
        response += `**❌ ВЫ УДАЛИТЕ:**\n`;
        response += `👥 Пользователей: **${totalUsers}**\n`;
        response += `📝 Записей истории: **${totalHistoryEntries}**\n`;
        response += `✅ Посещений: **${totalAttended}**\n`;
        response += `🔄 Активность: **ВСЮ**\n\n`;
        
        response += `**✅ ЧТО СОХРАНИТСЯ:**\n`;
        response += `💳 Абонементы\n`;
        response += `🏦 Балансы\n`;
        response += `📋 Настройки системы\n\n`;
        
        response += `**💡 ПОСЛЕ ОЧИСТКИ:**\n`;
        response += `1. Все пользователи будут сброшены\n`;
        response += `2. Статистика начнется с нуля\n`;
        response += `3. История посещений удалена\n`;
        response += `4. Невозможно восстановить данные\n\n`;
        
        response += `**📋 РЕКОМЕНДАЦИЯ:**\n`;
        response += `Перед очисткой сделайте резервную копию:\n`;
        response += `• Файл: logs/user_stats.json\n`;
        response += `• Сохраните его в надежное место\n\n`;
        
        response += `**ВЫ УВЕРЕНЫ, ЧТО ХОТИТЕ УДАЛИТЬ ВСЮ СТАТИСТИКУ?**\n`;
        response += `Эта операция НЕОБРАТИМА!`;
        
        await ctx.reply(response, {
            format: 'markdown',
            attachments: [keyboard]
        });
        
    } catch (error) {
        logToFile(`❌ Ошибка admin_clear_stats_main_confirm: ${error.message}`);
    }
});

// 6.13 Выполнение полной очистки статистики
bot.action('admin_clear_stats_main_execute', async (ctx) => {
    try {
        const adminId = getUserId(ctx);
        if (!isAdmin(adminId)) return;
        
        await ctx.deleteMessage();
        
        // Сохраняем данные перед удалением для логов
        const totalUsersBefore = Object.keys(userStats).length;
        const totalSubsBefore = Object.keys(userSubscriptions).length;
        let totalHistoryBefore = 0;
        
        Object.values(userStats).forEach(user => {
            if (user.history) {
                totalHistoryBefore += user.history.length;
            }
        });
        
        // Полностью очищаем статистику
        for (const userId in userStats) {
            // Сбрасываем статистику, но сохраняем основные данные пользователя
            userStats[userId] = {
                name: userStats[userId].name,
                totalTrainings: 0,
                attended: 0,
                missed: 0,
                maybe: 0,
                noShow: 0,
                history: [],
                subscriptionHistory: userStats[userId].subscriptionHistory || [], // Сохраняем историю покупок
                firstSeen: userStats[userId].firstSeen, // Сохраняем дату регистрации
                lastActivity: new Date().toISOString() // Обновляем активность
            };
        }
        
        // Сохраняем изменения
        saveUserStats();
        
        // Логируем очистку
        logToFile(`🗑️ Админ ${adminId} очистил всю статистику: ${totalUsersBefore} пользователей, ${totalHistoryBefore} записей истории`);
        
        const keyboard = Keyboard.inlineKeyboard([
            [
                Keyboard.button.callback('« Назад к очистке', 'admin_clear_stats')
            ]
        ]);
        
        await ctx.reply(
            `✅ **СТАТИСТИКА ПОЛНОСТЬЮ ОЧИЩЕНА!**\n\n` +
            `**🗑️ УДАЛЕННЫЕ ДАННЫЕ:**\n` +
            `👥 Пользователей сброшено: **${totalUsersBefore}**\n` +
            `📝 Записей истории удалено: **${totalHistoryBefore}**\n` +
            `📊 Статистика обнулена\n\n` +
            
            `**✅ СОХРАНЕННЫЕ ДАННЫЕ:**\n` +
            `💳 Абонементы: **${totalSubsBefore}**\n` +
            `📋 История покупок: сохранена\n` +
            `👤 Данные пользователей: сохранены\n` +
            `📅 Даты регистрации: сохранены\n\n` +
            
            `**🎯 ЧТО ДАЛЬШЕ:**\n` +
            `1. Статистика начинает новый отсчет\n` +
            `2. Пользователи могут продолжать тренироваться\n` +
            `3. Все абонементы остаются активными\n` +
            `4. Система готова к работе\n\n` +
            
            `**📊 НАЧАЛО НОВОГО ОТЧЕТНОГО ПЕРИОДА:**\n` +
            `Дата: ${new Date().toLocaleDateString('ru-RU')}\n` +
            `Время: ${new Date().toLocaleTimeString('ru-RU')}\n\n` +
            
            `**✅ ОПЕРАЦИЯ ЗАВЕРШЕНА**`,
            {
                format: 'markdown',
                attachments: [keyboard]
            }
        );
        
    } catch (error) {
        logToFile(`❌ Ошибка admin_clear_stats_main_execute: ${error.message}`);
    }
});

// 6.14 Сброс только счетчиков
bot.action('admin_clear_stats_counters', async (ctx) => {
    try {
        const adminId = getUserId(ctx);
        if (!isAdmin(adminId)) return;
        
        await ctx.deleteMessage();
        
        // Сохраняем данные перед сбросом
        let totalAttendedBefore = 0;
        let totalMissedBefore = 0;
        let totalMaybeBefore = 0;
        let totalHistoryBefore = 0;
        const totalUsers = Object.keys(userStats).length;
        
        Object.values(userStats).forEach(user => {
            totalAttendedBefore += user.attended || 0;
            totalMissedBefore += user.missed || 0;
            totalMaybeBefore += user.maybe || 0;
            if (user.history) {
                totalHistoryBefore += user.history.length;
            }
        });
        
        // Сбрасываем только счетчики, сохраняя историю
        for (const userId in userStats) {
            userStats[userId].totalTrainings = 0;
            userStats[userId].attended = 0;
            userStats[userId].missed = 0;
            userStats[userId].maybe = 0;
            userStats[userId].noShow = 0;
            // История посещений сохраняется!
            userStats[userId].lastActivity = new Date().toISOString();
        }
        
        // Сохраняем изменения
        saveUserStats();
        
        // Логируем сброс
        logToFile(`🗑️ Админ ${adminId} сбросил счетчики статистики: ${totalAttendedBefore} посещений, ${totalMissedBefore} пропусков, ${totalMaybeBefore} возможно`);
        
        const keyboard = Keyboard.inlineKeyboard([
            [
                Keyboard.button.callback('« Назад к очистке', 'admin_clear_stats')
            ]
        ]);
        
        await ctx.reply(
            `✅ **СЧЕТЧИКИ СТАТИСТИКИ СБРОШЕНЫ!**\n\n` +
            `**🗑️ УДАЛЕННЫЕ ДАННЫЕ:**\n` +
            `✅ Посещений: **${totalAttendedBefore}**\n` +
            `❌ Пропусков: **${totalMissedBefore}**\n` +
            `❓ Возможно: **${totalMaybeBefore}**\n` +
            `📊 Всего тренировок: **${totalAttendedBefore + totalMissedBefore}**\n\n` +
            
            `**✅ СОХРАНЕННЫЕ ДАННЫЕ:**\n` +
            `👥 Пользователей: **${totalUsers}**\n` +
            `📝 История посещений: **${totalHistoryBefore} записей**\n` +
            `💳 Абонементы: **${Object.keys(userSubscriptions).length}**\n` +
            `📋 История покупок: сохранена\n\n` +
            
            `**🎯 ЧТО ДАЛЬШЕ:**\n` +
            `1. Счетчики обнулены\n` +
            `2. История посещений сохранена\n` +
            `3. Пользователи сохранили свои данные\n` +
            `4. Можно анализировать историю\n` +
            `5. Новые тренировки будут считать с нуля\n\n` +
            
            `**📊 НАЧАЛО НОВОГО УЧЕТНОГО ПЕРИОДА:**\n` +
            `Дата: ${new Date().toLocaleDateString('ru-RU')}\n` +
            `Время: ${new Date().toLocaleTimeString('ru-RU')}\n\n` +
            
            `**💡 ПРЕИМУЩЕСТВА:**\n` +
            `• Можно анализировать историю\n` +
            `• Пользователи не теряют данные\n` +
            `• Легко сравнить периоды\n` +
            `• Гибкая система отчетности\n\n` +
            
            `**✅ ОПЕРАЦИЯ ЗАВЕРШЕНА**`,
            {
                format: 'markdown',
                attachments: [keyboard]
            }
        );
        
    } catch (error) {
        logToFile(`❌ Ошибка admin_clear_stats_counters: ${error.message}`);
    }
});

// 6.15 Очистка статистики по пользователям
bot.action('admin_clear_stats_users', async (ctx) => {
    try {
        const userId = getUserId(ctx);
        if (!isAdmin(userId)) return;
        
        await ctx.deleteMessage();
        
        // Получаем список пользователей для очистки (топ 15 по активности)
        const usersForClearing = Object.entries(userStats)
            .sort((a, b) => (b[1].attended || 0) - (a[1].attended || 0))
            .slice(0, 15);
        
        if (usersForClearing.length === 0) {
            await ctx.reply(
                `**📭 НЕТ ДАННЫХ ДЛЯ ОЧИСТКИ**\n\n` +
                `В системе нет пользователей со статистикой.`,
                { format: 'markdown' }
            );
            return;
        }
        
        const keyboardButtons = [];
        
        usersForClearing.forEach(([id, user], index) => {
            const userName = user.name || 'Без имени';
            const shortName = userName.length > 15 ? userName.substring(0, 15) + '...' : userName;
            const attended = user.attended || 0;
            
            keyboardButtons.push([
                Keyboard.button.callback(
                    `${index + 1}. ${shortName} (${attended} посещений)`,
                    `admin_clear_stats_user_${id}`
                )
            ]);
        });
        
        keyboardButtons.push([
            Keyboard.button.callback('🔍 Поиск по ID', 'admin_clear_stats_user_search')
        ]);
        
        keyboardButtons.push([
            Keyboard.button.callback('« Назад к очистке', 'admin_clear_stats')
        ]);
        
        const keyboard = Keyboard.inlineKeyboard(keyboardButtons);
        
        await ctx.reply(
            `**👤 ОЧИСТКА СТАТИСТИКИ ПО ПОЛЬЗОВАТЕЛЯМ**\n\n` +
            `**⚠️ ВНИМАНИЕ:**\n` +
            `При очистке статистики пользователя будут удалены:\n` +
            `• История посещений\n` +
            `• Счетчики тренировок\n` +
            `• Данные о пропусках\n\n` +
            
            `**✅ ЧТО СОХРАНИТСЯ:**\n` +
            `• Данные пользователя\n` +
            `• Абонементы\n` +
            `• История покупок\n` +
            `• Дата регистрации\n\n` +
            
            `**📋 ВЫБЕРИТЕ ПОЛЬЗОВАТЕЛЯ:**\n` +
            `Показаны пользователи с наибольшим количеством посещений\n`,
            {
                format: 'markdown',
                attachments: [keyboard]
            }
        );
        
    } catch (error) {
        logToFile(`❌ Ошибка admin_clear_stats_users: ${error.message}`);
    }
});

// 6.16 Очистка статистики конкретного пользователя
bot.action(/^admin_clear_stats_user_(\d+)$/, async (ctx) => {
    try {
        const adminId = getUserId(ctx);
        if (!isAdmin(adminId)) return;
        
        const targetUserId = ctx.match[1];
        const user = userStats[targetUserId];
        
        if (!user) {
            await ctx.reply('❌ Пользователь не найден', { format: 'markdown' });
            return;
        }
        
        await ctx.deleteMessage();
        
        const attended = user.attended || 0;
        const missed = user.missed || 0;
        const maybe = user.maybe || 0;
        const historyCount = user.history ? user.history.length : 0;
        
        const keyboard = Keyboard.inlineKeyboard([
            [
                Keyboard.button.callback('✅ Да, очистить статистику', `admin_clear_stats_user_confirm_${targetUserId}`),
                Keyboard.button.callback('❌ Нет, отменить', 'admin_clear_stats_users')
            ]
        ]);
        
        await ctx.reply(
            `**⚠️ ОЧИСТКА СТАТИСТИКИ ПОЛЬЗОВАТЕЛЯ**\n\n` +
            `**👤 ИНФОРМАЦИЯ О ПОЛЬЗОВАТЕЛЕ:**\n` +
            `Имя: **${user.name}**\n` +
            `🆔 ID: ${targetUserId}\n` +
            `📅 Регистрация: ${new Date(user.firstSeen).toLocaleDateString('ru-RU')}\n` +
            `🔄 Последняя активность: ${new Date(user.lastActivity).toLocaleDateString('ru-RU')}\n\n` +
            
            `**📊 ТЕКУЩАЯ СТАТИСТИКА:**\n` +
            `✅ Посещений: ${attended}\n` +
            `❌ Пропусков: ${missed}\n` +
            `❓ Возможно: ${maybe}\n` +
            `📝 Записей истории: ${historyCount}\n\n` +
            
            `**🗑️ ЧТО БУДЕТ УДАЛЕНО:**\n` +
            `1. Вся история посещений (${historyCount} записей)\n` +
            `2. Счетчики тренировок\n` +
            `3. Данные о пропусках\n` +
            `4. Статистика активности\n\n` +
            
            `**✅ ЧТО СОХРАНИТСЯ:**\n` +
            `1. Данные пользователя\n` +
            `2. Абонементы\n` +
            `3. История покупок\n` +
            `4. Дата регистрации\n` +
            `5. Возможность тренироваться\n\n` +
            
            `**💡 ПОСЛЕ ОЧИСТКИ:**\n` +
            `• Статистика пользователя начнется с нуля\n` +
            `• История будет удалена безвозвратно\n` +
            `• Пользователь сохранит абонемент\n` +
            `• Можно продолжать тренировки\n\n` +
            
            `Вы уверены, что хотите очистить статистику пользователя **${user.name}**?`,
            {
                format: 'markdown',
                attachments: [keyboard]
            }
        );
        
    } catch (error) {
        logToFile(`❌ Ошибка admin_clear_stats_user: ${error.message}`);
    }
});

// 6.17 Подтверждение очистки статистики пользователя
bot.action(/^admin_clear_stats_user_confirm_(\d+)$/, async (ctx) => {
    try {
        const adminId = getUserId(ctx);
        if (!isAdmin(adminId)) return;
        
        const targetUserId = ctx.match[1];
        const user = userStats[targetUserId];
        
        if (!user) {
            await ctx.reply('❌ Пользователь не найден', { format: 'markdown' });
            return;
        }
        
        await ctx.deleteMessage();
        
        const attendedBefore = user.attended || 0;
        const missedBefore = user.missed || 0;
        const maybeBefore = user.maybe || 0;
        const historyCountBefore = user.history ? user.history.length : 0;
        
        // Очищаем статистику пользователя
        userStats[targetUserId] = {
            name: user.name,
            totalTrainings: 0,
            attended: 0,
            missed: 0,
            maybe: 0,
            noShow: 0,
            history: [],
            subscriptionHistory: user.subscriptionHistory || [], // Сохраняем историю покупок
            firstSeen: user.firstSeen, // Сохраняем дату регистрации
            lastActivity: new Date().toISOString() // Обновляем активность
        };
        
        // Сохраняем изменения
        saveUserStats();
        
        // Логируем очистку
        logToFile(`🗑️ Админ ${adminId} очистил статистику пользователя ${user.name} (${targetUserId}): ${attendedBefore} посещений, ${historyCountBefore} записей истории`);
        
        const keyboard = Keyboard.inlineKeyboard([
            [
                Keyboard.button.callback('« Назад к очистке', 'admin_clear_stats_users')
            ]
        ]);
        
        await ctx.reply(
            `✅ **СТАТИСТИКА ПОЛЬЗОВАТЕЛЯ ОЧИЩЕНА!**\n\n` +
            `**👤 ПОЛЬЗОВАТЕЛЬ:** ${user.name}\n` +
            `🆔 ID: ${targetUserId}\n\n` +
            
            `**🗑️ УДАЛЕННЫЕ ДАННЫЕ:**\n` +
            `✅ Посещений: ${attendedBefore}\n` +
            `❌ Пропусков: ${missedBefore}\n` +
            `❓ Возможно: ${maybeBefore}\n` +
            `📝 Записей истории: ${historyCountBefore}\n\n` +
            
            `**✅ СОХРАНЕННЫЕ ДАННЫЕ:**\n` +
            `💳 Абонемент: ${userSubscriptions[targetUserId] ? '✅' : '❌'}\n` +
            `📋 История покупок: сохранена\n` +
            `📅 Дата регистрации: сохранена\n` +
            `👤 Данные пользователя: сохранены\n\n` +
            
            `**🎯 ЧТО ДАЛЬШЕ:**\n` +
            `1. Статистика пользователя обнулена\n` +
            `2. История посещений удалена\n` +
            `3. Пользователь сохраняет абонемент\n` +
            `4. Можно начинать новые тренировки\n` +
            `5. Данные невозможно восстановить\n\n` +
            
            `**✅ ОПЕРАЦИЯ ЗАВЕРШЕНА**`,
            {
                format: 'markdown',
                attachments: [keyboard]
            }
        );
        
    } catch (error) {
        logToFile(`❌ Ошибка admin_clear_stats_user_confirm: ${error.message}`);
    }
});

// 6.18 Очистка истории посещений
bot.action('admin_clear_stats_history', async (ctx) => {
    try {
        const userId = getUserId(ctx);
        if (!isAdmin(userId)) return;
        
        await ctx.deleteMessage();
        
        const keyboard = Keyboard.inlineKeyboard([
            [
                Keyboard.button.callback('🗑️ Очистить всю историю', 'admin_clear_stats_history_all'),
                Keyboard.button.callback('📅 Удалить старые записи', 'admin_clear_stats_history_old')
            ],
            [
                Keyboard.button.callback('« Назад к очистке', 'admin_clear_stats')
            ]
        ]);
        
        // Анализируем текущую историю
        let totalHistoryEntries = 0;
        let oldHistoryEntries = 0;
        const ninetyDaysAgo = new Date();
        ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
        
        Object.values(userStats).forEach(user => {
            if (user.history) {
                totalHistoryEntries += user.history.length;
                
                // Считаем старые записи (старше 90 дней)
                user.history.forEach(entry => {
                    if (new Date(entry.timestamp) < ninetyDaysAgo) {
                        oldHistoryEntries++;
                    }
                });
            }
        });
        
        let response = `**📅 ОЧИСТКА ИСТОРИИ ПОСЕЩЕНИЙ**\n\n`;
        
        response += `**📊 ТЕКУЩАЯ СИТУАЦИЯ:**\n`;
        response += `📝 Всего записей истории: **${totalHistoryEntries}**\n`;
        response += `📅 Записей старше 90 дней: **${oldHistoryEntries}**\n`;
        response += `📅 Свежих записей: **${totalHistoryEntries - oldHistoryEntries}**\n\n`;
        
        response += `**⚠️ ВАРИАНТЫ ОЧИСТКИ:**\n\n`;
        
        response += `**1. ОЧИСТИТЬ ВСЮ ИСТОРИЮ:**\n`;
        response += `└─ Удаление ВСЕХ записей посещений\n`;
        response += `└─ Сохранение итоговой статистики\n`;
        response += `└─ **НЕОБРАТИМО!**\n\n`;
        
        response += `**2. УДАЛИТЬ СТАРЫЕ ЗАПИСИ (90+ ДНЕЙ):**\n`;
        response += `└─ Удаление только старых данных\n`;
        response += `└─ Сохранение свежей истории\n`;
        response += `└─ Освобождение места\n`;
        response += `└─ Рекомендуемый вариант\n\n`;
        
        response += `**💡 ПРЕИМУЩЕСТВА УДАЛЕНИЯ СТАРЫХ ЗАПИСЕЙ:**\n`;
        response += `• Сохраняется актуальная история\n`;
        response += `• Уменьшается размер базы данных\n`;
        response += `• Улучшается производительность\n`;
        response += `• Можно анализировать последние данные\n\n`;
        
        response += `**Выберите вариант:**`;
        
        await ctx.reply(response, {
            format: 'markdown',
            attachments: [keyboard]
        });
        
    } catch (error) {
        logToFile(`❌ Ошибка admin_clear_stats_history: ${error.message}`);
    }
});
// Команда для быстрого удаления абонемента по ID
bot.command('deletesub', async (ctx) => {
    try {
        const adminId = getUserId(ctx);
        if (!isAdmin(adminId)) {
            await ctx.reply('❌ Доступ запрещен!', { format: 'markdown' });
            await ctx.deleteMessage();
            return;
        }
        
        const messageText = ctx.message.text;
        const parts = messageText.split(' ');
        
        if (parts.length !== 2) {
            await ctx.reply(
                `*❌ НЕВЕРНЫЙ ФОРМАТ КОМАНДЫ*\n\n` +
                `Правильный формат:\n` +
                `\`/deletesub ID_пользователя\`\n\n` +
                `Пример:\n` +
                `\`/deletesub 12345678\``,
                { format: 'markdown' }
            );
            await ctx.deleteMessage();
            return;
        }
        
        const targetUserId = parts[1];
        const user = userStats[targetUserId];
        const subscription = userSubscriptions[targetUserId];
        
        if (!user) {
            await ctx.reply(
                `❌ **ПОЛЬЗОВАТЕЛЬ НЕ НАЙДЕН**\n\n` +
                `Пользователь с ID ${targetUserId} не найден в системе.`,
                { format: 'markdown' }
            );
            await ctx.deleteMessage();
            return;
        }
        
        if (!subscription) {
            await ctx.reply(
                `❌ **АБОНЕМЕНТ НЕ НАЙДЕН**\n\n` +
                `У пользователя **${user.name}** нет активного абонемента.`,
                { format: 'markdown' }
            );
            await ctx.deleteMessage();
            return;
        }
        
        // Удаляем абонемент
        const subType = subscription.type === 'monthly' ? 'Месячный' : 'Разовое посещение';
        const lessons = subscription.lessons;
        const cost = subscription.cost || (subscription.type === 'monthly' ? 4400 : 700);
        
        delete userSubscriptions[targetUserId];
        saveSubscriptions();
        
        await ctx.reply(
            `✅ **АБОНЕМЕНТ УДАЛЕН!**\n\n` +
            `**🗑️ УДАЛЕННЫЕ ДАННЫЕ:**\n` +
            `👤 Пользователь: **${user.name}**\n` +
            `🆔 ID: ${targetUserId}\n` +
            `🎫 Тип: ${subType}\n` +
            `📊 Занятий: ${lessons}\n` +
            `💰 Стоимость: ${cost} руб.\n\n` +
            `**📊 СТАТУС:**\n` +
            `Активный абонемент: ❌ УДАЛЕН\n` +
            `Может записываться: ❌ НЕТ (требует новый абонемент)\n\n` +
            `**💡 РЕКОМЕНДАЦИЯ:**\n` +
            `Сообщите пользователю об удалении и предложите купить новый абонемент.`,
            { format: 'markdown' }
        );
        
        logToFile(`🗑️ Админ ${adminId} удалил абонемент через команду: пользователь ${user.name} (${targetUserId}), ${subType}, ${lessons} занятий`);
        
        await ctx.deleteMessage();
        
    } catch (error) {
        logToFile(`❌ Ошибка команды /deletesub: ${error.message}`);
    }
});
// 6.4 Очистка истории
bot.action('admin_clear_history', async (ctx) => {
    try {
        const userId = getUserId(ctx);
        if (!isAdmin(userId)) return;
        
        await ctx.deleteMessage();
        
        // Анализируем данные перед очисткой
        const totalUsers = Object.keys(userStats).length;
        let totalHistoryEntries = 0;
        let oldHistoryEntries = 0;
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        
        Object.values(userStats).forEach(user => {
            if (user.history) {
                totalHistoryEntries += user.history.length;
                
                // Считаем старые записи (старше 30 дней)
                user.history.forEach(entry => {
                    if (new Date(entry.timestamp) < thirtyDaysAgo) {
                        oldHistoryEntries++;
                    }
                });
            }
        });
        
        const keyboard = Keyboard.inlineKeyboard([
            [
                Keyboard.button.callback('✅ Очистить старые записи (30+ дней)', 'admin_clear_history_confirm_old'),
                Keyboard.button.callback('❌ Очистить всю историю', 'admin_clear_history_confirm_all')
            ],
            [
                Keyboard.button.callback('« Назад к удалению', 'admin_delete')
            ]
        ]);
        
        await ctx.reply(
            `**🗑️ ОЧИСТКА ИСТОРИИ ПОСЕЩЕНИЙ**\n\n` +
            `**📊 ТЕКУЩАЯ СИТУАЦИЯ:**\n` +
            `👥 Пользователей: ${totalUsers}\n` +
            `📝 Всего записей истории: ${totalHistoryEntries}\n` +
            `📅 Записей старше 30 дней: ${oldHistoryEntries}\n` +
            `📅 Свежих записей: ${totalHistoryEntries - oldHistoryEntries}\n\n` +
            
            `**🎯 ВАРИАНТЫ ОЧИСТКИ:**\n\n` +
            `**1. ОЧИСТИТЬ СТАРЫЕ ЗАПИСИ (30+ дней)**\n` +
            `└─ Удаляет только старые данные\n` +
            `└─ Сохраняет свежую историю\n` +
            `└─ Освобождает место в базе\n` +
            `└─ Рекомендуемый вариант\n\n` +
            
            `**2. ОЧИСТИТЬ ВСЮ ИСТОРИЮ**\n` +
            `└─ Удаляет ВСЕ записи истории\n` +
            `└─ Невозможно восстановить\n` +
            `└─ Использовать только в крайних случаях\n\n` +
            
            `**⚠️ ВНИМАНИЕ:**\n` +
            `После очистки статистика пользователей сохранится,\n` +
            `но детальная история посещений будет удалена.\n\n` +
            
            `Выберите вариант очистки:`,
            {
                format: 'markdown',
                attachments: [keyboard]
            }
        );
        
    } catch (error) {
        logToFile(`❌ Ошибка admin_clear_history: ${error.message}`);
    }
});

// 6.5 Подтверждение очистки старых записей
bot.action('admin_clear_history_confirm_old', async (ctx) => {
    try {
        const userId = getUserId(ctx);
        if (!isAdmin(userId)) return;
        
        await ctx.deleteMessage();
        
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        let deletedCount = 0;
        let keptCount = 0;
        
        // Очищаем старые записи у всех пользователей
        Object.values(userStats).forEach(user => {
            if (user.history && user.history.length > 0) {
                const oldHistory = user.history.filter(entry => new Date(entry.timestamp) < thirtyDaysAgo);
                const newHistory = user.history.filter(entry => new Date(entry.timestamp) >= thirtyDaysAgo);
                
                deletedCount += oldHistory.length;
                keptCount += newHistory.length;
                user.history = newHistory;
            }
        });
        
        // Сохраняем изменения
        saveUserStats();
        
        logToFile(`🗑️ Админ ${userId} очистил историю: удалено ${deletedCount} старых записей, сохранено ${keptCount}`);
        
        const keyboard = Keyboard.inlineKeyboard([
            [
                Keyboard.button.callback('« Назад к удалению', 'admin_delete')
            ]
        ]);
        
        await ctx.reply(
            `✅ **ИСТОРИЯ ОЧИЩЕНА!**\n\n` +
            `**🗑️ РЕЗУЛЬТАТЫ ОЧИСТКИ:**\n` +
            `📅 Удалены записи старше: ${thirtyDaysAgo.toLocaleDateString('ru-RU')}\n` +
            `❌ Удалено записей: ${deletedCount}\n` +
            `✅ Сохранено записей: ${keptCount}\n` +
            `📊 Всего пользователей: ${Object.keys(userStats).length}\n\n` +
            
            `**💡 СИСТЕМА ОПТИМИЗИРОВАНА:**\n` +
            `База данных очищена от старых записей.\n` +
            `Свежие данные сохранены для анализа.\n` +
            `Производительность системы улучшена.`,
            {
                format: 'markdown',
                attachments: [keyboard]
            }
        );
        
    } catch (error) {
        logToFile(`❌ Ошибка admin_clear_history_confirm_old: ${error.message}`);
    }
});

// 6.6 Подтверждение очистки всей истории
bot.action('admin_clear_history_confirm_all', async (ctx) => {
    try {
        const userId = getUserId(ctx);
        if (!isAdmin(userId)) return;
        
        await ctx.deleteMessage();
        
        let totalDeleted = 0;
        
        // Очищаем всю историю у всех пользователей
        Object.values(userStats).forEach(user => {
            if (user.history) {
                totalDeleted += user.history.length;
                user.history = [];
            }
        });
        
        // Сохраняем изменения
        saveUserStats();
        
        logToFile(`🗑️ Админ ${userId} очистил ВСЮ историю: удалено ${totalDeleted} записей`);
        
        const keyboard = Keyboard.inlineKeyboard([
            [
                Keyboard.button.callback('« Назад к удалению', 'admin_delete')
            ]
        ]);
        
        await ctx.reply(
            `⚠️ **ВСЯ ИСТОРИЯ УДАЛЕНА!**\n\n` +
            `**🗑️ РЕЗУЛЬТАТЫ ОЧИСТКИ:**\n` +
            `❌ Удалено записей: ${totalDeleted}\n` +
            `👥 Затронуто пользователей: ${Object.keys(userStats).length}\n` +
            `📅 Данные удалены полностью\n\n` +
            
            `**📝 ЧТО СОХРАНИЛОСЬ:**\n` +
            `✅ Статистика пользователей (посещения, пропуски)\n` +
            `✅ Абонементы пользователей\n` +
            `✅ Основные данные профилей\n\n` +
            
            `**❌ ЧТО УДАЛЕНО:**\n` +
            `📅 Детальная история посещений\n` +
            `🕐 Временные метки тренировок\n` +
            `📋 Подробные записи о каждом посещении\n\n` +
            
            `**💡 ВОССТАНОВЛЕНИЕ:**\n` +
            `Данные восстановить невозможно!\n` +
            `Новая история будет накапливаться заново.`,
            {
                format: 'markdown',
                attachments: [keyboard]
            }
        );
        
    } catch (error) {
        logToFile(`❌ Ошибка admin_clear_history_confirm_all: ${error.message}`);
    }
});

// ========== ЗАПУСК БОТА ==========
logToFile('🤖 Бот запускается...');

bot.start().then(() => {
    logToFile('✅ Бот успешно запущен!');
}).catch(err => {
    logToFile(`❌ Ошибка запуска бота: ${err.message}`);
    process.exit(1);
});
