// src/utils/cryptoBot.js
import axios from 'axios';
import config from '../../config/config.js';

export class CryptoBotService {
  constructor(bot) {
    this.bot = bot;
    this.baseURL = config.CRYPTO_BOT?.TEST_MODE 
      ? 'https://testnet-pay.crypt.bot/api'
      : 'https://pay.crypt.bot/api';
  }

  async createInvoice(amount, description, orderId) {
    try {
      // Валидация входных данных
      this.validateAmount(amount);
      
      if (!description || !orderId) {
        throw new Error('Description and orderId are required');
      }

      // Получаем информацию о боте
      const botInfo = await this.bot.telegram.getMe();
      
      // Подготавливаем данные для API
      const requestData = {
        asset: 'USDT',
        amount: amount.toString(), // API ожидает строку
        description: description.substring(0, 1024), // Ограничение длины
        paid_btn_name: 'viewItem',
        paid_btn_url: `https://t.me/${botInfo.username}`,
        payload: JSON.stringify({ 
          orderId: orderId,
          timestamp: Date.now()
        }),
        allow_comments: false,
        allow_anonymous: false,
        expires_in: 900 // 15 минут
      };

      console.log('📤 Sending request to CryptoBot API:', {
        url: `${this.baseURL}/createInvoice`,
        data: { ...requestData, payload: '[...]' } // Скрываем payload в логах
      });

      const response = await axios.post(
        `${this.baseURL}/createInvoice`,
        requestData,
        {
          headers: {
            'Crypto-Pay-API-Token': config.CRYPTO_BOT.API_KEY,
            'Content-Type': 'application/json'
          },
          timeout: 10000 // 10 секунд таймаут
        }
      );

      console.log('✅ CryptoBot API response:', response.data);

      if (!response.data.ok) {
        throw new Error(`CryptoBot API error: ${response.data.error?.name || 'Unknown error'}`);
      }

      return response.data.result;

    } catch (error) {
      console.error('❌ Error creating CryptoBot invoice:', {
        message: error.message,
        response: error.response?.data,
        config: error.config?.url
      });
      throw new Error(`Не удалось создать счет для оплаты: ${error.message}`);
    }
  }

  // Улучшенная проверка статуса
  async checkPaymentStatus(invoiceId) {
    try {
      if (!invoiceId) {
        throw new Error('Invoice ID is required');
      }

      const response = await axios.get(
        `${this.baseURL}/getInvoices?invoice_ids=${invoiceId}`,
        {
          headers: {
            'Crypto-Pay-API-Token': config.CRYPTO_BOT.API_KEY
          },
          timeout: 5000
        }
      );

      if (!response.data.ok) {
        throw new Error(`CryptoBot API error: ${response.data.error?.name}`);
      }

      const invoice = response.data.result.items[0];
      
      if (!invoice) {
        throw new Error(`Invoice ${invoiceId} not found`);
      }

      console.log(`📊 Invoice ${invoiceId} status: ${invoice.status}`);
      
      return {
        status: invoice.status,
        invoice: invoice,
        paid: invoice.status === 'paid',
        expired: invoice.status === 'expired'
      };

    } catch (error) {
      console.error('❌ Error checking payment status:', error.message);
      return { 
        status: 'error', 
        error: error.message,
        paid: false 
      };
    }
  }

  // Улучшенная валидация
  validateAmount(amount) {
    if (typeof amount !== 'number' || isNaN(amount)) {
      throw new Error('Amount must be a valid number');
    }
    if (amount <= 0) {
      throw new Error('Amount must be greater than 0');
    }
    if (amount < 1) { // Минимальная сумма для USDT
      throw new Error('Minimum amount is 1 USDT');
    }
    return true;
  }
}

export default CryptoBotService;