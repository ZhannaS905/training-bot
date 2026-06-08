// bot.js - УПРОЩЕННАЯ ВЕРСИЯ: ТОЛЬКО ОПРОСЫ, ЗАПИСЬ И РАСПИСАНИЕ
require('dotenv').config();
const { Bot, Keyboard } = require('@maxhub/max-bot-api');

const bot = new Bot(process.env.BOT_TOKEN);

// Данные опросов
const dailyPolls = {};
const pollMessages = {};

// ========== РАСПИСАНИЕ ==========
function isTrainingDay(date) {
    const dayOfWeek = date.getDay();
    // ПН=1, СР=3, ПТ=5, СБ=6, ВС=0
    return dayOfWeek === 1 || dayOfWeek === 3 || dayOfWeek === 5 || dayOfWeek === 6 || dayOfWeek === 0;
}

function getTrainingTime(date) {
    const dayOfWeek = date.getDay();
    // ПН, СР, ПТ - 19:15
    if (dayOfWeek === 1 || dayOfWeek === 3 || dayOfWeek === 5) {
        return '19:15';
    }
    // СБ, ВС - 18:00
    return '18:00';
}

function getTrainingLocation() {
    return 'Яндекс Телемост';
}

function getTrainingLink() {
    return 'https://telemost.yandex.ru/j/35289250295816';
}

function getTrainingDuration() {
    return '60 минут';
}

function getNextTrainingDay(currentDate) {
    const days = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
    let nextDate = new Date(currentDate);
    
    nextDate.setDate(nextDate.getDate() + 1);
    
    while (!isTrainingDay(nextDate)) {
        nextDate.setDate(nextDate.getDate() + 1);
    }
    
    const dayName = days[nextDate.getDay()];
    const time = getTrainingTime(nextDate);
    return `${dayName}, ${nextDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}, начало в ${time}`;
}

// ========== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==========
function getUserName(ctx) {
    const user = ctx.user || ctx.from;
    if (!user) return 'Аноним';
    if (user.first_name) return user.first_name + (user.lastName ? ` ${user.lastName}` : '');
    if (user.username) return `@${user.username}`;
    return 'Аноним';
}

function getUserId(ctx) {
    const user = ctx.user || ctx.from;
    return user?.id || user?.user_id;
}

function getChatId(ctx) {
    return ctx.chat?.id || ctx.chatId || ctx.conversation?.chat_id || ctx.message?.chat?.id;
}

function getDayName(dayNumber) {
    const days = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
    return days[dayNumber] || 'Неизвестно';
}

// ========== СОЗДАНИЕ КЛАВИАТУРЫ ОПРОСА ==========
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
            Keyboard.button.callback('📅 Расписание', 'show_schedule'),
            Keyboard.button.callback('❓ Помощь', 'poll_help')
        ]
    ]);
}

// ========== СОЗДАНИЕ ТЕКСТА ОПРОСА ==========
function createPollText(dateKey, poll) {
    const yesCount = poll.yes?.length || 0;
    const noCount = poll.no?.length || 0;
    const maybeCount = poll.maybe?.length || 0;
    const total = yesCount + noCount + maybeCount;
    
    const date = new Date(dateKey);
    const formattedDate = date.toLocaleDateString('ru-RU', {
        weekday: 'long',
        day: 'numeric',
        month: 'long'
    });
    
    const trainingTime = getTrainingTime(date);
    const trainingLink = getTrainingLink();
    
    let text = `🏋️‍♀️ **${formattedDate}**\n`;
    text += `💪 **ТАБАТА тренировка**\n\n`;
    text += `⏰ Время: **${trainingTime}**\n`;
    text += `🎥 Платформа: **Яндекс Телемост**\n`;
    text += `⌛ Длительность: **${getTrainingDuration()}**\n\n`;
    
    if (total === 0) {
        text += `🤨 _Пока никто не записался!_\n\n`;
    } else {
        text += `👥 **Участников: ${total}**\n\n`;
        
        if (yesCount > 0) {
            text += `✅ **Идут (${yesCount}):**\n`;
            poll.yes.forEach((name, i) => {
                text += `${i + 1}. ${name}\n`;
            });
            text += `\n`;
        }
        
        if (maybeCount > 0) {
            text += `❓ **Возможно (${maybeCount}):**\n`;
            poll.maybe.forEach((name, i) => {
                text += `${i + 1}. ${name}\n`;
            });
            text += `\n`;
        }
        
        if (noCount > 0) {
            text += `❌ **Не идут (${noCount}):**\n`;
            poll.no.forEach((name, i) => {
                text += `${i + 1}. ${name}\n`;
            });
            text += `\n`;
        }
    }
    
    text += `🔗 [Ссылка для подключения](${trainingLink})\n\n`;
    text += `⏰ _Подключайтесь за 5 минут до старта!_\n\n`;
    text += `Используйте кнопки ниже:`;
    
    return text;
}

