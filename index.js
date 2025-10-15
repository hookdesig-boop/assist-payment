import { Telegraf, session, Markup } from 'telegraf';
import config from './config/config.js';

import { createNotionTask, processAndSendLinks, queryOrdersWithCustomFilters, testFilters } from './src/utils/notion.js';
import { setupBotCommands } from './src/components/notionNotifier.js';
import { CryptoBotService } from './src/utils/cryptoBot.js';
import { localization } from './src/utils/localization.js';

const bot = new Telegraf(config.TELEGRAM_BOT_TOKEN);
const cryptoBot = new CryptoBotService(bot);

// Добавляем сессии
bot.use(session());

// Переменная для хранения интервала проверки
let autoCheckInterval = null;

// Функция для запуска автоматической проверки
function startAutoChecking(minutes = 15) {
  if (autoCheckInterval) {
    clearInterval(autoCheckInterval);
  }

  const intervalMs = minutes * 60 * 1000;
  
  autoCheckInterval = setInterval(async () => {
    try {
      console.log(`🔄 Автоматическая проверка заказов... (${new Date().toLocaleString()})`);
      
      const result = await processAndSendLinks(bot);
      
      console.log(`📊 Результаты автоматической проверки: отправлено ${result.sent}, ошибок: ${result.errors}`);
      
      if (result.sent > 0) {
        console.log(`✅ Автоматически отправлено ${result.sent} ссылок`);
      }
      
    } catch (error) {
      console.error('❌ Ошибка при автоматической проверке заказов:', error);
    }
  }, intervalMs);

  console.log(`✅ Автоматическая проверка заказов запущена (каждые ${minutes} минут)`);
}

// Функция для остановки автоматической проверки
function stopAutoChecking() {
  if (autoCheckInterval) {
    clearInterval(autoCheckInterval);
    autoCheckInterval = null;
    console.log('🛑 Автоматическая проверка заказов остановлена');
  }
}

// Функция для тестовой отправки задачи в Notion
async function sendTestTaskToNotion(ctx) {
  try {
    await ctx.reply('🧪 Создаю тестовую задачу в Notion...');
    
    const testTaskData = {
      orderNumber: 565447854123654,
      userId: 465065447,
      adaptationsCount: 2,
      localizations: ['🇺🇸 EN (английский)', '🇷🇺 RU (русский)'],
      bank: 'Test Bank',
      winningAmount: 1000,
      currency: 'USD',
      additionalInfo: 'Тестовая задача создана через бота',
      paymentStatus: 'paid',
      invoiceId: `test_invoice_${Date.now()}`
    };
    
    const notionTask = await createNotionTask(testTaskData);
    
    if (notionTask && notionTask.id) {
      await ctx.reply(
        `✅ *Тестовая задача успешно создана!*\n\n` +
        `📋 Номер заказа: ${testTaskData.orderNumber}\n` +
        `🎬 Адаптаций: ${testTaskData.adaptationsCount}\n` +
        `🌍 Локализации: ${testTaskData.localizations.join(', ')}\n` +
        `🏦 Банк: ${testTaskData.bank}\n` +
        `💰 Сумма: ${testTaskData.winningAmount} ${testTaskData.currency}\n` +
        `📝 Доп. информация: ${testTaskData.additionalInfo}\n\n` +
        `🔗 ID в Notion: ${notionTask.id}`,
        { parse_mode: 'Markdown' }
      );
      
      console.log(`✅ Test task created in Notion: ${notionTask.id}`);
    } else {
      throw new Error('Не удалось создать задачу в Notion');
    }
    
  } catch (error) {
    console.error('❌ Error creating test task in Notion:', error);
    await ctx.reply(
      `❌ Ошибка при создании тестовой задачи:\n${error.message}`
    );
  }
}

// Функция для получения списка локализаций
const getLocalizations = localization();

