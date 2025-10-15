// src/services/paymentService.js
import { Markup } from 'telegraf';
import CryptoBotService from '../utils/cryptoBot.js';
import { createNotionTask } from '../utils/notion.js';

export class PaymentService {
  constructor(bot) {
    this.bot = bot;
    this.cryptoBot = new CryptoBotService(bot);
  }

  // Создание инвойса и отображение сводки заказа
  async createInvoice(ctx) {
    try {
      const order = ctx.session.order;
      
      // Рассчитываем стоимость (10 USD за адаптацию)
      const totalAmount = order.adaptationsCount * 10;
      
      // Получаем названия локализаций
      const allLocalizations = this.getAllLocalizations();
      const selectedLocalizationNames = order.selectedLocalizations
        .map(id => allLocalizations.find(loc => loc.id === id)?.name)
        .filter(Boolean);
      
      // Показываем сводку заказа
      const orderSummary = this.createOrderSummary(order, selectedLocalizationNames, totalAmount);
      await ctx.reply(orderSummary, { parse_mode: 'Markdown' });
      
      // Создаем инвойс в CryptoBot
      await ctx.reply('🔄 Создаем счет для оплаты...');
      
      const invoice = await this.cryptoBot.createInvoice(
        totalAmount,
        `Заказ адаптации видео #${order.orderNumber}`,
        order.orderNumber
      );
      
      // Отправляем ссылку на оплату
      await this.sendInvoiceMessage(ctx, invoice, totalAmount, order.orderNumber);
      
      // Сохраняем ID инвойса в сессию
      ctx.session.invoiceId = invoice.invoice_id;
      ctx.session.step = 'awaiting_payment';
      
      console.log(`💳 Invoice created for user ${ctx.from.id}: ${invoice.invoice_id}`);
      
    } catch (error) {
      console.error('❌ Error creating invoice:', error);
      await ctx.reply(
        '❌ Произошла ошибка при создании счета. Пожалуйста, попробуйте еще раз или обратитесь в поддержку.'
      );
    }
  }

  // Создание сводки заказа
  createOrderSummary(order, localizationNames, totalAmount) {
    return `
📋 *Сводка заказа:*

🔢 Номер заказа: ${order.orderNumber}
🎬 Адаптаций: ${order.adaptationsCount}
🌍 Локализации: ${localizationNames.join(', ')}
🏦 Банк: ${order.bank}
💰 Сумма выигрыша: ${order.winningAmount} ${order.currency}
📝 Доп. информация: ${order.additionalInfo || 'Не указано'}

💵 *Сумма к оплате: ${totalAmount} USD*
    `.trim();
  }

  // Отправка сообщения с инвойсом
  async sendInvoiceMessage(ctx, invoice, totalAmount, orderNumber) {
    await ctx.reply(
      `💳 *Счет для оплаты создан!*\n\n` +
      `💰 Сумма: ${this.cryptoBot.formatAmount(totalAmount)}\n` +
      `📝 Описание: Заказ адаптации видео #${orderNumber}\n\n` +
      `⏰ Счет действителен 15 минут`,
      {
        parse_mode: 'Markdown',
        ...this.createPaymentKeyboard(invoice.pay_url)
      }
    );
  }

  // Создание клавиатуры для оплаты
  createPaymentKeyboard(invoiceUrl) {
    return Markup.inlineKeyboard([
      [Markup.button.url('💳 Оплатить', invoiceUrl)],
      [Markup.button.callback('💳 Имитировать оплату', 'simulate_payment')],
      [Markup.button.callback('✅ Проверить оплату', 'check_payment')]
    ]);
  }

  // Имитация оплаты
  async simulatePayment(ctx) {
    await ctx.answerCbQuery('💳 Имитируем оплату...');
    
    await ctx.editMessageText(
      '💳 *Имитация оплаты...*\n\n' +
      '⏳ Обрабатываем платеж...',
      { parse_mode: 'Markdown' }
    );
    
    // Имитация процесса оплаты
    setTimeout(async () => {
      await this.completePayment(ctx);
    }, 3000);
  }

