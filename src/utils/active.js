// ========== МЕНЕДЖЕР АКТИВНОСТИ ==========

import { Telegraf } from 'telegraf';

export default class EnhancedActivityManager {
  constructor(bot) {
    if (!(bot instanceof Telegraf)) {
      throw new Error('Bot instance must be provided');
    }
    
    this.bot = bot;
    this.isActive = true;
    this.lastActivity = Date.now();
    this.phantomIntervals = [];
    this.healthCheckInterval = null;
    this.restartAttempts = 0;
    this.maxRestartAttempts = 5;
  }

  recordActivity() {
    this.lastActivity = Date.now();
    if (!this.isActive) {
      this.isActive = true;
      this.restartAttempts = 0;
      console.log('🔄 Bot became active again');
    }
  }

  async healthCheck() {
    try {
      const me = await this.bot.telegram.getMe();
      this.recordActivity();
      
      const inactiveTime = Math.floor((Date.now() - this.lastActivity) / 1000);
      if (inactiveTime > 1800) {
        console.log('⚠️ Bot seems inactive, performing soft restart...');
        await this.softRestart();
      }
      
      return true;
    } catch (error) {
      console.error('❌ Health check failed:', error);
      return false;
    }
  }

  async softRestart() {
    if (this.restartAttempts >= this.maxRestartAttempts) {
      console.error('🚨 Max restart attempts reached, stopping bot...');
      process.exit(1);
    }

    this.restartAttempts++;
    console.log(`🔄 Soft restart attempt ${this.restartAttempts}`);

    try {
      this.restartBotComponents();
      await this.bot.telegram.getMe();
      console.log('✅ Soft restart completed successfully');
      this.restartAttempts = 0;
    } catch (error) {
      console.error('❌ Soft restart failed:', error);
    }
  }

  startEnhancedPhantomActivity() {
    console.log('👻 Starting enhanced phantom activity manager');
    
    const consoleInterval = setInterval(() => {
      const uptime = Math.floor(process.uptime());
      const inactiveTime = Math.floor((Date.now() - this.lastActivity) / 1000);
      const memoryUsage = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
      
      console.log(`🤖 Bot status: ${uptime}s uptime, ${inactiveTime}s inactive, ${memoryUsage}MB memory`);
    }, 60000);

    const healthInterval = setInterval(async () => {
      const isHealthy = await this.healthCheck();
      if (!isHealthy) {
        console.log('💔 Bot health check failed');
      } else {
        console.log('💓 Bot heartbeat - healthy');
      }
    }, 300000);

    const lightActivityInterval = setInterval(async () => {
      try {
        await this.bot.telegram.getMe();
        this.recordActivity();
      } catch (error) {
        console.log('⚠️ Light activity check failed');
      }
    }, 120000);

    this.phantomIntervals = [consoleInterval, healthInterval, lightActivityInterval];
    
    return {
      stop: () => {
        this.phantomIntervals.forEach(interval => clearInterval(interval));
        if (this.healthCheckInterval) clearInterval(this.healthCheckInterval);
        console.log('🛑 Enhanced phantom activity stopped');
      }
    };
  }

  restartBotComponents() {
    console.log('🔄 Restarting bot components...');
    
    if (global.stopPaymentChecking && global.startPaymentChecking) {
      global.stopPaymentChecking();
      global.startPaymentChecking();
    }
    if (global.stopAutoChecking && global.startAutoChecking) {
      global.stopAutoChecking();
      global.startAutoChecking(15);
    }
    
    console.log('✅ Bot components restarted');
  }
}