// Функция для создания клавиатуры валют
function createCurrencyKeyboard() {
  const currencies = [
    { code: 'USD', name: '💵 Доллар США' },
    { code: 'EUR', name: '💶 Евро' },
    { code: 'UAH', name: '🇺🇦 Гривна' },
    { code: 'RUB', name: '🇷🇺 Рубль' }
  ];
  
  const buttons = currencies.map(currency => 
    Markup.button.callback(currency.name, `currency_${currency.code}`)
  );
  
  // Разбиваем на строки по 2 кнопки
  const rows = [];
  for (let i = 0; i < buttons.length; i += 2) {
    rows.push(buttons.slice(i, i + 2));
  }
  
  return Markup.inlineKeyboard(rows);
}

// Функция для создания клавиатуры локализаций
function createLocalizationsKeyboard(selectedIds = []) {
  const buttons = getLocalizations.map(loc => {
    const isSelected = selectedIds.includes(loc.id);
    const prefix = isSelected ? '✅ ' : '';
    return Markup.button.callback(
      `${prefix}${loc.name}`,
      `localization_${loc.id}`
    );
  });
  
  // Разбиваем на строки по 2 кнопки
  const rows = [];
  for (let i = 0; i < buttons.length; i += 2) {
    rows.push(buttons.slice(i, i + 2));
  }
  
  return rows;
}

// Функция для расчета стоимости заказа
function calculateOrderPrice(order) {
  const pricePerAdaptation = 15; // цена за адаптацию
  const adaptationsPrice = order.adaptationsCount * pricePerAdaptation;
  
  return {
    adaptationsPrice,
  };
}

// Функция для создания инвойса через CryptoBot
async function createInvoice(ctx) {
  try {
    const order = ctx.session.order;
    const userId = ctx.from.id;
    
    // Рассчитываем сумму
    const priceInfo = calculateOrderPrice(order);
    const amount = priceInfo.adaptationsPrice;
    
    // Создаем описание заказа
    const description = `Заказ #${order.orderNumber} - ${order.adaptationsCount} адаптаций`;
    
    console.log(`💰 Creating invoice for user ${userId}: order ${order.orderNumber}, amount: ${amount} USD`);
    
    // Создаем инвойс через CryptoBot
    const invoice = await cryptoBot.createInvoice(amount, description, order.orderNumber);
    
    // Сохраняем информацию об инвойсе в сессии
    ctx.session.invoiceId = invoice.invoice_id;
    ctx.session.invoiceAmount = amount;
    ctx.session.payUrl = invoice.pay_url;
    
    console.log(`✅ Invoice created: ${invoice.invoice_id}`);
    
    // Показываем пользователю информацию об оплате
    await ctx.reply(
      `💳 *Счет на оплату*\n\n` +
      `📋 Номер заказа: #${order.orderNumber}\n` +
      `🎬 Адаптаций: ${order.adaptationsCount}\n` +
      `💵 Сумма к оплате: ${amount} USDT\n\n` +
      `⏳ Счет действителен в течение 15 минут\n\n` +
      `Для оплаты перейдите по ссылке ниже:`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.url('💳 Оплатить криптовалютой', invoice.pay_url)],
          [Markup.button.callback('🔍 Проверить оплату', 'check_payment')],
          [Markup.button.callback('❌ Отменить', 'cancel_payment')]
        ])
      }
    );
    
  } catch (error) {
    console.error('❌ Error creating invoice:', error);
    await ctx.reply(
      '❌ Произошла ошибка при создании счета. Пожалуйста, попробуйте еще раз или обратитесь в поддержку.'
    );
  }
}

// ========== ТЕСТОВЫЕ КОМАНДЫ ==========

// Команда для тестовой отправки задачи в Notion
// bot.command('test_task', async (ctx) => {
//   console.log('🧪 Command test_task received');
//   await sendTestTaskToNotion(ctx);
// });

// Команда для тестирования отправки задачи после успешной оплаты
// bot.command('test_payment_task', async (ctx) => {
//   console.log('💳 Command test_payment_task received');
//   try {
//     await ctx.reply('💳 Тестирую создание задачи после оплаты...');
    
