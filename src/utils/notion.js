import { Client } from "@notionhq/client";
import config from "../../config/config.js";




const notion = new Client({
  auth: config.NOTION.API_KEY,
});



// Функция для получения значения свойства
function getPropertyValue(property) {
  try {
    if (!property) return null;

    switch (property.type) {
      case "rich_text":
        return (
          property.rich_text?.map((item) => item.plain_text).join("") || null
        );

      case "title":
        return property.title?.map((item) => item.plain_text).join("") || null;

      case "number":
        return property.number;

      case "url":
        return property.url;

      case "status":
        return property.status?.name || null;

      case "select":
        return property.select?.name || null;

      default:
        console.log(`Неизвестный тип свойства: ${property.type}`);
        return null;
    }
  } catch (error) {
    console.error(`Ошибка при получении значения свойства:`, error);
    return null;
  }
}

// Основная функция для извлечения данных для валидации
export function extractDataForValidation(pageObj) {
  try {
    if (!pageObj || !pageObj.properties) {
      console.error("❌ Неверный объект страницы");
      return null;
    }

    const result = {
      pageInfo: {
        id: pageObj.id,
        createdTime: pageObj.created_time,
        lastEditedTime: pageObj.last_edited_time,
        url: pageObj.url,
      },
      properties: {},
      rawProperties: pageObj.properties,
    };

    // Извлекаем все свойства
    for (const [propName, property] of Object.entries(pageObj.properties)) {
      result.properties[propName] = {
        value: getPropertyValue(property),
        type: property.type,
        id: property.id,
        raw: property,
      };
    }

    return result;
  } catch (error) {
    console.error("❌ Ошибка в extractDataForValidation:", error);
    return null;
  }
}

// Функция для создания задачи в Notion
export async function createNotionTask(props) {
  const {
    orderNumber,
    userId,
    adaptationsCount,
    localizations,
    bank,
    winningAmount,
    currency,
    additionalInfo,
    paymentStatus = "paid",
  } = props;

  try {
    console.log("📤 Sending to Notion:", props);

    // Преобразуем массив локализаций в строку
    const localizationsText = Array.isArray(localizations)
      ? localizations.join(", ")
      : localizations;

    const properties = {
      // Название страницы (обязательное поле)
      Name: {
        title: [
          {
            type: "text",
            text: { content: `Заказ №${orderNumber}` },
          },
        ],
      },
      // Номер заказа
      OrderNumber: {
        rich_text: [
          {
            type: "text",
            text: { content: orderNumber.toString() },
          },
        ],
      },
      // ID пользователя Telegram
      userID: {
        number: parseInt(userId),
      },
      // Количество адаптаций
      AdaptationsCount: {
        number: parseInt(adaptationsCount) || 0,
      },
      // Локализации
      Localization: {
        rich_text: [
          {
            type: "text",
            text: { content: localizationsText || "" },
          },
        ],
      },
      // Банк
      Bank: {
        rich_text: [
          {
            type: "text",
            text: { content: bank || "" },
          },
        ],
      },
      // Сумма выигрыша
      WinningAmount: {
        number: parseFloat(winningAmount) || 0,
      },
      // Валюта
      Currency: {
        select: {
          name: currency || "USD",
        },
      },
      // Дополнительная информация
      AdditionalInfo: {
        rich_text: [
          {
            type: "text",
            text: { content: additionalInfo || "Не указано" },
          },
        ],
      },
      // Ссылка на готовое видео (пустое поле для будущего использования)
      VideoLink: {
        url: null, // Пустая ссылка, будет заполнена позже
      },
      // Статус оплаты
      PaymentStatus: {
        select: {
          name: paymentStatus,
        },
      },
      // Статус заказа
      Status: {
        select: {
          name: "В обработке",
        },
      },
      // Дата создания
      Created: {
        date: {
          start: new Date().toISOString(),
        },
      },
    };

    const response = await notion.pages.create({
      parent: {
        database_id: config.NOTION.DATABASE_ID,
      },
      properties: properties,
    });

    console.log("✅ Notion task created successfully, page ID:", response.id);
    return response;
  } catch (error) {
    console.error("❌ Notion API error:", error);
    throw new Error(`Notion error: ${error.message}`);
  }
}

