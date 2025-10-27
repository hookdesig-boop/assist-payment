import { Telegraf, session, Markup } from "telegraf";
import config from "./config/config.js";
import { createNotionTask, processAndSendLinks } from "./src/utils/notion.js";
import { setupBotCommands } from "./src/components/notionNotifier.js";
import { CryptoBotService } from "./src/utils/cryptoBot.js";
import { localization } from "./src/utils/localization.js";
import { currency } from "./src/utils/currencys.js";
import EnhancedActivityManager from "./src/utils/active.js";

const bot = new Telegraf(config.TELEGRAM_BOT_TOKEN);
const cryptoBot = new CryptoBotService(bot);
const activityManager = new EnhancedActivityManager(bot);

// Добавляем сессии
bot.use(session());

// Хранилище для pending платежей
const pendingPayments = new Map();

// Переменные для хранения интервалов
global.paymentCheckInterval = null;
global.autoCheckInterval = null;

// ========== УТИЛИТЫ ДЛЯ ОТЛАДКИ ==========

function debugSession(ctx) {
  console.log('🔍 DEBUG SESSION:', {
    userId: ctx.from?.id,
    session: ctx.session,
    invoiceId: ctx.session?.invoiceId,
    pendingPaymentsSize: pendingPayments.size,
    pendingPayments: Array.from(pendingPayments.entries()).map(([id, data]) => ({
      invoiceId: id,
      userId: data.userId,
      orderNumber: data.order?.orderNumber
    }))
  });
}

// ========== СИСТЕМА ПРОВЕРКИ ПЛАТЕЖЕЙ ==========

function savePendingPayment(invoiceId, paymentData) {
  pendingPayments.set(invoiceId, {
    ...paymentData,
    createdAt: new Date(),
    checkedAt: null,
    attempts: 0,
  });
  console.log(`💾 Сохранен pending платеж: ${invoiceId}`);
}

function getPendingPayment(invoiceId) {
  return pendingPayments.get(invoiceId);
}

function removePendingPayment(invoiceId) {
  pendingPayments.delete(invoiceId);
  console.log(`🗑️ Удален pending платеж: ${invoiceId}`);
}

async function checkPendingPayments() {
  try {
    if (pendingPayments.size === 0) return;

    console.log(`🔍 Проверка ${pendingPayments.size} pending платежей...`);

    for (const [invoiceId, paymentData] of pendingPayments.entries()) {
      try {
        if (
          paymentData.checkedAt &&
          Date.now() - paymentData.checkedAt < 30000
        ) {
          continue;
        }

        paymentData.attempts += 1;
        paymentData.checkedAt = Date.now();

        const paymentStatus = await cryptoBot.checkPaymentStatus(invoiceId);

        if (paymentStatus.status === "paid") {
          console.log(`✅ Найден оплаченный инвойс: ${invoiceId}`);
          await processSuccessfulPayment(invoiceId, paymentData);
        } else if (
          paymentStatus.status === "expired" ||
          paymentData.attempts > 12
        ) {
          removePendingPayment(invoiceId);
        }
      } catch (error) {
        console.error(`❌ Ошибка проверки инвойса ${invoiceId}:`, error);
      }
    }
  } catch (error) {
    console.error("❌ Критическая ошибка в checkPendingPayments:", error);
  }
}