  // Проверка статуса оплаты
  async checkPayment(ctx) {
    await ctx.answerCbQuery('🔍 Проверяем оплату...');
    
    const invoiceId = ctx.session.invoiceId;
    
    if (!invoiceId) {
      await ctx.reply('❌ Информация о счете не найдена');
      return;
    }
    
    await ctx.editMessageText('🔍 Проверяем статус оплаты...');
    
    const paymentStatus = await this.cryptoBot.checkPaymentStatus(invoiceId);
    
    if (paymentStatus.status === 'paid') {
      await this.completePayment(ctx);
    } else {
      await ctx.reply(
        '❌ Оплата еще не поступила. Пожалуйста, попробуйте позже.',
        Markup.inlineKeyboard([
          [Markup.button.callback('🔄 Проверить еще раз', 'check_payment')]
        ])
      );
    }
  }

  // Завершение оплаты и сохранение в Notion
  async completePayment(ctx) {
    try {
      const order = ctx.session.order;
      const userId = ctx.from.id;
      
      // Получаем названия локализаций
      const allLocalizations = this.getAllLocalizations();
      const localizationNames = order.selectedLocalizations
        .map(id => allLocalizations.find(loc => loc.id === id)?.name)
        .filter(Boolean);
      
      await ctx.editMessageText('📤 Сохраняем заказ в системе...');
      
      // Сохраняем заказ в Notion
      const notionTask = await createNotionTask({
        orderNumber: order.orderNumber,
        userId: userId,
        adaptationsCount: order.adaptationsCount,
        localizations: localizationNames,
        bank: order.bank,
        winningAmount: order.winningAmount,
        currency: order.currency,
        additionalInfo: order.additionalInfo
      });
      
      // Успешное завершение
      await this.sendSuccessMessage(ctx, order.orderNumber, notionTask.id);
      
      console.log(`✅ Order ${order.orderNumber} completed for user ${userId}`);
      
      // Очищаем сессию
      this.clearSession(ctx);
      
    } catch (error) {
      console.error('❌ Error completing payment:', error);
      await this.sendErrorMessage(ctx);
    }
  }

  // Отправка сообщения об успешной оплате
  async sendSuccessMessage(ctx, orderNumber, notionTaskId) {
    await ctx.reply(
      `🎉 *Оплата подтверждена!*\n\n` +
      `✅ Заказ #${orderNumber} успешно создан и передан в работу.\n` +
      `📋 Запись в системе: ${notionTaskId ? 'создана' : 'ошибка'}\n\n` +
      `Мы уведомим вас когда адаптация будет готова.`,
      { parse_mode: 'Markdown' }
    );
  }

  // Отправка сообщения об ошибке
  async sendErrorMessage(ctx) {
    await ctx.reply(
      '❌ Произошла ошибка при сохранении заказа. Пожалуйста, обратитесь в поддержку.'
    );
  }

  // Очистка сессии
  clearSession(ctx) {
    ctx.session.step = 'completed';
    ctx.session.order = {};
    ctx.session.invoiceId = null;
  }

  // Вспомогательная функция для получения локализаций
  getAllLocalizations() {
    return [
      { id: 1, name: "🇺🇸 EN (английский)" },
      { id: 2, name: "🇬🇧 UK (британский английский)" },
      { id: 3, name: "🇺🇦 UA (украинский)" },
      { id: 4, name: "🇷🇺 RU (русский)" },
      { id: 5, name: "🇩🇪 DE (немецкий)" },
      { id: 6, name: "🇫🇷 FR (французский)" },
      { id: 7, name: "🇪🇸 ES (испанский)" },
      { id: 8, name: "🇮🇹 IT (итальянский)" },
      { id: 41, name: "🌍 Другое" },
    ];
  }
}

export default PaymentService;