//     const testTaskData = {
//       orderNumber: 5555,
//       userId: 465065447,
//       adaptationsCount: 3,
//       localizations: ['🇺🇸 EN (английский)', '🇩🇪 DE (немецкий)'],
//       bank: 'Test Payment Bank',
//       winningAmount: 2000,
//       currency: 'USD',
//       additionalInfo: 'Тестовая задача после успешной оплаты',
//       paymentStatus: 'paid',
//       invoiceId: `paid_invoice_${Date.now()}`
//     };
    
//     const notionTask = await createNotionTask(testTaskData);
    
//     if (notionTask && notionTask.id) {
//       await ctx.reply(
//         `✅ *Тест оплаты успешен! Задача создана.*\n\n` +
//         `📋 Заказ: #${testTaskData.orderNumber}\n` +
//         `💰 Сумма: ${testTaskData.winningAmount} ${testTaskData.currency}\n` +
//         `🔗 ID в Notion: ${notionTask.id}`,
//         { parse_mode: 'Markdown' }
//       );
//     } else {
//       await ctx.reply('❌ Не удалось создать задачу в Notion');
//     }
//   } catch (error) {
//     console.error('Error in test_payment_task:', error);
//     await ctx.reply(`❌ Ошибка: ${error.message}`);
//   }
// });

// Команда для отправки ссылок (ручная проверка)
// bot.command('send_links', async (ctx) => {
//   console.log('🔄 Command send_links received');
//   try {
//     await ctx.reply('🔄 Отправляю ссылки пользователям...');
    
//     const result = await processAndSendLinks(bot);
    
//     await ctx.reply(
//       `📊 *Результаты отправки:*\n\n` +
//       `✅ Успешно отправлено: ${result.sent}\n` +
//       `❌ Ошибок: ${result.errors}`,
//       { parse_mode: 'Markdown' }
//     );
//   } catch (error) {
//     await ctx.reply(`❌ Ошибка: ${error.message}`);
//   }
// });

// Команда для тестирования фильтров
// bot.command('test_filters', async (ctx) => {
//   console.log('🧪 Command test_filters received');
//   try {
//     await ctx.reply('🧪 Тестирую фильтры...');
    
//     const result = await testFilters();
    
//     await ctx.reply(
//       `🧪 *Результаты теста:*\n\n` +
//       `📋 Завершенных заказов с ссылками: ${result.completedWithLinks}\n` +
//       `📊 Всего заказов в базе: ${result.totalOrders}`,
//       { parse_mode: 'Markdown' }
//     );
//   } catch (error) {
//     await ctx.reply(`❌ Ошибка: ${error.message}`);
//   }
// });

// Команда для запроса заказов с фильтрами
// bot.command('query_orders', async (ctx) => {
//   console.log('🔍 Command query_orders received');
//   try {
//     await ctx.reply('🔍 Запрашиваю заказы с фильтрами...');
    
//     const result = await queryOrdersWithCustomFilters();
    
//     await ctx.reply(
//       `📋 *Результаты запроса:*\n\n` +
//       `✅ Найдено заказов: ${result.length}\n` +
//       `📊 Примеры: ${result.slice(0, 3).map(order => `#${order.orderNumber}`).join(', ')}`,
//       { parse_mode: 'Markdown' }
//     );
//   } catch (error) {
//     await ctx.reply(`❌ Ошибка: ${error.message}`);
//   }
// });

// Команда для немедленной проверки заказов
// bot.command('check_now', async (ctx) => {
//   console.log('⚡ Command check_now received');
//   try {
//     await ctx.reply('🔍 Немедленная проверка заказов...');
    
//     const result = await processAndSendLinks(bot);
    
//     await ctx.reply(
//       `⚡ *Результаты немедленной проверки:*\n\n` +
//       `✅ Успешно отправлено: ${result.sent}\n` +
//       `❌ Ошибок: ${result.errors}`,
//       { parse_mode: 'Markdown' }
//     );
//   } catch (error) {
//     await ctx.reply(`❌ Ошибка: ${error.message}`);
//   }
// });

// Команда для создания тестового заказа с полным циклом
// bot.command('test_full_cycle', async (ctx) => {
//   console.log('🔄 Command test_full_cycle received');
//   try {
//     await ctx.reply('🔄 Запускаю тест полного цикла...');
    