async function processSuccessfulPayment(invoiceId, paymentData, retryCount = 0) {
  const maxRetries = 3;
  
  try {
    const { order, invoiceAmount, userId, chatId } = paymentData;

    console.log(`📤 Создание задачи в Notion для инвойса ${invoiceId}, попытка ${retryCount + 1}`);

    const notionTask = await createNotionTask({
      orderNumber: order.orderNumber,
      userId: userId,
      adaptationsCount: order.adaptationsCount,
      adaptations: order.adaptations,
      bank: order.bank,
      winningAmount: order.winningAmount,
      additionalInfo: order.additionalInfo,
      paymentStatus: "paid",
      invoiceId: invoiceId,
    });

    if (notionTask && notionTask.id) {
      await bot.telegram.sendMessage(
        chatId,
        `🎉 *Оплата подтверждена!*\n\n` +
          `✅ Заказ #${order.orderNumber} успешно создан.\n` +
          `💰 Сумма оплаты: ${invoiceAmount} USDT\n` +
          `📋 ID транзакции: ${invoiceId}\n` +
          `🔗 ID в Notion: ${notionTask.id}\n\n` +
          `Мы уведомим вас когда адаптация будет готова.`,
        { parse_mode: "Markdown" }
      );

      removePendingPayment(invoiceId);
      console.log(`✅ Successfully processed payment ${invoiceId}`);
    } else {
      throw new Error("Не удалось создать задачу в Notion");
    }

  } catch (error) {
    console.error(`❌ Ошибка обработки платежа ${invoiceId}:`, error);
    
    if (retryCount < maxRetries) {
      console.log(`🔄 Retrying payment processing for ${invoiceId}, attempt ${retryCount + 1}`);
      // Ждем перед повторной попыткой
      await new Promise(resolve => setTimeout(resolve, 2000 * (retryCount + 1)));
      return processSuccessfulPayment(invoiceId, paymentData, retryCount + 1);
    } else {
      // После всех неудачных попыток
      console.error(`🚨 Failed to process payment ${invoiceId} after ${maxRetries} attempts`);
      
      try {
        await bot.telegram.sendMessage(
          paymentData.chatId,
          `❌ *Внимание!*\n\n` +
            `Оплата по счету #${invoiceId} получена, но возникла ошибка при создании заказа.\n\n` +
            `⚠️ Пожалуйста, свяжитесь с поддержкой и предоставьте:\n` +
            `• ID транзакции: ${invoiceId}\n` +
            `• Номер заказа: ${paymentData.order.orderNumber}\n\n` +
            `Мы решим проблему вручную в ближайшее время.`,
          { parse_mode: "Markdown" }
        );
      } catch (notificationError) {
        console.error('❌ Failed to send error notification:', notificationError);
      }
    }
  }
}

async function handleOrphanedPayment(ctx, invoiceId, paymentStatus) {
  try {
    console.log(`🔄 Handling orphaned payment: ${invoiceId}`);
    
    // Пытаемся восстановить данные заказа из истории или создать новую задачу
    await ctx.editMessageText(
      "✅ Оплата подтверждена!\n\n" +
      "🔍 Создаем задачу в системе...\n\n" +
      "Пожалуйста, подождите..."
    );

    // Здесь можно добавить логику восстановления данных заказа
    // Например, из логов или базы данных
    
    // Временное решение - просим пользователя ввести данные заново
    await ctx.reply(
      "🎉 Оплата подтверждена!\n\n" +
      "К сожалению, данные заказа были утеряны.\n\n" +
      "Пожалуйста, введите номер вашего заказа для создания задачи:"
    );
    
    // Устанавливаем специальный шаг для восстановления
    ctx.session.step = "recovering_order_after_payment";
    ctx.session.paidInvoiceId = invoiceId;
    
  } catch (error) {
    console.error(`❌ Error handling orphaned payment ${invoiceId}:`, error);
    
    await ctx.reply(
      "✅ Оплата подтверждена, но возникла ошибка при создании заказа.\n\n" +
      "Пожалуйста, свяжитесь с поддержкой и предоставьте этот ID:\n" +
      `📋 Invoice ID: ${invoiceId}\n\n` +
      "Мы решим проблему в ближайшее время."
    );
  }
}

function startPaymentChecking() {
  if (global.paymentCheckInterval) {
    clearInterval(global.paymentCheckInterval);
  }

  global.paymentCheckInterval = setInterval(() => {
    activityManager.recordActivity();
    checkPendingPayments();
  }, 10000);

  console.log("✅ Автоматическая проверка платежей запущена");
}

function stopPaymentChecking() {
  if (global.paymentCheckInterval) {
    clearInterval(global.paymentCheckInterval);
    global.paymentCheckInterval = null;
    console.log("🛑 Автоматическая проверка платежей остановлена");
  }
}

// ========== ОСНОВНЫЕ ФУНКЦИИ ==========

