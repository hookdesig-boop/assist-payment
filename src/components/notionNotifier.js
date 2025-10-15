import { Client } from '@notionhq/client';
import config from '../../config/config.js';

const notion = new Client({
  auth: config.NOTION.API_KEY,
});

// 1. Функция для анализа структуры базы данных
export async function analyzeDatabaseStructure() {
  try {
    const databaseId = config.NOTION.DATABASE_ID || '27a4571881fb807894a8f467b6e408a4';
    console.log('🔍 Analyzing database structure...');
    
    const response = await notion.dataSources.retrieve({ data_source_id: config.NOTION.DATASOURCE_ID });
    
    console.log('📊 Database structure:');
    console.log('🔹 Database ID:', response.id);
    console.log('🔹 Database Name:', response.title[0]?.text?.content || 'No title');
    console.log('🔹 URL:', response.url);

    // Анализ всех полей
    console.log('\n📋 Properties (fields):');
    const properties = {};
    
    Object.entries(response.properties).forEach(([propertyName, propertyConfig]) => {
      console.log(`\n🔸 Property: "${propertyName}"`);
      console.log(`   Type: ${propertyConfig.type}`);
      
      properties[propertyName] = {
        type: propertyConfig.type,
        config: propertyConfig
      };

      switch (propertyConfig.type) {
        case 'select':
          if (propertyConfig.select?.options) {
            console.log('   Options:', propertyConfig.select.options.map(opt => opt.name));
            properties[propertyName].options = propertyConfig.select.options.map(opt => opt.name);
          }
          break;
          
        case 'status':
          if (propertyConfig.status?.options) {
            console.log('   Status options:', propertyConfig.status.options.map(opt => opt.name));
            properties[propertyName].options = propertyConfig.status.options.map(opt => opt.name);
          }
          break;
          
        case 'multi_select':
          if (propertyConfig.multi_select?.options) {
            console.log('   Options:', propertyConfig.multi_select.options.map(opt => opt.name));
            properties[propertyName].options = propertyConfig.multi_select.options.map(opt => opt.name);
          }
          break;
      }
    });

    // Поиск ключевых полей
    const keyFields = {
      status: findFieldByKeywords(response.properties, ['status', 'статус', 'state']),
      videoLink: findFieldByKeywords(response.properties, ['videolink', 'video', 'link', 'ссылка', 'видео']),
      userID: findFieldByKeywords(response.properties, ['userid', 'user', 'telegram', 'id']),
      orderNumber: findFieldByKeywords(response.properties, ['ordernumber', 'order', 'number', 'номер']),
      notification: findFieldByKeywords(response.properties, ['notification', 'sent', 'уведомление'])
    };

    console.log('\n🎯 Key fields identified:');
    Object.entries(keyFields).forEach(([fieldType, fieldName]) => {
      console.log(`   ${fieldType}: ${fieldName || 'Not found'}`);
    });

    return {
      databaseInfo: response,
      properties,
      keyFields
    };

  } catch (error) {
    console.error('❌ Error analyzing database:', error);
    throw error;
  }
}

// 2. Функция для поиска полей по ключевым словам
function findFieldByKeywords(properties, keywords) {
  const propertyNames = Object.keys(properties);
  
  for (const keyword of keywords) {
    const found = propertyNames.find(name => 
      name.toLowerCase().includes(keyword.toLowerCase())
    );
    if (found) return found;
  }
  
  return null;
}