// ========== СОЗДАНИЕ/ОБНОВЛЕНИЕ ОПРОСА ==========
async function createNewPollMessage(chatId, pollText, pollKey) {
    try {
        const keyboard = createPollKeyboard();
        const message = await bot.api.sendMessageToChat(chatId, pollText, {
            format: 'markdown',
            attachments: [keyboard]
        });
        
        let messageId = message?.body?.mid || message?.mid;
        if (messageId) {
            pollMessages[pollKey] = messageId;
        }
        
        return messageId;
    } catch (sendError) {
        console.error(`❌ Не удалось создать сообщение: ${sendError.message}`);
        return null;
    }
}

async function updatePollInChat(chatId) {
    try {
        const today = new Date().toISOString().split('T')[0];
        const pollKey = `${chatId}_${today}`;
        const messageId = pollMessages[pollKey];

        if (!chatId) return;
        
        const poll = dailyPolls[today] || { yes: [], no: [], maybe: [] };
        const pollText = createPollText(today, poll);
        const keyboard = createPollKeyboard();

        if (messageId) {
            try {
                await bot.api.sendMessageToChat(chatId, pollText, {
                    format: 'markdown',
                    attachments: [keyboard],
                    forward_message_id: messageId
                });
            } catch (editError) {
                await createNewPollMessage(chatId, pollText, pollKey);
            }
        } else {
            await createNewPollMessage(chatId, pollText, pollKey);
        }
    } catch (error) {
        console.error(`❌ Ошибка обновления опроса: ${error.message}`);
    }
}

// ========== ОБРАБОТКА ОТВЕТОВ НА ОПРОС ==========
async function handlePollResponse(ctx, responseType) {
    try {
        const chatId = getChatId(ctx);
        const today = new Date().toISOString().split('T')[0];
        const userName = getUserName(ctx);
        
        if (!dailyPolls[today]) {
            dailyPolls[today] = { yes: [], no: [], maybe: [] };
        }
        
        const poll = dailyPolls[today];
        let alreadyInList = null;
        
        if (poll.yes.includes(userName)) alreadyInList = 'yes';
        else if (poll.no.includes(userName)) alreadyInList = 'no';
        else if (poll.maybe.includes(userName)) alreadyInList = 'maybe';
        
        if (alreadyInList === responseType) {
            await ctx.deleteMessage();
            return;
        }
        
        // Удаляем из предыдущего списка
        if (alreadyInList) {
            const index = poll[alreadyInList].indexOf(userName);
            if (index > -1) poll[alreadyInList].splice(index, 1);
        }
        
        // Добавляем в новый список
        poll[responseType].push(userName);
        
        // Обновляем опрос
        if (chatId) {
            await updatePollInChat(chatId);
        }
        
        // Отправляем подтверждение в ЛС
        const trainingLink = getTrainingLink();
        const trainingTime = getTrainingTime(new Date());
        
        const responseMessages = {
            yes: `✅ **Вы записались на тренировку!**\n\n` +
                 `⏰ Время: **${trainingTime}**\n` +
                 `🎥 Платформа: **Яндекс Телемост**\n` +
                 `🔗 [Ссылка для подключения](${trainingLink})\n\n` +
                 `⏰ _Подключайтесь за 5 минут до старта!_\n\n` +
                 `💪 Хорошей тренировки!`,
            no: `❌ **Вы отметили, что не придете.**\n\nУвидимся в следующий раз!`,
            maybe: `❓ **Вы отметились как "Возможно".**\n\n_Подтвердите участие позже!_`
        };
        
        const userId = getUserId(ctx);
        if (userId && responseMessages[responseType]) {
            try {
                await bot.api.sendMessageToUser(userId, responseMessages[responseType], { format: 'markdown' });
            } catch (lsError) {
                console.error(`⚠️ Не удалось отправить в ЛС: ${lsError.message}`);
            }
        }
        
        await ctx.deleteMessage();
    } catch (error) {
        console.error(`❌ Ошибка обработки ответа: ${error.message}`);
    }
}