function startAutoChecking(minutes = 15) {
  if (global.autoCheckInterval) {
    clearInterval(global.autoCheckInterval);
  }

  const intervalMs = minutes * 60 * 1000;

  global.autoCheckInterval = setInterval(async () => {
    activityManager.recordActivity();
    try {
      console.log(`🔄 Автоматическая проверка заказов...`);
      const result = await processAndSendLinks(bot);
      console.log(
        `📊 Результаты: отправлено ${result.sent}, ошибок: ${result.errors}`
      );
    } catch (error) {
      console.error("❌ Ошибка при автоматической проверке заказов:", error);
    }
  }, intervalMs);

  console.log(`✅ Автоматическая проверка заказов запущена`);
}

function stopAutoChecking() {
  if (global.autoCheckInterval) {
    clearInterval(global.autoCheckInterval);
    global.autoCheckInterval = null;
    console.log("🛑 Автоматическая проверка заказов остановлена");
  }
}

// Делаем функции глобальными
global.stopPaymentChecking = stopPaymentChecking;
global.startPaymentChecking = startPaymentChecking;
global.stopAutoChecking = stopAutoChecking;
global.startAutoChecking = startAutoChecking;

// Функция для получения списка локализаций
const getLocalizations = localization();

function createCurrencyKeyboard() {
  const currencies = currency;
  const buttons = currencies.map((currency) =>
    Markup.button.callback(currency.name, `currency_${currency.code}`)
  );

  const rows = [];
  for (let i = 0; i < buttons.length; i += 2) {
    rows.push(buttons.slice(i, i + 2));
  }

  return Markup.inlineKeyboard(rows);
}

function createLocalizationsKeyboard() {
  const buttons = getLocalizations.map((loc) =>
    Markup.button.callback(loc.name, `localization_${loc.id}`)
  );

  const rows = [];
  for (let i = 0; i < buttons.length; i += 2) {
    rows.push(buttons.slice(i, i + 2));
  }

  return rows;
}

function calculateOrderPrice(order) {
  const pricePerAdaptation = config.PRICES.ADAPTATION;
  const adaptationsPrice = order.adaptationsCount * pricePerAdaptation;
  return { adaptationsPrice };
}

async function createInvoice(ctx) {
  try {
    const order = ctx.session.order;
    const userId = ctx.from.id;
    const chatId = ctx.chat.id;

    const priceInfo = calculateOrderPrice(order);
    const amount = priceInfo.adaptationsPrice * 1.03;
    const description = `Заказ #${order.orderNumber} - ${order.adaptationsCount} адаптаций`;

    console.log(
      `💰 Creating invoice for order ${order.orderNumber}, amount: ${amount} USD`
    );

    const invoice = await cryptoBot.createInvoice(
      amount,
      description,
      order.orderNumber
    );

    ctx.session.invoiceId = invoice.invoice_id;
    ctx.session.invoiceAmount = amount;
    ctx.session.payUrl = invoice.pay_url;

    console.log(`✅ Invoice created: ${invoice.invoice_id}`);

    savePendingPayment(invoice.invoice_id, {
      order: { ...order },
      invoiceAmount: amount,
      payUrl: invoice.pay_url,
      userId: userId,
      chatId: chatId,
    });

    await ctx.reply(
      `💳 *Счет на оплату*\n\n` +
        `📋 Номер заказа: #${order.orderNumber}\n` +
        `🎬 Адаптаций: ${order.adaptationsCount}\n` +
        `💵 Сумма к оплате: ${amount} USDT\n\n` +
        `⏳ Счет действителен в течение 15 минут\n` +
        `🤖 Статус оплаты проверяется автоматически\n\n` +
        `Для оплаты перейдите по ссылке ниже:`,
      {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard([
          [Markup.button.url("💳 Оплатить криптовалютой", invoice.pay_url)],
          [Markup.button.callback("🔍 Проверить оплату", "check_payment")],
          [Markup.button.callback("❌ Отменить", "cancel_payment")],
        ]),
      }
    );
  } catch (error) {
    console.error("❌ Error creating invoice:", error);
    await ctx.reply(
      "❌ Произошла ошибка при создании счета. Пожалуйста, попробуйте еще раз."
    );
  }
}

// ========== ОСНОВНЫЕ ОБРАБОТЧИКИ ==========

// Мидлварь для отслеживания активности
bot.use((ctx, next) => {
  activityManager.recordActivity();
  return next();
});