// 3. Функция для поиска заданий с ссылками
export async function findOrdersWithLinks() {
  try {
    console.log('🔍 Searching for orders with links...');
    
    const analysis = await analyzeDatabaseStructure();
    const { keyFields, properties } = analysis;
    
    // Строим фильтры на основе найденных полей
    const filters = [];
    
    // Фильтр по статусу (если найден)
    if (keyFields.status) {
      const statusField = properties[keyFields.status];
      const completedStatus = findCompletedStatus(statusField.options);
      
      if (completedStatus) {
        filters.push({
          property: keyFields.status,
          [statusField.type]: {
            equals: completedStatus
          }
        });
      }
    }
    
    // Фильтр по наличию ссылки (если найден)
    if (keyFields.videoLink) {
      filters.push({
        property: keyFields.videoLink,
        url: {
          is_not_empty: true
        }
      });
    }
    
    // Фильтр по отсутствию отметки об отправке (если найден)
    if (keyFields.notification) {
      const notificationField = properties[keyFields.notification];
      if (notificationField.type === 'checkbox') {
        filters.push({
          property: keyFields.notification,
          checkbox: {
            equals: false
          }
        });
      }
    }
    
    console.log('🎯 Applying filters:', filters);
    
    // Выполняем запрос
    const response = await notion.dataSources.query({
      data_source_id: config.NOTION.DATASOURCE_ID || '27a4571881fb807894a8f467b6e408a4',
      filter: filters.length > 1 ? { and: filters } : filters[0],
      sorts: [
        {
          timestamp: 'last_edited_time',
          direction: 'descending'
        }
      ]
    });

    console.log(`✅ Found ${response.results.length} orders with links`);
    
    // Обрабатываем результаты
    const orders = response.results.map(order => ({
      id: order.id,
      videoLink: extractPropertyValue(order, keyFields.videoLink),
      userId: extractPropertyValue(order, keyFields.userID),
      orderNumber: extractPropertyValue(order, keyFields.orderNumber),
      status: extractPropertyValue(order, keyFields.status),
      properties: order.properties
    }));

    return {
      analysis,
      orders,
      total: response.results.length
    };

  } catch (error) {
    console.error('❌ Error finding orders with links:', error);
    throw error;
  }
}

// 4. Функция для поиска статуса "завершено"
function findCompletedStatus(options) {
  if (!options) return null;
  
  const completedKeywords = ['done', 'completed', 'finished', 'готово', 'завершено', 'выполнено'];
  
  for (const keyword of completedKeywords) {
    const found = options.find(option => 
      option.toLowerCase().includes(keyword.toLowerCase())
    );
    if (found) return found;
  }
  
  return options[0]; // Возвращаем первый статус, если не нашли подходящий
}

// 5. Функция для извлечения значения свойства
function extractPropertyValue(order, propertyName) {
  if (!propertyName || !order.properties[propertyName]) {
    return null;
  }
  
  const property = order.properties[propertyName];
  
  switch (property.type) {
    case 'rich_text':
      return property.rich_text?.[0]?.text?.content || null;
      
    case 'title':
      return property.title?.[0]?.text?.content || null;
      
    case 'number':
      return property.number?.toString() || null;
      
    case 'url':
      return property.url || null;
      
    case 'select':
      return property.select?.name || null;
      
    case 'status':
      return property.status?.name || null;
      
    case 'checkbox':
      return property.checkbox ? 'true' : 'false';
      
    default:
      return null;
  }
}

// 6. Функция для отправки ссылки пользователю
export async function sendLinkToUser(bot, userId, orderNumber, videoLink) {
  try {
    if (!userId) {
      console.log('❌ No user ID provided');
      return false;
    }
    
    await bot.telegram.sendMessage(
      userId,
      `🎉 *Ваш заказ готов!*\n\n` +
      `🔢 Номер заказа: #${orderNumber}\n` +
      `📹 Ссылка на видео: ${videoLink}\n\n` +
      `Спасибо, что воспользовались нашими услугами! ✨`,
      { parse_mode: 'Markdown' }
    );
    
    console.log(`✅ Link sent to user ${userId} for order ${orderNumber}`);
    return true;
    
  } catch (error) {
    if (error.response?.error_code === 403) {
      console.log(`❌ User ${userId} has blocked the bot`);
    } else if (error.response?.error_code === 400) {
      console.log(`❌ Invalid user ID: ${userId}`);
    } else {
      console.error(`❌ Error sending to user ${userId}:`, error.message);
    }
    return false;
  }
}

