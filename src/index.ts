console.log("🔥 LIVE BUILD CHECK: buttons-v6-2026-05-31-14-45");
console.log("🔥 BUILD VERSION 2.0.0-buttons-fix");
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import cron from 'node-cron';
import express from 'express';
import { config } from './config';
import { initDb, getLastNTrades } from './database/db';
import { initTelegramBot, broadcastSignal, broadcastTradeOpened, broadcastMessage, sendAdminMessage, sendErrorAlert } from './telegram/bot';
import { analyzeSymbol } from './strategy/signalEngine';
import { checkRisk, calculatePositionSize } from './strategy/riskManager';
import { monitorOpenTrades } from './strategy/tradeManager';
import { saveSignal, saveTrade } from './database/db';
import { placeOrder } from './okx/trading';
import { sendDailyReport } from './reports/dailyReport';
import { runLearningAnalysis } from './reports/learningReport';
import { generateMarketSummary } from './reports/marketSummary';
import { generateErrorAnalysis } from './reports/errorAnalysis';
import { generateHeartbeatReport } from './reports/heartbeat';
import { logger } from './utils/logger';
import { BUILD_VERSION } from './version';
import { recordSignalAccepted, recordSignalScanned } from './utils/runtimeMetrics';

// ─── Init ──────────────────────────────────────────────────────────────────────

async function bootstrap(): Promise<void> {
  // Create logs dir
  fs.mkdirSync(path.join(process.cwd(), 'logs'), { recursive: true });

  logger.info('🚀 Starting OKX Trading Bot...');
  logger.info(`   Mode: ${config.trading.isLive ? '🔴 LIVE' : '📄 PAPER'}`);
  logger.info(`   Symbols: ${config.trading.symbols.join(', ')}`);
  logger.info(`   Timeframes: ${config.trading.timeframes.join(', ')}`);

  // 1. Database
  initDb();

  // 2. Telegram bot
  initTelegramBot();

  // 3. Express health check
  const app = express();
  app.get('/health', (_, res) => res.json({ status: 'ok', mode: config.trading.isLive ? 'live' : 'paper' }));
  app.listen(config.server.port, () => logger.info(`🌐 Health check: http://localhost:${config.server.port}/health`));

  // 4. Start schedulers
  setupSchedulers();

  const startupMessage = `✅ Bot restarted
Mode: ${config.trading.isLive ? 'LIVE' : 'PAPER'}
Build: ${BUILD_VERSION}`;
  await sendAdminMessage(startupMessage).catch((err: any) => {
    logger.warn(`Failed to send admin startup notification: ${err.message}`);
  });

  if (config.telegram.sendStartupToChannel) {
    await broadcastMessage(startupMessage);
  }

  logger.info('✅ Bot fully initialized');
}

// ─── Scheduler ────────────────────────────────────────────────────────────────

function setupSchedulers(): void {
  // Signal scanning — every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    await runSignalScan();
  });

  // Trade monitoring — every minute
  cron.schedule('* * * * *', async () => {
    try {
      await monitorOpenTrades();
    } catch (err: any) {
      logger.error(`Monitor error: ${err.message}`);
    }
  });

  // Daily report — every day at 23:55
  cron.schedule('55 23 * * *', async () => {
    await sendDailyReport();
  });
  cron.schedule('0 9 * * *', async () => { await broadcastMessage(generateMarketSummary()); });

  // Admin heartbeat — every hour
  cron.schedule('5 * * * *', async () => {
    await sendAdminMessage(generateHeartbeatReport()).catch(() => {});
  });

  // Learning analysis — every 20 closed trades (checked every hour)
  cron.schedule('0 * * * *', async () => {
    const closed = getLastNTrades(20);
    if (closed.length >= 20 && closed.length % 20 === 0) {
      await runLearningAnalysis();
      const analysis = generateErrorAnalysis();
      if (analysis) await broadcastMessage(analysis);
    }
  });

  logger.info('⏰ Schedulers started');
}

// ─── Signal Scan ──────────────────────────────────────────────────────────────

async function runSignalScan(): Promise<void> {
  for (const symbol of config.trading.symbols) {
    recordSignalScanned();
    try {
      await processSymbol(symbol);
    } catch (err: any) {
      logger.error(`Error processing ${symbol}: ${err.message}`);
      await sendErrorAlert(err.message, `Signal scan: ${symbol}`).catch(() => {});
    }
  }
}

async function processSymbol(symbol: string): Promise<void> {
  const signal = await analyzeSymbol(symbol);
  if (!signal) return;
  recordSignalAccepted();

  // Risk check
  const riskCheck = await checkRisk(signal);
  if (!riskCheck.allowed) {
    logger.info(`⛔ Signal rejected for ${symbol}: ${riskCheck.reason}`);
    return;
  }

  // Calculate position size
  signal.positionSize = await calculatePositionSize(signal);
  if (signal.positionSize <= 0) {
    logger.warn(`Position size is 0 for ${symbol}, skipping`);
    return;
  }

  // Save signal to DB
  const signalId = saveSignal(signal);
  signal.id = signalId;

  // Broadcast to Telegram
  await broadcastSignal(signal);

  // Place paper/live order
  try {
    const order = await placeOrder(signal);
    logger.info(`📋 Order placed: ${order.orderId} (${order.paper ? 'paper' : 'live'})`);

    // Save trade
    const trade = {
      signalId,
      symbol: signal.symbol,
      direction: signal.direction,
      entryPrice: signal.entryPrice,
      stopLoss: signal.stopLoss,
      takeProfit1: signal.takeProfit1,
      takeProfit2: signal.takeProfit2,
      takeProfit3: signal.takeProfit3,
      positionSize: signal.positionSize,
      leverage: signal.leverage,
      status: 'open' as const,
      entryReasons: signal.reasons,
      indicatorsAtEntry: signal.indicators,
      progress: { tp1: false, tp2: false, tp3: false, breakeven: false, partiallyClosed: false },
    };
    const tradeId = saveTrade(trade);
    await broadcastTradeOpened({ ...trade, id: tradeId }, signal);

    logger.info(`✅ Trade opened: ${signal.direction} ${signal.symbol} @ ${signal.entryPrice}`);
  } catch (err: any) {
    logger.error(`Failed to open trade for ${symbol}: ${err.message}`);
    await sendErrorAlert(err.message, `Order placement: ${symbol}`);
  }
}

// ─── Unhandled errors ─────────────────────────────────────────────────────────

process.on('unhandledRejection', (reason: any) => {
  logger.error(`Unhandled rejection: ${reason?.message || reason}`);
  sendErrorAlert(reason?.message || String(reason), 'unhandledRejection').catch(() => {});
});

process.on('uncaughtException', (err) => {
  logger.error(`Uncaught exception: ${err.message}`);
  sendErrorAlert(err.message, 'uncaughtException').catch(() => {});
  // Don't exit — keep bot running
});

// ─── Boot ──────────────────────────────────────────────────────────────────────
bootstrap().catch(err => {
  logger.error(`Fatal startup error: ${err.message}`);
  process.exit(1);
});