// Обработчик команды /start
bot.start(async (ctx) => {
  activityManager.recordActivity();
  console.log("👤 User started:", ctx.from.id);

  // Инициализируем сессию
  ctx.session = {
    step: "awaiting_order_number",
    order: {
      adaptations: [],
    },
  };

  await ctx.reply(
    `👋 Добро пожаловать! Я помогу оформить заказ и оплатить его криптовалютой.\n\n` +
      `📋 Для начала введите номер вашего заказа:\n\n`
  );
});

// Обработка текстовых сообщений
bot.on("text", async (ctx) => {
  activityManager.recordActivity();

  // Пропускаем команды
  if (ctx.message.text.startsWith("/")) {
    return;
  }

  console.log("📝 Received text:", ctx.message.text);
  console.log("🔍 Current step:", ctx.session?.step);

  if (ctx.session?.step === "awaiting_order_number") {
    const orderNumber = ctx.message.text.trim();

    if (!/^\d+$/.test(orderNumber)) {
      await ctx.reply(
        "❌ Пожалуйста, введите корректный номер заказа (только цифры):"
      );
      return;
    }

    ctx.session.order.orderNumber = orderNumber;
    ctx.session.step = "selecting_adaptations";

    console.log(`✅ User ${ctx.from.id} entered order number: ${orderNumber}`);

    await ctx.reply(
      `✅ Номер заказа: ${orderNumber}\n\n` +
        `🎬 Теперь выберите количество адаптаций:`,
      Markup.inlineKeyboard([
        [
          Markup.button.callback("1", "adaptations_1"),
          Markup.button.callback("2", "adaptations_2"),
          Markup.button.callback("3", "adaptations_3"),
        ],
        [
          Markup.button.callback("4", "adaptations_4"),
          Markup.button.callback("5", "adaptations_5"),
          Markup.button.callback("6", "adaptations_6"),
        ],
      ])
    );
    return;
  }

  if (ctx.session?.step === "entering_bank") {
    const bank = ctx.message.text.trim();

    if (bank.length === 0) {
      await ctx.reply("❌ Пожалуйста, введите название банка:");
      return;
    }

    ctx.session.order.bank = bank;
    ctx.session.step = "entering_winning_amount";

    console.log(`🏦 User entered bank: ${bank}`);

    await ctx.reply(
      `✅ Банк: ${bank}\n\n` +
        `💰 Теперь укажите сумму выигрыша (только цифры):`
    );
    return;
  }

  if (ctx.session?.step === "entering_winning_amount") {
    const winningAmount = parseFloat(ctx.message.text.trim());

    if (isNaN(winningAmount) || winningAmount <= 0) {
      await ctx.reply(
        "❌ Пожалуйста, введите корректную сумму выигрыша (только цифры, больше 0):"
      );
      return;
    }

    ctx.session.order.winningAmount = winningAmount;
    ctx.session.step = "entering_additional_info";

    console.log(`💰 User entered winning amount: ${winningAmount}`);

    await ctx.reply(
      `✅ Сумма выигрыша: ${winningAmount}\n\n` +
        `📝 Теперь укажите дополнительную информацию (или напишите "нет", если не требуется):`
    );
    return;
  }

  if (ctx.session?.step === "entering_additional_info") {
    const additionalInfo = ctx.message.text.trim();
    ctx.session.order.additionalInfo = additionalInfo;

    console.log(`📝 User entered additional info: ${additionalInfo}`);

    await createInvoice(ctx);
    return;
  }
});

// Обработчики callback запросов
bot.action(/adaptations_(\d+)/, async (ctx) => {
  const adaptationsCount = parseInt(ctx.match[1]);

  ctx.session.order.adaptationsCount = adaptationsCount;
  ctx.session.order.adaptations = [];
  ctx.session.currentAdaptation = 1;
  ctx.session.step = "selecting_localization_for_adaptation";

  console.log(`🎬 User selected ${adaptationsCount} adaptations`);

  await ctx.editMessageText(
    `🎬 Количество адаптаций: ${adaptationsCount}\n\n` +
      `🌍 Выберите геолокацию для адаптации #1:`,
    Markup.inlineKeyboard(createLocalizationsKeyboard())
  );

  await ctx.answerCbQuery();
});