// 7. Основная функция обработки и отправки
export async function processAndSendLinks(bot) {
  try {
    console.log('🚀 Starting link processing...');
    
    const result = await findOrdersWithLinks();
    const { orders, analysis } = result;
    
    console.log(`📋 Processing ${orders.length} orders...`);
    
    let sentCount = 0;
    let errorCount = 0;
    const results = [];

    for (const order of orders) {
      try {
        console.log(`\n📦 Processing order:`, {
          orderNumber: order.orderNumber,
          hasVideoLink: !!order.videoLink,
          hasUserId: !!order.userId
        });

        if (order.videoLink && order.userId) {
          const sent = await sendLinkToUser(bot, order.userId, order.orderNumber, order.videoLink);
          
          if (sent) {
            // Помечаем как отправленное (если есть поле)
            if (analysis.keyFields.notification) {
              await markAsSent(order.id, analysis.keyFields.notification);
            }
            sentCount++;
          } else {
            errorCount++;
          }
          
          results.push({
            orderNumber: order.orderNumber,
            userId: order.userId,
            sent: sent,
            error: !sent
          });
        } else {
          console.log('⚠️ Skipping order - missing data:', {
            orderNumber: order.orderNumber,
            missingVideoLink: !order.videoLink,
            missingUserId: !order.userId
          });
          errorCount++;
        }
      } catch (error) {
        console.error(`❌ Error processing order ${order.orderNumber}:`, error);
        errorCount++;
      }
    }

    console.log(`\n📊 Final results: ${sentCount} sent, ${errorCount} errors`);
    
    return {
      total: orders.length,
      sent: sentCount,
      errors: errorCount,
      results,
      analysis: analysis.keyFields
    };

  } catch (error) {
    console.error('❌ Error in processAndSendLinks:', error);
    throw error;
  }
}

// 8. Функция для отметки отправки
async function markAsSent(pageId, notificationField) {
  try {
    await notion.pages.update({
      page_id: pageId,
      properties: {
        [notificationField]: {
          checkbox: true
        }
      }
    });
    console.log(`✅ Marked as sent: ${pageId}`);
  } catch (error) {
    console.error(`❌ Error marking as sent:`, error);
  }
}

// 9. Команды для бота
export function setupBotCommands(bot) {
  // Анализ базы данных
  bot.command('analyze_db', async (ctx) => {
    try {
      await ctx.reply('🔍 Анализирую структуру базы данных...');
      const analysis = await analyzeDatabaseStructure();
      
      let message = `📊 *Анализ базы данных:*\n\n`;
      message += `🏷️ *Название:* ${analysis.databaseInfo.title[0]?.text?.content || 'Нет названия'}\n`;
      message += `🔗 *URL:* ${analysis.databaseInfo.url}\n\n`;
      message += `🎯 *Ключевые поля:*\n`;
      
      Object.entries(analysis.keyFields).forEach(([field, name]) => {
        message += `• ${field}: ${name || '❌ Не найдено'}\n`;
      });
      
      await ctx.reply(message, { parse_mode: 'Markdown' });
    } catch (error) {
      await ctx.reply(`❌ Ошибка анализа: ${error.message}`);
    }
  });

  // Поиск заказов с ссылками
  bot.command('find_links', async (ctx) => {
    try {
      await ctx.reply('🔍 Ищу заказы со ссылками...');
      const result = await findOrdersWithLinks();
      
      let message = `📋 *Найдено заказов: ${result.total}*\n\n`;
      
      result.orders.forEach(order => {
        message += `🔢 *Заказ #${order.orderNumber || 'N/A'}*\n`;
        message += `👤 User: ${order.userId || '❌ Нет ID'}\n`;
        message += `🔗 Ссылка: ${order.videoLink ? '✅ Есть' : '❌ Нет'}\n`;
        message += `📊 Статус: ${order.status || 'N/A'}\n\n`;
      });
      
      await ctx.reply(message, { parse_mode: 'Markdown' });
    } catch (error) {
      await ctx.reply(`❌ Ошибка поиска: ${error.message}`);
    }
  });

  // Отправка ссылок
  bot.command('send_links', async (ctx) => {
    try {
      await ctx.reply('🚀 Запускаю отправку ссылок...');
      const result = await processAndSendLinks(bot);
      
      let message = `📊 *Результаты отправки:*\n\n`;
      message += `✅ Успешно отправлено: ${result.sent}\n`;
      message += `❌ Ошибок: ${result.errors}\n`;
      message += `📋 Всего обработано: ${result.total}\n\n`;
      message += `🎯 *Обнаруженные поля:*\n`;
      
      Object.entries(result.analysis).forEach(([field, name]) => {
        message += `• ${field}: ${name || '❌ Не найдено'}\n`;
      });
      
      await ctx.reply(message, { parse_mode: 'Markdown' });
    } catch (error) {
      await ctx.reply(`❌ Ошибка отправки: ${error.message}`);
    }
  });
}