export async function queryCompletedOrdersWithLinks() {
  try {
    console.log("🔍 Querying database for completed orders with links...");

    const response = await notion.dataSources.query({
      data_source_id: config.NOTION.DATASOURCE_ID, // или ваш database_id
      filter: {
        and: [
          {
            // Фильтр по наличию ссылки на видео
            property: "VideoLink",
            url: {
              is_not_empty: true,
            },
          },
          {
            // Фильтр по отсутствию отметки об отправке (если есть такое поле)
            property: "NotificationSent",
            checkbox: {
              equals: false,
            },
          },
        ],
      },
      // Сортировка по дате создания (новые сначала)
      sorts: [
        {
          property: "Created",
          direction: "descending",
        },
      ],
    });

    console.log(
      `✅ Found ${response.results.length} completed orders with links`
    );
    return response.results;
  } catch (error) {
    console.error("❌ Error querying database:", error);
    throw error;
  }
}

// Альтернативная версия с другими возможными фильтрами
export async function queryOrdersWithCustomFilters() {
  try {
    console.log("🔍 Querying database with custom filters...");

    const response = await notion.databases.query({
      database_id: config.NOTION.DATABASE_ID,
      filter: {
        or: [
          {
            // Вариант 1: Завершенные заказы с ссылками
            and: [
              {
                property: "Status",
                select: {
                  equals: "Завершено",
                },
              },
              {
                property: "VideoLink",
                url: {
                  is_not_empty: true,
                },
              },
            ],
          },
          {
            // Вариант 2: Или заказы со статусом "Готово"
            and: [
              {
                property: "Status",
                select: {
                  equals: "Готово",
                },
              },
              {
                property: "VideoLink",
                url: {
                  is_not_empty: true,
                },
              },
            ],
          },
        ],
      },
    });

    console.log(`✅ Found ${response.results.length} orders matching filters`);
    return response.results;
  } catch (error) {
    console.error("❌ Error querying database:", error);
    throw error;
  }
}

// Функция для отправки ссылки пользователю
export async function sendLinkToUser(bot, userId, orderNumber, videoLink) {
  try {
    await bot.telegram.sendMessage(
      userId,
      `🎉 *Ваш заказ готов!*\n\n` +
        `🔢 Номер заказа: #${orderNumber}\n` +
        `📹 Ссылка на видео: ${videoLink}\n\n` +
        `Спасибо, что воспользовались нашими услугами! ✨`,
      { parse_mode: "Markdown" }
    );

    console.log(`✅ Link sent to user ${userId} for order ${orderNumber}`);
    return true;
  } catch (error) {
    console.error(`❌ Error sending link to user ${userId}:`, error);
    return false;
  }
}

// Основная функция для обработки и отправки ссылок
export async function processAndSendLinks(bot) {
  try {
    console.log("🔄 Processing and sending links...");

    // Получаем завершенные заказы с ссылками
    const completedOrders = await queryCompletedOrdersWithLinks();

    let sentCount = 0;
    let errorCount = 0;

    for (const order of completedOrders) {
      try {
        const videoLink = order.properties.VideoLink?.url;
        const userId = extractUserIdFromOrder(order);
        const orderNumber = extractOrderNumberFromOrder(order);

        console.log(`📦 Processing order ${orderNumber}:`, {
          videoLink,
          userId,
          hasVideoLink: !!videoLink,
          hasUserId: !!userId,
        });

        if (videoLink && userId) {
          const sent = await sendLinkToUser(
            bot,
            userId,
            orderNumber,
            videoLink
          );

          if (sent) {
            // Помечаем уведомление как отправленное
            await markNotificationAsSent(order.id);
            sentCount++;
          } else {
            errorCount++;
          }
        } else {
          console.log("⚠️ Missing data for order:", orderNumber);
          errorCount++;
        }
      } catch (error) {
        console.error(`❌ Error processing order:`, error);
        errorCount++;
      }
    }

    console.log(`📊 Results: ${sentCount} sent, ${errorCount} errors`);
    return { sent: sentCount, errors: errorCount };
  } catch (error) {
    console.error("❌ Error in processAndSendLinks:", error);
    throw error;
  }
}