bot.action(/localization_(\d+)/, async (ctx) => {
  const localizationId = parseInt(ctx.match[1]);
  const currentAdaptation = ctx.session.currentAdaptation;
  const adaptationsCount = ctx.session.order.adaptationsCount;

  const selectedLocalization = getLocalizations.find(
    (loc) => loc.id === localizationId
  );

  if (!selectedLocalization) {
    await ctx.answerCbQuery("❌ Локализация не найдена");
    return;
  }

  ctx.session.order.adaptations[currentAdaptation - 1] = {
    localization: selectedLocalization.name,
    localizationId: localizationId,
  };

  console.log(`🌍 User selected localization: ${selectedLocalization.name}`);

  ctx.session.step = "selecting_currency_for_adaptation";

  await ctx.editMessageText(
    `✅ Адаптация #${currentAdaptation}: ${selectedLocalization.name}\n\n` +
      `💱 Теперь выберите валюту для адаптации #${currentAdaptation}:`,
    createCurrencyKeyboard()
  );

  await ctx.answerCbQuery();
});

bot.action(/currency_(.+)/, async (ctx) => {
  const currencyCode = ctx.match[1];
  const currentAdaptation = ctx.session.currentAdaptation;
  const adaptationsCount = ctx.session.order.adaptationsCount;

  if (ctx.session.order.adaptations[currentAdaptation - 1]) {
    ctx.session.order.adaptations[currentAdaptation - 1].currency =
      currencyCode;
  }

  console.log(`💱 User selected currency: ${currencyCode}`);

  if (currentAdaptation < adaptationsCount) {
    ctx.session.currentAdaptation = currentAdaptation + 1;
    ctx.session.step = "selecting_localization_for_adaptation";

    await ctx.editMessageText(
      `✅ Адаптация #${currentAdaptation} завершена!\n\n` +
        `🌍 Теперь выберите геолокацию для адаптации #${
          currentAdaptation + 1
        }:`,
      Markup.inlineKeyboard(createLocalizationsKeyboard())
    );
  } else {
    ctx.session.step = "entering_bank";

    const adaptationsSummary = ctx.session.order.adaptations
      .map(
        (adapt, index) =>
          `Адаптация #${index + 1}: ${adapt.localization} (${adapt.currency})`
      )
      .join("\n");

    await ctx.editMessageText(
      `🎉 Все адаптации настроены!\n\n` +
        `${adaptationsSummary}\n\n` +
        `🏦 Теперь укажите название банка:`
    );
  }

  await ctx.answerCbQuery();
});

// УЛУЧШЕННЫЙ ОБРАБОТЧИК ПРОВЕРКИ ОПЛАТЫ
bot.action("check_payment", async (ctx) => {
  debugSession(ctx); // Отладочная информация
  
  await ctx.answerCbQuery("🔍 Проверяем оплату...");

  try {
    // Пытаемся получить invoiceId из разных источников
    let invoiceId = ctx.session?.invoiceId;
    
    // Если в сессии нет, ищем в pendingPayments по userId
    if (!invoiceId) {
      console.log(`🔍 InvoiceId not found in session, searching in pending payments for user: ${ctx.from.id}`);
      
      for (const [invId, paymentData] of pendingPayments.entries()) {
        if (paymentData.userId === ctx.from.id) {
          invoiceId = invId;
          console.log(`✅ Found invoiceId in pending payments: ${invoiceId}`);
          
          // Обновляем сессию
          if (ctx.session) {
            ctx.session.invoiceId = invoiceId;
            ctx.session.payUrl = paymentData.payUrl;
          }
          break;
        }
      }
    }

    if (!invoiceId) {
      await ctx.editMessageText(
        "❌ Информация о счете не найдена.\n\n" +
        "Возможные причины:\n" +
        "• Сессия была сброшена\n" +
        "• Счет был отменен или просрочен\n\n" +
        "Пожалуйста, начните заново с команды /start"
      );
      return;
    }

    await ctx.editMessageText("🔍 Проверяем статус оплаты...");

    const paymentStatus = await cryptoBot.checkPaymentStatus(invoiceId);
    console.log(`📊 Payment status for ${invoiceId}:`, paymentStatus);

    if (paymentStatus.status === "paid") {
      console.log(`✅ Payment confirmed for invoice: ${invoiceId}`);
      
      const pendingData = getPendingPayment(invoiceId);
      if (pendingData) {
        await processSuccessfulPayment(invoiceId, pendingData);
      } else {
        // Если платеж есть в CryptoBot, но нет в pendingPayments
        await handleOrphanedPayment(ctx, invoiceId, paymentStatus);
      }
    } else {
      await ctx.editMessageText(
        `❌ Оплата еще не поступила.\n\n` +
        `Статус: ${paymentStatus.status}\n` +
        `💡 Совет: Иногда платежи обрабатываются до 15 минут\n\n` +
        `Пожалуйста, перейдите по ссылке для оплаты или проверьте позже.`,
        Markup.inlineKeyboard([
          [Markup.button.url("💳 Оплатить", ctx.session.payUrl || "https://t.me/your_bot")],
          [Markup.button.callback("🔄 Проверить еще раз", "check_payment")],
          [Markup.button.callback("🆘 Помощь", "payment_help")],
        ])
      );
    }

  } catch (error) {
    console.error("❌ Error checking payment:", error);
    
    await ctx.editMessageText(
      "❌ Произошла ошибка при проверке оплаты.\n\n" +
      "Пожалуйста, попробуйте еще раз через несколько минут.\n" +
      "Если проблема повторяется, обратитесь в поддержку.",
      Markup.inlineKeyboard([
        [Markup.button.callback("🔄 Попробовать снова", "check_payment")],
        [Markup.button.callback("🆘 Помощь", "payment_help")],
      ])
    );
  }
});

