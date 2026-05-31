console.log('🔥 BCS BUILD CHECK: bcs-bot-v1');
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import express from 'express';
import { config } from './config';
import { initBcsDb } from './bcs/db';
import { initTelegramBot, sendAdminMessage } from './telegram/bot';
import { logger } from './utils/logger';
import { BUILD_VERSION } from './version';

async function bootstrap(): Promise<void> {
  fs.mkdirSync(path.join(process.cwd(), 'logs'), { recursive: true });

  logger.info('🚀 Starting BCS Trading Assistant...');
  logger.info(`   Broker: ${config.app.broker}`);
  logger.info('   Mode: analytics only, no automatic trading');
  logger.info(`BUILD VERSION: ${BUILD_VERSION}`);

  initBcsDb();
  initTelegramBot();

  const app = express();
  app.get('/health', (_, res) => res.json({ status: 'ok', broker: config.app.broker, mode: 'analytics-only', build: BUILD_VERSION }));
  app.listen(config.server.port, () => logger.info(`🌐 Health check: http://localhost:${config.server.port}/health`));

  await sendAdminMessage(`✅ BCS Trading Assistant restarted\nMode: ANALYTICS ONLY\nBuild: ${BUILD_VERSION}`).catch((err: any) => {
    logger.warn(`Failed to send admin startup notification: ${err.message}`);
  });

  logger.info('✅ BCS Trading Assistant initialized');
}

bootstrap().catch((err: any) => {
  logger.error(`Fatal startup error: ${err.message}`);
  process.exit(1);
});