// Вспомогательные функции для извлечения данных
function extractUserIdFromOrder(order) {
  try {
    const possibleFields = ["userID", "User", "TelegramID", "UserId", "Telegram ID"];

    for (const field of possibleFields) {
      const property = order.properties[field];
      if (!property) continue;

      let value = null;

      switch (property.type) {
        case "rich_text":
          value = property.rich_text?.[0]?.text?.content;
          break;
        case "number":
          value = property.number?.toString();
          break;
        case "title":
          value = property.title?.[0]?.text?.content;
          break;
        default:
          continue;
      }

      if (!value) continue;

      // Строгая проверка на Telegram ID (только числа, минимум 5 цифр)
      const telegramIdMatch = value.toString().match(/^\d{5,}$/);
      if (telegramIdMatch) {
        return telegramIdMatch[0];
      }

      // Попытка извлечь из текста
      const extractedNumber = extractNumericValue(value);
      if (extractedNumber && extractedNumber.length >= 5) {
        return extractedNumber;
      }
    }
    
    return null;
  } catch (error) {
    console.error("Error extracting user ID:", error);
    return null;
  }
}

function extractOrderNumberFromOrder(order) {
  try {
    // Пробуем разные возможные поля для номера заказа
    const possibleFields = ["OrderNumber", "Order", "Number", "Name"];

    for (const field of possibleFields) {
      const property = order.properties[field];
      if (property) {
        if (
          property.type === "rich_text" &&
          property.rich_text?.[0]?.text?.content
        ) {
          return property.rich_text[0].text.content;
        }
        if (property.type === "number") {
          return property.number?.toString();
        }
        if (property.type === "title" && property.title?.[0]?.text?.content) {
          return property.title[0].text.content;
        }
      }
    }
    return "Unknown";
  } catch (error) {
    console.error("Error extracting order number:", error);
    return "Unknown";
  }
}

// Функция для отметки уведомления как отправленного
async function markNotificationAsSent(pageId) {
  try {
    await notion.pages.update({
      page_id: pageId,
      properties: {
        NotificationSent: {
          checkbox: true,
        },
        Created: {
          date: {
            start: new Date().toISOString(),
          },
        },
      },
    });
    console.log(`✅ Notification marked as sent for page ${pageId}`);
  } catch (error) {
    console.error(`❌ Error marking notification as sent:`, error);
  }
}
// Функция для тестирования фильтров
export async function testFilters() {
  try {
    console.log("🧪 Testing filters...");

    // Тест 1: Завершенные заказы с ссылками
    const completedWithLinks = await queryCompletedOrdersWithLinks();
    console.log(`✅ Completed with links: ${completedWithLinks.length}`);

    // Тест 2: Все заказы (без фильтров)
    const allOrders = await notion.dataSources.query({
      data_source_id: config.NOTION.DATASOURCE_ID,
      page_size: 5,
    });
    console.log(`✅ Total orders in DB: ${allOrders.results.length}`);

    return {
      completedWithLinks: completedWithLinks.length,
      totalOrders: allOrders.results.length,
    };
  } catch (error) {
    console.error("❌ Error testing filters:", error);
    throw error;
  }
}

// Функция для получения информации о заказе по ID страницы
export async function getNotionPage(pageId) {
  try {
    const response = await notion.pages.retrieve({
      page_id: pageId,
    });

    return response;
  } catch (error) {
    console.error("❌ Error retrieving Notion page:", error);
    throw new Error(`Notion retrieve error: ${error.message}`);
  }
}