// ОБРАБОТЧИК ПОМОЩИ ПО ПЛАТЕЖАМ
bot.action("payment_help", async (ctx) => {
  await ctx.answerCbQuery("📞 Помощь по оплате");
  
  await ctx.editMessageText(
    `🆘 *Помощь по оплате*\n\n` +
    `*Если оплата прошла, но бот не видит:*\n` +
    `• Платежи могут обрабатываться до 15 минут\n` +
    `• Проверьте историю транзакций в вашем кошельке\n` +
    `• Убедитесь, что платеж отправлен на правильный адрес\n\n` +
    `*Если возникли проблемы:*\n` +
    `1. Попробуйте проверить еще раз через 5 минут\n` +
    `2. Сохраните ID транзакции: ${ctx.session?.invoiceId || 'не найден'}\n` +
    `3. Свяжитесь с поддержкой\n\n` +
    `*Техническая поддержка:* @your_support_username`,
    { 
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([
        [Markup.button.callback("🔄 Проверить оплату", "check_payment")],
        [Markup.button.callback("🏠 В главное меню", "main_menu")],
      ])
    }
  );
});

// ГЛАВНОЕ МЕНЮ
bot.action("main_menu", async (ctx) => {
  await ctx.answerCbQuery("🏠 Главное меню");
  
  ctx.session = {
    step: "main_menu",
    welcomeSent: true,
    hasInteracted: true
  };
  
  await ctx.editMessageText(
    "🏠 *Главное меню*\n\n" +
    "Выберите действие:",
    {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([
        [Markup.button.callback("🚀 Новый заказ", "new_order")],
        [Markup.button.callback("📋 Мои заказы", "my_orders")],
        [Markup.button.callback("ℹ️ Помощь", "help")],
      ])
    }
  );
});

// НОВЫЙ ЗАКАЗ ИЗ ГЛАВНОГО МЕНЮ
bot.action("new_order", async (ctx) => {
  await ctx.answerCbQuery("🚀 Новый заказ");
  
  ctx.session = {
    step: "awaiting_order_number",
    order: {
      adaptations: []
    }
  };
  
  await ctx.editMessageText(
    "🚀 *Новый заказ*\n\n" +
    "Введите номер вашего заказа:",
    { parse_mode: "Markdown" }
  );
});

// ЗАГЛУШКИ ДЛЯ ДОПОЛНИТЕЛЬНЫХ КНОПОК
bot.action("my_orders", async (ctx) => {
  await ctx.answerCbQuery("📋 Загрузка заказов...");
  await ctx.editMessageText(
    "📋 *Мои заказы*\n\n" +
    "Функция находится в разработке.\n\n" +
    "Скоро здесь появится история ваших заказов.",
    {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([
        [Markup.button.callback("🏠 В главное меню", "main_menu")],
      ])
    }
  );
});

