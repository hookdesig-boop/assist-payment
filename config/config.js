import dotenv from 'dotenv';
dotenv.config();

export default {
  TELEGRAM_BOT_TOKEN: process.env.BOT_TOKEN,
  PRICES: process.env.PRODUCT_PRICE,
  
  NOTION: {
    API_KEY: process.env.NOTION_API_KEY,
    DATABASE_ID: process.env.NOTION_DATABASE_ID,
    DATASOURCE_ID: process.env.NOTION_DATA_SOURCE
  },
  
  CRYPTO_BOT: {
    API_KEY: process.env.CRYPTOBOT_API_TOKEN,
    SHOP_ID: process.env.CRYPTO_BOT_SHOP_ID,
    USER_NAME: process.env.BOT_USERNAME
  },
  
  PRICES: {
    ADAPTATION: process.env.PRODUCT_PRICE
  }
};