// ========== ПОКАЗ РАСПИСАНИЯ (В ЛИЧНЫЕ СООБЩЕНИЯ) ==========
async function showSchedule(ctx) {
    try {
        const userId = getUserId(ctx);
        
        if (!userId) {
            try {
                await ctx.answerCallbackQuery({
                    text: '❌ Не удалось определить ваш профиль',
                    show_alert: true
                });
            } catch {}
            return;
        }
        
        const today = new Date();
        const dayOfWeek = today.getDay();
        const dayName = getDayName(dayOfWeek);
        const isTodayTraining = isTrainingDay(today);
        const trainingLink = getTrainingLink();
        
        let text = `**📅 РАСПИСАНИЕ ТРЕНИРОВОК**\n\n`;
        
        text += `**🗓️ РЕЖИМ РАБОТЫ:**\n`;
        text += `└─ Понедельник: **19:15**\n`;
        text += `└─ Среда: **19:15**\n`;
        text += `└─ Пятница: **19:15**\n`;
        text += `└─ Суббота: **18:00**\n`;
        text += `└─ Воскресенье: **18:00**\n`;
        text += `└─ Вторник, Четверг: выходной\n\n`;
        
        text += `**📅 СЕГОДНЯ (${dayName}):**\n`;
        if (isTodayTraining) {
            text += `└─ ✅ Тренировка в **${getTrainingTime(today)}**\n`;
            text += `└─ 🎥 Яндекс Телемост\n`;
            text += `└─ ⌛ Длительность: ${getTrainingDuration()}\n\n`;
        } else {
            text += `└─ ❌ Тренировок нет\n`;
            text += `└─ 🎯 Следующая: ${getNextTrainingDay(today)}\n\n`;
        }
        
        text += `**🎥 ПЛАТФОРМА:**\n`;
        text += `└─ Яндекс Телемост\n`;
        text += `└─ 🔗 [Ссылка для подключения](${trainingLink})\n`;
        text += `└─ ⏰ _Подключайтесь за 5 минут до старта_\n\n`;
        
        text += `**💪 ЧТО ВЗЯТЬ С СОБОЙ:**\n`;
        text += `└─ Удобная спортивная форма\n`;
        text += `└─ Бутылка воды\n`;
        text += `└─ Полотенце\n`;
        text += `└─ Хорошее настроение! 😊`;
        
        try {
            await bot.api.sendMessageToUser(userId, text, { format: 'markdown' });
            
            try {
                await ctx.answerCallbackQuery({
                    text: '📅 Расписание отправлено в личные сообщения!',
                    show_alert: false
                });
            } catch {}
            
        } catch (lsError) {
            console.error(`⚠️ Не удалось отправить расписание в ЛС: ${lsError.message}`);
            try {
                await ctx.answerCallbackQuery({
                    text: '❌ Не удалось отправить расписание. Напишите боту в личные сообщения.',
                    show_alert: true
                });
            } catch {}
        }
        
        try {
            await ctx.deleteMessage();
        } catch {}
        
    } catch (error) {
        console.error(`❌ Ошибка showSchedule: ${error.message}`);
    }
}