//     // 1. Создаем тестовую задачу в Notion
//     await sendTestTaskToNotion(ctx);
    
//     // 2. Проверяем фильтры
//     await new Promise(resolve => setTimeout(resolve, 2000));
//     const filtersResult = await testFilters();
    
//     // 3. Проверяем отправку ссылок
//     await new Promise(resolve => setTimeout(resolve, 2000));
//     const linksResult = await processAndSendLinks(bot);
    
//     await ctx.reply(
//       `🎯 *Результаты теста полного цикла:*\n\n` +
//       `📋 Создана тестовая задача: ✅\n` +
//       `🔍 Завершенных заказов с ссылками: ${filtersResult.completedWithLinks}\n` +
//       `📤 Отправлено ссылок: ${linksResult.sent}\n` +
//       `❌ Ошибок: ${linksResult.errors}`,
//       { parse_mode: 'Markdown' }
//     );
    
//   } catch (error) {
//     await ctx.reply(`❌ Ошибка в тесте полного цикла: ${error.message}`);
//   }
// });

// Команда для управления автоматической проверкой
// bot.command('autocheck', async (ctx) => {
//   console.log('⚙️ Command autocheck received');
//   try {
//     const args = ctx.message.text.split(' ');
//     const action = args[1];
    
//     if (action === 'start') {
//       const minutes = parseInt(args[2]) || 15;
//       startAutoChecking(minutes);
//       await ctx.reply(`✅ Автоматическая проверка запущена (каждые ${minutes} минут)`);
//     } else if (action === 'stop') {
//       stopAutoChecking();
//       await ctx.reply('🛑 Автоматическая проверка остановлена');
//     } else if (action === 'status') {
//       const status = autoCheckInterval ? 'активна' : 'неактивна';
//       await ctx.reply(`📊 Статус автоматической проверки: ${status}`);
//     } else {
//       await ctx.reply(
//         '⚙️ *Управление автоматической проверкой:*\n\n' +
//         '`/autocheck start [минуты]` - запустить проверку\n' +
//         '`/autocheck stop` - остановить проверку\n' +
//         '`/autocheck status` - статус проверки\n\n' +
//         'По умолчанию проверка каждые 15 минут',
//         { parse_mode: 'Markdown' }
//       );
//     }
//   } catch (error) {
//     await ctx.reply(`❌ Ошибка: ${error.message}`);
//   }
// });

// Команда помощи по тестовым командам
// bot.command('test_help', async (ctx) => {
//   console.log('❓ Command test_help received');
//   await ctx.reply(
//     `🧪 *Доступные тестовые команды:*\n\n` +
//     `\`/test_task\` - создать тестовую задачу в Notion\n` +
//     `\`/test_payment_task\` - тест создания задачи после оплаты\n` +
//     `\`/send_links\` - отправить ссылки пользователям\n` +
//     `\`/test_filters\` - тестировать фильтры\n` +
//     `\`/query_orders\` - запросить заказы с фильтрами\n` +
//     `\`/check_now\` - немедленная проверка заказов\n` +
//     `\`/test_full_cycle\` - полный тест цикла\n` +
//     `\`/autocheck\` - управление автоматической проверкой\n` +
//     `\`/test_help\` - эта справка`,
//     { parse_mode: 'Markdown' }
//   );
// });

// ========== ОСНОВНЫЕ ОБРАБОТЧИКИ ==========

// Обработчик команды /start
bot.start(async (ctx) => {
  console.log('👤 User started:', ctx.from.id);
  
  // Инициализируем сессию
  ctx.session = {
    step: 'awaiting_order_number',
    order: {
      selectedLocalizations: []
    }
  };
  
  await ctx.reply(
    `👋 Добро пожаловать! Я помогу оформить заказ и оплатить его криптовалютой.\n\n` +
    `📋 Для начала введите номер вашего заказа:`
  );
});