// ИСПРАВЛЕННАЯ функция для запроса данных - используем правильные методы
export async function queryDataSource() {
  try {
    console.log("🔍 Querying database...");

    // Получаем информацию о базе данных
    const databaseInfo = await notion.databases.retrieve({
      database_id: databaseId,
    });

    console.log("📊 Database title:", databaseInfo.title?.[0]?.plain_text);

    // ЗАМЕНИЛ на правильный метод - используем search или напрямую запрашиваем страницы
    const response = await notion.search({
      filter: {
        property: "object",
        value: "page",
      },
      sort: {
        direction: "descending",
        timestamp: "last_edited_time",
      },
    });

    console.log(`📄 Found ${response.results.length} pages`);

    // Если search не работает, попробуем альтернативный способ
    if (response.results.length === 0) {
      console.log("⚠️ No pages found via search, trying alternative method...");

      // Альтернативный способ - получить все страницы через базу данных
      const dbResponse = await notion.databases.query({
        database_id: databaseId,
      });

      return await processPagesData(dbResponse.results);
    }

    return await processPagesData(response.results);
  } catch (error) {
    console.error("❌ Error querying database:", error);

    // Если search не доступен, используем dataSources.query (как в оригинальном коде)
    try {
      console.log("🔄 Trying dataSources.query as fallback...");
      const lastOrder = await notion.dataSources.query({
        data_source_id: dataSourceId,
      });

      return await processPagesData(lastOrder.results);
    } catch (fallbackError) {
      console.error("❌ Fallback method also failed:", fallbackError);
      throw error;
    }
  }
}

// Вспомогательная функция для обработки данных страниц
export async function processPagesData(pages) {
  const allPagesData = pages.map((page, index) => {
    console.log(`\n=== Page ${index + 1} ===`);
    console.log("ID:", page.id);

    // Извлекаем данные для валидации
    const validationData = extractDataForValidation(page);

    if (validationData) {
      console.log("📋 Extracted properties:");
      Object.entries(validationData.properties).forEach(([key, value]) => {
        console.log(`- ${key}: ${value.value} (${value.type})`);
      });
    }

    return validationData;
  });

  return pages.length > 0 ? pages[0].properties : null;
}

// Альтернативный метод для получения данных из базы
export async function getDatabaseData() {
  try {
    // Прямой запрос к базе данных
    const response = await notion.databases.query({
      database_id: databaseId,
    });

    console.log(`📊 Found ${response.results.length} pages in database`);

    const formattedData = response.results.map((page) => {
      const validationData = extractDataForValidation(page);

      return {
        id: page.id,
        created: new Date(page.created_time).toLocaleString("ru-RU"),
        url: page.url,
        order: getPropertyValue(page.properties?.Order),
        quantity: getPropertyValue(page.properties?.quantity),
        geo: getPropertyValue(page.properties?.Geo),
        bank: getPropertyValue(page.properties?.Bank),
        status: getPropertyValue(page.properties?.Status),
        validationData: validationData,
      };
    });

    return formattedData;
  } catch (error) {
    console.error("❌ Error getting database data:", error);
    return [];
  }
}

export async function queryDataSourceOriginal() {
  try {
    console.log("🔍 Querying data source (original method)...");

    const lastOrder = await notion.dataSources.query({
      data_source_id: dataSourceId,
    });

    console.log(`📄 Found ${lastOrder.results.length} pages`);

    const allResults = [];

    lastOrder.results.forEach((page, index) => {
      const pageData = {
        id: page.id,
        properties: {},
      };

      // Собираем все свойства страницы
      Object.keys(page.properties).forEach((prop) => {
        const property = page.properties[prop];
        const value = getPropertyValue(property);
        pageData.properties[prop] = {
          value: value,
          type: property.type,
        };
      });

      allResults.push(pageData);
    });

    // Возвращаем все данные
    return allResults;
  } catch (error) {
    console.error("❌ Error in queryDataSourceOriginal:", error);
    throw error;
  }
}