// ========== ПОМОЩЬ (В ЛИЧНЫЕ СООБЩЕНИЯ) ==========
async function showHelp(ctx) {
    try {
        const userId = getUserId(ctx);
        
        if (!userId) {
            try {
                await ctx.answerCallbackQuery({
                    text: '❌ Не удалось определить ваш профиль',
                    show_alert: true
                });
            } catch {}
            return;
        }
        
        const trainingLink = getTrainingLink();
        
        const text = `**❓ ПОМОЩЬ**\n\n` +
            `**📋 КАК ЗАПИСАТЬСЯ:**\n` +
            `1. Нажмите кнопку **✅ Приду** в опросе\n` +
            `2. Получите подтверждение в ЛС\n` +
            `3. Подключайтесь по ссылке за 5 минут\n\n` +
            
            `**🎯 КНОПКИ ОПРОСА:**\n` +
            `└─ ✅ Приду - запись на тренировку\n` +
            `└─ ❌ Не приду - отметка отсутствия\n` +
            `└─ ❓ Возможно - пока не решил\n` +
            `└─ ↩️ Отменить - удалить голос\n` +
            `└─ 📅 Расписание - посмотреть расписание\n` +
            `└─ ❓ Помощь - это сообщение\n\n` +
            
            `**📅 РАСПИСАНИЕ:**\n` +
            `└─ ПН, СР, ПТ: 19:15\n` +
            `└─ СБ, ВС: 18:00\n` +
            `└─ ВТ, ЧТ: выходной\n\n` +
            
            `**🎥 ПЛАТФОРМА:**\n` +
            `└─ Яндекс Телемост\n` +
            `└─ 🔗 [Ссылка для подключения](${trainingLink})\n\n` +
            
            `**📌 КОМАНДЫ БОТА:**\n` +
            `└─ /опрос - создать опрос (в группе)\n` +
            `└─ /расписание - показать расписание\n` +
            `└─ /помощь - это сообщение\n\n` +
            
            `**💪 ХОРОШЕЙ ТРЕНИРОВКИ!**`;
        
        try {
            await bot.api.sendMessageToUser(userId, text, { format: 'markdown' });
            
            try {
                await ctx.answerCallbackQuery({
                    text: '❓ Помощь отправлена в личные сообщения!',
                    show_alert: false
                });
            } catch {}
            
        } catch (lsError) {
            console.error(`⚠️ Не удалось отправить помощь в ЛС: ${lsError.message}`);
            try {
                await ctx.answerCallbackQuery({
                    text: '❌ Не удалось отправить помощь. Напишите боту в личные сообщения.',
                    show_alert: true
                });
            } catch {}
        }
        
        try {
            await ctx.deleteMessage();
        } catch {}
        
    } catch (error) {
        console.error(`❌ Ошибка showHelp: ${error.message}`);
    }
}

// ========== ОБРАБОТЧИКИ КНОПОК ==========
bot.action('poll_yes', async (ctx) => await handlePollResponse(ctx, 'yes'));
bot.action('poll_no', async (ctx) => await handlePollResponse(ctx, 'no'));
bot.action('poll_maybe', async (ctx) => await handlePollResponse(ctx, 'maybe'));
bot.action('poll_help', async (ctx) => await showHelp(ctx));
bot.action('show_schedule', async (ctx) => await showSchedule(ctx));

// ========== ОТМЕНА ГОЛОСА ==========
bot.action('poll_cancel', async (ctx) => {
    try {
        const chatId = getChatId(ctx);
        const today = new Date().toISOString().split('T')[0];
        const userName = getUserName(ctx);
        
        await ctx.deleteMessage();
        
        if (!dailyPolls[today]) return;
        
        const poll = dailyPolls[today];
        let removed = false;
        
        ['yes', 'no', 'maybe'].forEach(type => {
            const index = poll[type]?.indexOf(userName);
            if (index > -1) {
                poll[type].splice(index, 1);
                removed = true;
            }
        });
        
        if (removed && chatId) {
            await updatePollInChat(chatId);
            
            const userId = getUserId(ctx);
            if (userId) {
                try {
                    await bot.api.sendMessageToUser(userId, '✅ **Ваш голос отменен!**', { format: 'markdown' });
                } catch (lsError) {
                    console.error(`⚠️ Не удалось отправить в ЛС: ${lsError.message}`);
                }
            }
        }
    } catch (error) {
        console.error(`❌ Ошибка отмены: ${error.message}`);
    }
});