// Обработка текстовых сообщений (для основного потока заказа)
bot.on('text', async (ctx) => {
  // Пропускаем команды
  if (ctx.message.text.startsWith('/')) {
    return;
  }

  if (ctx.session?.step === 'awaiting_order_number') {
    const orderNumber = ctx.message.text.trim();
    
    if (!/^\d+$/.test(orderNumber)) {
      await ctx.reply('❌ Пожалуйста, введите корректный номер заказа (только цифры):');
      return;
    }
    
    ctx.session.order.orderNumber = orderNumber;
    ctx.session.step = 'selecting_adaptations';
    
    console.log(`📝 User ${ctx.from.id} entered order number: ${orderNumber}`);
    
    await ctx.reply(
      `✅ Номер заказа: ${orderNumber}\n\n` +
      `🎬 Теперь выберите количество адаптаций:`,
      Markup.inlineKeyboard([
        [
          Markup.button.callback('1', 'adaptations_1'),
          Markup.button.callback('2', 'adaptations_2'),
          Markup.button.callback('3', 'adaptations_3')
        ],
        [
          Markup.button.callback('4', 'adaptations_4'),
          Markup.button.callback('5', 'adaptations_5'),
          Markup.button.callback('6', 'adaptations_6')
        ]
      ])
    );
    return;
  }
  
  // Обработка ввода банка
  if (ctx.session?.step === 'entering_bank') {
    const bank = ctx.message.text.trim();
    
    if (bank.length === 0) {
      await ctx.reply('❌ Пожалуйста, введите название банка:');
      return;
    }
    
    ctx.session.order.bank = bank;
    ctx.session.step = 'entering_winning_amount';
    
    console.log(`🏦 User ${ctx.from.id} entered bank: ${bank}`);
    
    await ctx.reply(
      `✅ Банк: ${bank}\n\n` +
      `💰 Теперь укажите сумму выигрыша (только цифры):`
    );
    return;
  }
  
  // Обработка ввода суммы выигрыша
  if (ctx.session?.step === 'entering_winning_amount') {
    const winningAmount = parseFloat(ctx.message.text.trim());
    
    if (isNaN(winningAmount) || winningAmount <= 0) {
      await ctx.reply('❌ Пожалуйста, введите корректную сумму выигрыша (только цифры, больше 0):');
      return;
    }
    
    ctx.session.order.winningAmount = winningAmount;
    ctx.session.step = 'selecting_currency';
    
    console.log(`💰 User ${ctx.from.id} entered winning amount: ${winningAmount}`);
    
    await ctx.reply(
      `✅ Сумма выигрыша: ${winningAmount}\n\n` +
      `💱 Теперь выберите валюту:`,
      createCurrencyKeyboard()
    );
    return;
  }
  
  // Обработка ввода дополнительной информации
  if (ctx.session?.step === 'entering_additional_info') {
    const additionalInfo = ctx.message.text.trim();
    
    ctx.session.order.additionalInfo = additionalInfo;
    
    console.log(`📝 User ${ctx.from.id} entered additional info: ${additionalInfo}`);
    
    // Создаем инвойс
    await createInvoice(ctx);
    return;
  }
});

// Остальные обработчики действий (actions) остаются без изменений


// Обработка выбора валюты
bot.action(/currency_(.+)/, async (ctx) => {
  const currencyCode = ctx.match[1];
  
  ctx.session.order.currency = currencyCode;
  ctx.session.step = 'entering_additional_info';
  
  console.log(`💱 User ${ctx.from.id} selected currency: ${currencyCode}`);
  
  await ctx.editMessageText(
    `✅ Валюта: ${currencyCode}\n\n` +
    `📝 Теперь укажите дополнительную информацию (или напишите "нет", если не требуется):`
  );
  
  await ctx.answerCbQuery();
});

