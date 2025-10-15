// src/utils/cryptoBot.js
import axios from 'axios';
import config from '../../config/config.js';

export class CryptoBotService {
  constructor(bot) {
    this.bot = bot;
    this.baseURL = 'https://pay.crypt.bot/api';
  }

  // Создание инвойса
  async createInvoice(amount, description, orderId) {
    try {
      // Реальная реализация с CryptoBot API
      const botInfo = await this.bot.telegram.getMe();
      
      const response = await axios.post(
        `${this.baseURL}/createInvoice`,
        {
          asset: 'USDT',
          amount: amount,
          description: description,
          paid_btn_name: 'viewItem',
          paid_btn_url: `https://t.me/${botInfo.username}`,
          payload: JSON.stringify({ orderId: orderId }),
          allow_comments: false,
          allow_anonymous: false,
          expires_in: 900 // 15 минут
        },
        {
          headers: {
            'Crypto-Pay-API-Token': config.CRYPTO_BOT.API_KEY
          }
        }
      );

      return response.data.result;

    } catch (error) {
      console.error('❌ Error creating CryptoBot invoice:', error.response?.data || error.message);
      throw new Error('Не удалось создать счет для оплаты');
    }
  }

  // Проверка статуса оплаты
  async checkPaymentStatus(invoiceId) {
    try {
      // Реальная реализация с CryptoBot API
      const response = await axios.get(
        `${this.baseURL}/getInvoices?invoice_ids=${invoiceId}`,
        {
          headers: {
            'Crypto-Pay-API-Token': config.CRYPTO_BOT.API_KEY
          }
        }
      );

      const invoice = response.data.result.items[0];
      
      if (invoice.status === 'paid') {
        console.log(`✅ Invoice ${invoiceId} is paid`);
        return invoice;
      } else {
        console.log(`⏳ Invoice ${invoiceId} status: ${invoice.status}`);
        return invoice;
      }

    } catch (error) {
      console.error('❌ Error checking payment status:', error);
      return { status: 'unknown' };
    }
  }

  // Форматирование суммы для отображения
  formatAmount(amount, currency = 'USDT') {
    return `${amount} ${currency}`;
  }

  // Валидация суммы
  validateAmount(amount) {
    if (typeof amount !== 'number' || amount <= 0) {
      throw new Error('Неверная сумма оплаты');
    }
    return true;
  }

  // Получение информации о валютах
  getSupportedCurrencies() {
    return [
      { code: 'USDT', name: 'Tether USD', min_amount: 1 },
      { code: 'BTC', name: 'Bitcoin', min_amount: 0.0001 },
      { code: 'ETH', name: 'Ethereum', min_amount: 0.001 },
      { code: 'TON', name: 'Toncoin', min_amount: 0.1 }
    ];
  }
}

export default CryptoBotService;