bot.action("help", async (ctx) => {
  await ctx.answerCbQuery("ℹ️ Помощь");
  await ctx.editMessageText(
    `ℹ️ *Помощь по боту*\n\n` +
    `*Основные команды:*\n` +
    `/start - Начать оформление заказа\n` +
    `/help - Показать эту справку\n\n` +
    `*Тестовые команды:*\n` +
    `/test_notion - Проверка интеграции с Notion\n` +
    `/test_simple - Простой тест\n` +
    `/test_notion_safe - Безопасный тест\n\n` +
    `*Процесс заказа:*\n` +
    `1. Введите номер заказа\n` +
    `2. Выберите количество адаптаций\n` +
    `3. Укажите локализации и валюты\n` +
    `4. Введите данные банка и сумму\n` +
    `5. Оплатите счет криптовалютой\n\n` +
    `💡 *Бот работает 24/7 и автоматически проверяет платежи!*`,
    {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([
        [Markup.button.callback("🏠 В главное меню", "main_menu")],
      ])
    }
  );
});

bot.action("cancel_payment", async (ctx) => {
  await ctx.answerCbQuery("❌ Отменяем оплату...");

  const invoiceId = ctx.session.invoiceId;
  if (invoiceId) {
    removePendingPayment(invoiceId);
  }

  ctx.session.step = "completed";
  ctx.session.order = {};
  ctx.session.invoiceId = null;
  ctx.session.payUrl = null;
  ctx.session.currentAdaptation = null;

  await ctx.editMessageText(
    "❌ Оплата отменена.\n\n" +
      "Если вы хотите начать заново, используйте команду /start"
  );
});

setInterval(() => {
  processAndSendLinks(bot);
}, 1 * 60 * 1000);

// ========== ЗАПУСК БОТА ==========

let phantomActivity;

async function startBot() {
  try {
    console.log("🚀 Starting bot with enhanced features...");

    // Запускаем бота
    await bot.launch();
    console.log("✅ Bot started successfully");
    console.log("🤖 Bot is ready to receive commands");

    // Запускаем проверки
    startAutoChecking(15);
    startPaymentChecking();

    // Запускаем улучшенный менеджер активности
    phantomActivity = activityManager.startEnhancedPhantomActivity();

    console.log(`⏳ Мониторинг ${pendingPayments.size} pending платежей`);
    console.log("👻 Enhanced phantom activity manager: ACTIVE");
    console.log("👋 Welcome messages: ENABLED");

    // Отправляем сообщение о успешном запуске (опционально)
    try {
      await bot.telegram.sendMessage(
        config.ADMIN_CHAT_ID, // Добавьте ID админа в конфиг
        "🤖 Бот успешно запущен!\n" +
          `✅ Версия: Enhanced Activity + Welcome\n` +
          `⏰ Время: ${new Date().toLocaleString("ru-RU")}\n` +
          `🔄 Активность: Enhanced Phantom Mode`
      );
    } catch (adminError) {
      console.log(
        "ℹ️ Admin notification not sent (config.ADMIN_CHAT_ID not set)"
      );
    }
  } catch (error) {
    console.error("❌ Failed to start bot:", error);

    // Попытка перезапуска через 30 секунд
    setTimeout(() => {
      console.log("🔄 Attempting to restart bot...");
      startBot();
    }, 30000);
  }
}

// Запускаем setupBotCommands после регистрации всех команд
setupBotCommands(bot);

// Запускаем бота
startBot();

// ========== GRACEFUL SHUTDOWN ==========

process.once("SIGINT", () => {
  console.log("🛑 Stopping bot...");
  stopAutoChecking();
  stopPaymentChecking();
  if (phantomActivity) {
    phantomActivity.stop();
  }
  bot.stop("SIGINT");
});

process.once("SIGTERM", () => {
  console.log("🛑 Stopping bot...");
  stopAutoChecking();
  stopPaymentChecking();
  if (phantomActivity) {
    phantomActivity.stop();
  }
  bot.stop("SIGTERM");
});

// Обработка ошибок
process.on("uncaughtException", (error) => {
  console.error("🚨 UNCAUGHT EXCEPTION:", error);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("🚨 UNHANDLED REJECTION at:", promise, "reason:", reason);
});

bot.catch((error, ctx) => {
  console.error("🤖 Bot error:", error);
});