// ========== КОМАНДЫ ==========
bot.command('старт', async (ctx) => {
    await showHelp(ctx);
    await ctx.deleteMessage();
});

bot.command('опрос', async (ctx) => {
    try {
        const chatId = getChatId(ctx);
        
        if (!chatId) {
            await ctx.reply('⚠️ _Создавайте опрос в групповом чате!_\n\nДобавьте меня в группу и напишите /опрос', { format: 'markdown' });
            await ctx.deleteMessage();
            return;
        }
        
        const today = new Date().toISOString().split('T')[0];
        const pollKey = `${chatId}_${today}`;
        
        if (!dailyPolls[today]) {
            dailyPolls[today] = { yes: [], no: [], maybe: [] };
        }
        
        const poll = dailyPolls[today];
        const pollText = createPollText(today, poll);
        
        await createNewPollMessage(chatId, pollText, pollKey);
        await ctx.deleteMessage();
    } catch (error) {
        console.error(`❌ Ошибка: ${error.message}`);
        await ctx.reply('❌ Ошибка при создании опроса', { format: 'markdown' });
    }
});

bot.command('расписание', async (ctx) => {
    const fakeCtx = {
        ...ctx,
        answerCallbackQuery: async () => {},
        deleteMessage: async () => {}
    };
    await showSchedule(fakeCtx);
    await ctx.deleteMessage();
});

bot.command('помощь', async (ctx) => {
    const fakeCtx = {
        ...ctx,
        answerCallbackQuery: async () => {},
        deleteMessage: async () => {}
    };
    await showHelp(fakeCtx);
    await ctx.deleteMessage();
});

bot.command('приду', async (ctx) => await handlePollResponse(ctx, 'yes'));
bot.command('неприду', async (ctx) => await handlePollResponse(ctx, 'no'));
bot.command('возможно', async (ctx) => await handlePollResponse(ctx, 'maybe'));

bot.command('отменить', async (ctx) => {
    try {
        const chatId = getChatId(ctx);
        const today = new Date().toISOString().split('T')[0];
        const userName = getUserName(ctx);
        
        if (!dailyPolls[today]) {
            await ctx.deleteMessage();
            return;
        }
        
        const poll = dailyPolls[today];
        
        ['yes', 'no', 'maybe'].forEach(type => {
            const index = poll[type]?.indexOf(userName);
            if (index > -1) poll[type].splice(index, 1);
        });
        
        await ctx.deleteMessage();
        
        if (chatId) {
            await updatePollInChat(chatId);
            
            const userId = getUserId(ctx);
            if (userId) {
                try {
                    await bot.api.sendMessageToUser(userId, '✅ **Ваш голос отменен!**', { format: 'markdown' });
                } catch (lsError) {
                    console.error(`⚠️ Не удалось отправить в ЛС: ${lsError.message}`);
                }
            }
        }
    } catch (error) {
        console.error(`❌ Ошибка: ${error.message}`);
        await ctx.deleteMessage();
    }
});

// ========== ЗАПУСК БОТА ==========
console.log('🤖 Бот запускается...');

bot.start().then(() => {
    console.log('✅ Бот успешно запущен!');
    console.log('📅 Расписание: ПН,СР,ПТ 19:15 | СБ,ВС 18:00');
    console.log('🎥 Платформа: Яндекс Телемост');
    console.log('💬 Кнопки "Расписание" и "Помощь" отправляют ответы в ЛС');
}).catch(err => {
    console.error(`❌ Ошибка запуска: ${err.message}`);
    process.exit(1);
});
