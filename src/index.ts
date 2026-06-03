import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import cron from 'node-cron';
import express from 'express';
import { config } from './config';
import { initDb, getOpenTrades, getLastNTrades, getRecentSignals } from './database/db';
import { initTelegramBot, broadcastSignal, sendErrorAlert, recordScannerRun, broadcastScannerHeartbeat } from './telegram/bot';
import { analyzeSymbol } from './strategy/signalEngine';
import { checkRisk, calculatePositionSize } from './strategy/riskManager';
import { monitorOpenTrades } from './strategy/tradeManager';
import { saveSignal, saveTrade } from './database/db';
import { placeOrder } from './okx/trading';
import { sendDailyReport } from './reports/dailyReport';
import { runLearningAnalysis } from './reports/learningReport';
import { logger } from './utils/logger';

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

  // Learning analysis — every 20 closed trades (checked every hour)
  cron.schedule('0 * * * *', async () => {
    const closed = getLastNTrades(20);
    if (closed.length >= 20 && closed.length % 20 === 0) {
      await runLearningAnalysis();
    }
  });

  // Premium feed heartbeat — every 30 minutes
  cron.schedule('*/30 * * * *', async () => {
    await broadcastScannerHeartbeat();
  });

  logger.info('⏰ Schedulers started');
}

// ─── Signal Scan ──────────────────────────────────────────────────────────────

async function runSignalScan(): Promise<void> {
  const signalsBefore = getRecentSignals(100).length;

  for (const symbol of config.trading.symbols) {
    try {
      if (await processSymbol(symbol)) {
        signalsFound += 1;
      }
    } catch (err: any) {
      logger.error(`Error processing ${symbol}: ${err.message}`);
      await sendErrorAlert(err.message, `Signal scan: ${symbol}`).catch(() => {});
    }
  }

  const signalsAfter = getRecentSignals(100).length;
  recordScannerRun(
    config.trading.symbols.length,
    Math.max(signalsAfter - signalsBefore, 0),
    getOpenTrades().length,
  );
}

async function processSymbol(symbol: string): Promise<boolean> {
  const signal = await analyzeSymbol(symbol);
  if (!signal) return false;

  // Risk check
  const riskCheck = await checkRisk(signal);
  if (!riskCheck.allowed) {
    logger.info(`⛔ Signal rejected for ${symbol}: ${riskCheck.reason}`);
    return false;
  }

  // Calculate position size
  signal.positionSize = await calculatePositionSize(signal);
  if (signal.positionSize <= 0) {
    logger.warn(`Position size is 0 for ${symbol}, skipping`);
    return false;
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
    saveTrade({
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
      status: 'open',
      entryReasons: signal.reasons,
      indicatorsAtEntry: signal.indicators,
    });

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