// Обработка выбора количества адаптаций
bot.action(/adaptations_(\d+)/, async (ctx) => {
  const adaptationsCount = parseInt(ctx.match[1]);
  
  ctx.session.order.adaptationsCount = adaptationsCount;
  ctx.session.step = 'selecting_localizations';
  
  console.log(`🎬 User ${ctx.from.id} selected ${adaptationsCount} adaptations`);
  
  const keyboardRows = createLocalizationsKeyboard([]);
  
  if (adaptationsCount > 1) {
    keyboardRows.push([
      Markup.button.callback('✅ Завершить выбор', 'finish_localization')
    ]);
  }
  
  await ctx.editMessageText(
    `🎬 Количество адаптаций: ${adaptationsCount}\n\n` +
    `🌍 Выберите ${adaptationsCount === 1 ? 'одну локализацию' : 'локализации'}:\n` +
    `✅ Выбрано: 0 из ${adaptationsCount}`,
    Markup.inlineKeyboard(keyboardRows)
  );
  
  await ctx.answerCbQuery();
});

// Обработка выбора локализации
bot.action(/localization_(\d+)/, async (ctx) => {
  const localizationId = parseInt(ctx.match[1]);
  const order = ctx.session.order;
  
  const selectedLocalization = getLocalizations.find(loc => loc.id === localizationId);
  
  if (!selectedLocalization) {
    await ctx.answerCbQuery('❌ Локализация не найдена');
    return;
  }
  
  if (order.adaptationsCount === 1) {
    order.selectedLocalizations = [localizationId];
    
    await ctx.editMessageText(
      `✅ Вы выбрали: ${selectedLocalization.name}\n\n` +
      `🏦 Теперь укажите название банка:`
    );
    
    ctx.session.step = 'entering_bank';
    await ctx.answerCbQuery();
    return;
  }
  
  const index = order.selectedLocalizations.indexOf(localizationId);
  
  if (index > -1) {
    order.selectedLocalizations.splice(index, 1);
  } else {
    if (order.selectedLocalizations.length >= order.adaptationsCount) {
      await ctx.answerCbQuery(`❌ Можно выбрать максимум ${order.adaptationsCount} локализаций`);
      return;
    }
    order.selectedLocalizations.push(localizationId);
  }
  
  const selectedCount = order.selectedLocalizations.length;
  const keyboardRows = createLocalizationsKeyboard(order.selectedLocalizations);
  
  keyboardRows.push([
    Markup.button.callback(
      selectedCount > 0 ? '✅ Завершить выбор' : '⚠️ Выберите локализации', 
      'finish_localization'
    )
  ]);
  
  await ctx.editMessageText(
    `🎬 Количество адаптаций: ${order.adaptationsCount}\n\n` +
    `🌍 Выберите локализации:\n` +
    `✅ Выбрано: ${selectedCount} из ${order.adaptationsCount}`,
    Markup.inlineKeyboard(keyboardRows)
  );
  
  await ctx.answerCbQuery();
});

// Завершение выбора локализаций
bot.action('finish_localization', async (ctx) => {
  const order = ctx.session.order;
  
  if (order.selectedLocalizations.length === 0) {
    await ctx.answerCbQuery('❌ Выберите хотя бы одну локализацию');
    return;
  }
  
  const selectedNames = order.selectedLocalizations
    .map(id => getLocalizations.find(loc => loc.id === id)?.name)
    .filter(Boolean)
    .join(', ');
  
  ctx.session.step = 'entering_bank';
  
  await ctx.editMessageText(
    `🎉 Отлично! Вы выбрали ${order.adaptationsCount} адаптаций для локализаций:\n${selectedNames}\n\n` +
    `🏦 Теперь укажите название банка:`
  );
  
  await ctx.answerCbQuery();
});

