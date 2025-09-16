const { Telegraf, Markup } = require("telegraf");

require("dotenv").config();

const bot = new Telegraf(process.env.BOT_TOKEN);
console.log(process.env.BOT_TOKEN ? "Token - ✅" : "❌");

const price = process.env.PRODUCT_PRICE;

const orderSession = new Map();

const LOCALIZATION_OPTIONS = [
  "🇺🇸 США (английский)",
  "🇺🇦 Украина (украинский)",
  "🇷🇺 Россия (русский)",
  "🇩🇪 Германия (немецкий)",
  "🇫🇷 Франция (французский)",
  "🇨🇳 Китай (китайский)",
  "🌍 Другое (уточнить в комментарии)",
];

bot.start(async (ctx) => {
  console.log(`User start ${ctx.from.id}`);
  await ctx.reply(
    `👋 Добро пожаловать! Я помогу оформить заказ и оплатить его криптовалютой.\n\n` +
      `📋 Для начала введите номер вашего заказа:`,
    Markup.removeKeyboard()
  );
});

bot.on("text", async (ctx) => {
  const userId = ctx.from.id;
  const text = ctx.message.text.trim();
  if (orderSession.has(userId)) {
    await handleOrderStage(ctx);
    return;
  }

  if (/^[A-Z0-9]{3,20}$/i.test(text)) {
    orderSession.set(userId, {
      stage: "bank",
      orderNumber: text,
      createdAt: new Date(),
    });
  }
});

console.log(orderSession)

async function handleLocalizationStage(ctx, session, localizationText) {
  if (!LOCALIZATION_OPTIONS.includes(localizationText)) {
    await ctx.reply("❌ Пожалуйста, выберите вариант из предложенных:");
    return;
  }

  session.localization = localizationText;
  session.stage = "inscription";

  await ctx.reply(
    `🌍 Локализация: ${localizationText}\n\n` +
      `➡️ Теперь введите текст надписи на товаре:\n` +
      `(или отправьте "нет" если надпись не нужна)`,
    Markup.removeKeyboard()
  );
}

async function handleBankStage(ctx, session, bankText) {
  if (bankText.trim().length < 2) {
    await ctx.reply('❌ Пожалуйста, введите корректное название банка:');
    return;
  }

  session.bank = bankText;
  session.stage = 'prize';

  await ctx.reply(
    `🏦 Банк: ${bankText}\n\n` +
    `➡️ Теперь введите сумму вашего выигрыша в USD:\n` +
    `(только цифры, например: 1000)`,
    Markup.removeKeyboard()
  );
}


async function handleOrderStage(ctx) {
  const userId = ctx.from.id;
  const session = orderSession.get(userId);
  const text = ctx.message.text.trim();

  console.log("🔄 Handling stage:", session.stage, "for user:", userId);

  switch (session.stage) {
    case "bank":
      await handleBankStage(ctx, session, text);
      break;
    case "prize":
      await handlePrizeStage(ctx, session, text);
      break;
    case "quantity":
      await handleQuantityStage(ctx, session, text);
      break;
    case "localization":
      await handleLocalizationStage(ctx, session, text);
      break;
    case "inscription":
      await handleInscriptionStage(ctx, session, text);
      break;
    case "details":
      await handleDetailsStage(ctx, session, text);
      break;
  }
}

async function handlePrizeStage(ctx, session, prizeText) {
  const prizeAmount = parseFloat(prizeText.replace(',', '.'));
  
  if (isNaN(prizeAmount) || prizeAmount <= 0 || prizeAmount > 1000000) {
    await ctx.reply('❌ Пожалуйста, введите корректную сумму выигрыша (например: 1000):');
    return;
  }

  session.prizeAmount = prizeAmount;
  session.stage = 'quantity';

  await ctx.reply(
    `🎉 Сумма выигрыша: $${prizeAmount}\n\n` +
    `➡️ Теперь введите количество товара:`,
    Markup.keyboard([['1', '2', '3'], ['4', '5', '10']]).resize()
  );
}
async function handleQuantityStage(ctx, session, quantityText) {
  const quantity = parseInt(quantityText);
  
  if (isNaN(quantity) || quantity < 1 || quantity > 100) {
    await ctx.reply('❌ Пожалуйста, введите корректное количество (1-100):');
    return;
  }

  session.quantity = quantity;
  session.totalAmount = quantity * price;
  session.stage = 'localization';

  await ctx.reply(
    `📦 Количество: ${quantity} шт.\n` +
    `💰 Сумма заказа: $${session.totalAmount}\n\n` +
    `➡️ Теперь выберите локализацию товара:`,
    Markup.keyboard([LOCALIZATION_OPTIONS.slice(0, 3), LOCALIZATION_OPTIONS.slice(3, 6), [LOCALIZATION_OPTIONS[6]]]).resize()
  );
}

async function handleLocalizationStage(ctx, session, localizationText) {
  if (!LOCALIZATION_OPTIONS.includes(localizationText)) {
    await ctx.reply('❌ Пожалуйста, выберите вариант из предложенных:');
    return;
  }

  session.localization = localizationText;
  session.stage = 'inscription';

  await ctx.reply(
    `🌍 Локализация: ${localizationText}\n\n` +
    `➡️ Теперь введите текст надписи на товаре:\n` +
    `(или отправьте "нет" если надпись не нужна)`,
    Markup.removeKeyboard()
  );
}
async function handleInscriptionStage(ctx, session, inscriptionText) {
  if (inscriptionText.toLowerCase() !== 'нет' && inscriptionText.trim() !== '') {
    session.inscription = inscriptionText;
  } else {
    session.inscription = 'Без надписи';
  }

  session.stage = 'details';

  await ctx.reply(
    `🔤 Надпись: ${session.inscription}\n\n` +
    `➡️ Теперь введите дополнительные детали или пожелания:\n` +
    `(например: цвет, размер, способ доставки и т.д.)`,
    Markup.removeKeyboard()
  );
}

async function handleDetailsStage(ctx, session, detailsText) {
  if (detailsText.trim().length < 2) {
    await ctx.reply('❌ Пожалуйста, введите детали заказа (минимум 2 символа):');
    return;
  }

  session.details = detailsText;
  session.stage = 'confirmation';

  await ctx.replyWithHTML(
    `📋 <b>Итоги заказа #${session.orderNumber}</b>\n\n` +
    `🏦 Банк: ${session.bank}\n` +
    `🎉 Сумма выигрыша: $${session.prizeAmount}\n` +
    `📦 Количество: ${session.quantity} шт.\n` +
    `🌍 Локализация: ${session.localization}\n` +
    `🔤 Надпись: ${session.inscription}\n` +
    `💰 Сумма заказа: <b>$${session.totalAmount} USDT</b>\n` +
    `📝 Дополнительно: ${session.details}\n\n` +
    `➡️ Всё верно? Создать инвойс для оплаты?`,
    Markup.inlineKeyboard([
      [Markup.button.callback('✅ Да, создать инвойс', 'confirm_invoice')],
      [Markup.button.callback('❌ Нет, начать заново', 'cancel_order')]
    ])
  );
}

bot
  .launch()
  .then(() => {
    console.log("🤖 Бот запущен с тестовыми функциями!");
    //   console.log('💡 Тестовые команды:');
    //   console.log('   /test_notion - Быстрая проверка Notion');
    //   console.log('   /simulate - Полная имитация заказа');
    //   console.log('   /test_direct - Прямой тест отправки');
    //   console.log('   /test_connection - Проверка подключений');
  })
  .catch((error) => {
    console.log("❌ Ошибка запуска бота:", error.message);
  });

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