// Проверка оплаты
bot.action('check_payment', async (ctx) => {
  await ctx.answerCbQuery('🔍 Проверяем оплату...');
  
  const invoiceId = ctx.session.invoiceId;
  
  if (!invoiceId) {
    await ctx.reply('❌ Информация о счете не найдена');
    return;
  }
  
  await ctx.editMessageText('🔍 Проверяем статус оплаты...');
  
  try {
    const paymentStatus = await cryptoBot.checkPaymentStatus(invoiceId);
    
    if (paymentStatus.status === 'paid') {
      await completePayment(ctx);
    } else {
      await ctx.editMessageText(
        `❌ Оплата еще не поступила.\n\n` +
        `Статус: ${paymentStatus.status}\n\n` +
        `Пожалуйста, перейдите по ссылке для оплаты и попробуйте проверить позже.`,
        Markup.inlineKeyboard([
          [Markup.button.url('💳 Оплатить', ctx.session.payUrl)],
          [Markup.button.callback('🔄 Проверить еще раз', 'check_payment')],
          [Markup.button.callback('❌ Отменить', 'cancel_payment')]
        ])
      );
    }
  } catch (error) {
    console.error('❌ Error checking payment:', error);
    await ctx.reply('❌ Произошла ошибка при проверке оплаты. Попробуйте позже.');
  }
});

// Отмена оплаты
bot.action('cancel_payment', async (ctx) => {
  await ctx.answerCbQuery('❌ Отменяем оплату...');
  
  // Очищаем сессию
  ctx.session.step = 'completed';
  ctx.session.order = {};
  ctx.session.invoiceId = null;
  ctx.session.payUrl = null;
  
  await ctx.editMessageText(
    '❌ Оплата отменена.\n\n' +
    'Если вы хотите начать заново, используйте команду /start'
  );
});

// Завершение оплаты и сохранение в Notion
async function completePayment(ctx) {
  try {
    const order = ctx.session.order;
    const userId = ctx.from.id;
    
    // Получаем названия локализаций
    const localizationNames = order.selectedLocalizations
      .map(id => getLocalizations.find(loc => loc.id === id)?.name)
      .filter(Boolean);
    
    // Сохраняем заказ в Notion
    await ctx.editMessageText('📤 Сохраняем заказ в системе...');
    
    const notionTask = await createNotionTask({
      orderNumber: order.orderNumber,
      userId: userId,
      adaptationsCount: order.adaptationsCount,
      localizations: localizationNames,
      bank: order.bank,
      winningAmount: order.winningAmount,
      currency: order.currency,
      additionalInfo: order.additionalInfo,
      paymentStatus: 'paid',
      invoiceId: ctx.session.invoiceId
    });
    
    // Успешное завершение
    await ctx.reply(
      `🎉 *Оплата подтверждена!*\n\n` +
      `✅ Заказ #${order.orderNumber} успешно создан и передан в работу.\n` +
      `💰 Сумма оплаты: ${ctx.session.invoiceAmount} USDT\n` +
      `📋 ID транзакции: ${ctx.session.invoiceId}\n\n` +
      `Мы уведомим вас когда адаптация будет готова.`,
      { parse_mode: 'Markdown' }
    );
    
    console.log(`✅ Order ${order.orderNumber} completed for user ${userId}`);
    
    // Очищаем сессию
    ctx.session.step = 'completed';
    ctx.session.order = {};
    ctx.session.invoiceId = null;
    ctx.session.payUrl = null;
    
  } catch (error) {
    console.error('❌ Error completing payment:', error);
    await ctx.reply(
      '❌ Произошла ошибка при сохранении заказа. Пожалуйста, обратитесь в поддержку.'
    );
  }
}

// Теперь запускаем setupBotCommands после регистрации всех команд
setupBotCommands(bot);
//  setInterval(() => {
//     processAndSendLinks(bot)
//   }, 1500);
// ========== ЗАПУСК БОТА ==========

// Запускаем бота
bot.launch().then(() => {
  console.log('✅ Bot started successfully');
  console.log('🤖 Bot is ready to receive commands');
  console.log('💳 CryptoBot integration: ACTIVE');
  console.log('🧪 Test commands available. Use /test_help for list');
  
  // Автоматически запускаем проверку при старте
 
  startAutoChecking(1);
  
}).catch((error) => {
  console.error('❌ Failed to start bot:', error);
});

// Graceful shutdown
process.once('SIGINT', () => {
  console.log('🛑 Stopping bot...');
  stopAutoChecking();
  bot.stop('SIGINT');
});

process.once('SIGTERM', () => {
  console.log('🛑 Stopping bot...');
  stopAutoChecking();
  bot.stop('SIGTERM');
});