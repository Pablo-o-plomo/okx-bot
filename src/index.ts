import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import cron from 'node-cron';
import express from 'express';
import { config } from './config';
import { initDb, getOpenTrades, getLastNTrades, getRecentSignals, getPaperTradingBalance } from './database/db';
import { initTelegramBot, broadcastSignal, sendErrorAlert, recordScannerRun, broadcastScannerHeartbeat } from './telegram/bot';
import { analyzeSymbol } from './strategy/signalEngine';
import { checkRisk, calculatePositionSize } from './strategy/riskManager';
import { monitorOpenTrades } from './strategy/tradeManager';
import { saveSignal, saveTrade } from './database/db';
import { placeOrder } from './okx/trading';
import { sendDailyReport } from './reports/dailyReport';
import { runLearningAnalysis } from './reports/learningReport';
import { logger } from './utils/logger';
import type { IndicatorSnapshot, MarketPhase } from './database/models';

// ─── Init ──────────────────────────────────────────────────────────────────────

async function bootstrap(): Promise<void> {
  // Create logs dir
  fs.mkdirSync(path.join(process.cwd(), 'logs'), { recursive: true });

  logger.info('🚀 Starting OKX Trading Bot...');
  logger.info(`   OKX API mode: ${config.okx.isDemo ? 'DEMO' : 'LIVE'}`);
  logger.info(`   Trade execution: ${config.trading.isLive ? 'LIVE' : 'PAPER'}`);
  logger.info(`   Auto trade: ${config.trading.autoTrade ? 'ON' : 'OFF'}`);
  logger.info(`   🛡️ Risk Guard: ${config.trading.riskGuardEnabled ? 'enabled' : 'disabled'}`);
  logger.info(`   ⏸ Auto Pause on limit: ${config.trading.autoPauseOnLimit ? 'enabled' : 'disabled'}`);
  logger.info(`   Symbols: ${config.trading.symbols.join(', ')}`);
  logger.info(`   Timeframes: ${config.trading.timeframes.join(', ')}`);

  // 1. Database
  initDb();

  if (!config.trading.isLive) {
    logger.info(`   Paper start balance: ${config.trading.paperStartBalance.toFixed(2)} USDT`);
    logger.info(`   Paper trading balance: ${getPaperTradingBalance().toFixed(2)} USDT`);
  }

  // 2. Telegram bot
  initTelegramBot();

  // 3. Express health check
  const app = express();
  app.get('/health', (_, res) => res.json({
    status: 'ok',
    okxApiMode: config.okx.isDemo ? 'demo' : 'live',
    tradeExecution: config.trading.mode,
    autoTrade: config.trading.autoTrade,
  }));
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
  const newSignalsFound = Math.max(signalsAfter - signalsBefore, 0);

  recordScannerRun(
    config.trading.symbols.length,
    newSignalsFound,
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

  if (config.trading.isLive && !config.trading.autoTrade) {
    logger.info(`AUTO_TRADE=false; signal published without placing order for ${symbol}`);
    return false;
  }

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
      marketPhase: detectMarketPhase(signal.indicators),
      signalConfidence: signal.confidence,
      scannerScore: signal.confidence,
      volumeRatio: getVolumeRatio(signal.indicators),
      atrAtEntry: signal.indicators?.atr ?? 0,
      rsiAtEntry: signal.indicators?.rsi ?? 0,
      trendStrength: getTrendStrength(signal.indicators),
    });

    logger.info(`✅ Trade opened: ${signal.direction} ${signal.symbol} @ ${signal.entryPrice}`);
    return true;
  } catch (err: any) {
    logger.error(`Failed to open trade for ${symbol}: ${err.message}`);
    await sendErrorAlert(err.message, `Order placement: ${symbol}`);
    return false;
  }

}


function detectMarketPhase(indicators?: IndicatorSnapshot): MarketPhase {
  if (!indicators || !indicators.price) return 'UNKNOWN';

  const atrRatio = indicators.atr / indicators.price;
  const volumeRatio = getVolumeRatio({ ...indicators });

  if (atrRatio > 0.035) return 'HIGH_VOLATILITY';
  if (volumeRatio >= 1.5 && Math.abs(indicators.macdHistogram) > 0) return 'BREAKOUT';
  if (indicators.trend === 'bullish') return 'TREND_UP';
  if (indicators.trend === 'bearish') return 'TREND_DOWN';
  if (indicators.trend === 'neutral') return 'RANGE';

  return 'UNKNOWN';
}

function getVolumeRatio(indicators?: IndicatorSnapshot): number {
  if (!indicators?.volumeAvg) return 0;
  return parseFloat((indicators.volumeCurrent / indicators.volumeAvg).toFixed(4));
}

function getTrendStrength(indicators?: IndicatorSnapshot): number {
  if (!indicators?.price) return 0;
  const emaSpread = Math.abs(indicators.ema20 - indicators.ema200) / indicators.price;
  return parseFloat((emaSpread * 100).toFixed(4));
}


function detectMarketPhase(indicators?: IndicatorSnapshot): MarketPhase {
  if (!indicators || !indicators.price) return 'UNKNOWN';

  const atrRatio = indicators.atr / indicators.price;
  const volumeRatio = getVolumeRatio({ ...indicators });

  if (atrRatio > 0.035) return 'HIGH_VOLATILITY';
  if (volumeRatio >= 1.5 && Math.abs(indicators.macdHistogram) > 0) return 'BREAKOUT';
  if (indicators.trend === 'bullish') return 'TREND_UP';
  if (indicators.trend === 'bearish') return 'TREND_DOWN';
  if (indicators.trend === 'neutral') return 'RANGE';

  return 'UNKNOWN';
}

function getVolumeRatio(indicators?: IndicatorSnapshot): number {
  if (!indicators?.volumeAvg) return 0;
  return parseFloat((indicators.volumeCurrent / indicators.volumeAvg).toFixed(4));
}

function getTrendStrength(indicators?: IndicatorSnapshot): number {
  if (!indicators?.price) return 0;
  const emaSpread = Math.abs(indicators.ema20 - indicators.ema200) / indicators.price;
  return parseFloat((emaSpread * 100).toFixed(4));
}


function detectMarketPhase(indicators?: IndicatorSnapshot): MarketPhase {
  if (!indicators || !indicators.price) return 'UNKNOWN';

  const atrRatio = indicators.atr / indicators.price;
  const volumeRatio = getVolumeRatio({ ...indicators });

  if (atrRatio > 0.035) return 'HIGH_VOLATILITY';
  if (volumeRatio >= 1.5 && Math.abs(indicators.macdHistogram) > 0) return 'BREAKOUT';
  if (indicators.trend === 'bullish') return 'TREND_UP';
  if (indicators.trend === 'bearish') return 'TREND_DOWN';
  if (indicators.trend === 'neutral') return 'RANGE';

  return 'UNKNOWN';
}

function getVolumeRatio(indicators?: IndicatorSnapshot): number {
  if (!indicators?.volumeAvg) return 0;
  return parseFloat((indicators.volumeCurrent / indicators.volumeAvg).toFixed(4));
}

function getTrendStrength(indicators?: IndicatorSnapshot): number {
  if (!indicators?.price) return 0;
  const emaSpread = Math.abs(indicators.ema20 - indicators.ema200) / indicators.price;
  return parseFloat((emaSpread * 100).toFixed(4));
}


function detectMarketPhase(indicators?: IndicatorSnapshot): MarketPhase {
  if (!indicators || !indicators.price) return 'UNKNOWN';

  const atrRatio = indicators.atr / indicators.price;
  const volumeRatio = getVolumeRatio({ ...indicators });

  if (atrRatio > 0.035) return 'HIGH_VOLATILITY';
  if (volumeRatio >= 1.5 && Math.abs(indicators.macdHistogram) > 0) return 'BREAKOUT';
  if (indicators.trend === 'bullish') return 'TREND_UP';
  if (indicators.trend === 'bearish') return 'TREND_DOWN';
  if (indicators.trend === 'neutral') return 'RANGE';

  return 'UNKNOWN';
}

function getVolumeRatio(indicators?: IndicatorSnapshot): number {
  if (!indicators?.volumeAvg) return 0;
  return parseFloat((indicators.volumeCurrent / indicators.volumeAvg).toFixed(4));
}

function getTrendStrength(indicators?: IndicatorSnapshot): number {
  if (!indicators?.price) return 0;
  const emaSpread = Math.abs(indicators.ema20 - indicators.ema200) / indicators.price;
  return parseFloat((emaSpread * 100).toFixed(4));
}


function detectMarketPhase(indicators?: IndicatorSnapshot): MarketPhase {
  if (!indicators || !indicators.price) return 'UNKNOWN';

  const atrRatio = indicators.atr / indicators.price;
  const volumeRatio = getVolumeRatio({ ...indicators });

  if (atrRatio > 0.035) return 'HIGH_VOLATILITY';
  if (volumeRatio >= 1.5 && Math.abs(indicators.macdHistogram) > 0) return 'BREAKOUT';
  if (indicators.trend === 'bullish') return 'TREND_UP';
  if (indicators.trend === 'bearish') return 'TREND_DOWN';
  if (indicators.trend === 'neutral') return 'RANGE';

  return 'UNKNOWN';
}

function getVolumeRatio(indicators?: IndicatorSnapshot): number {
  if (!indicators?.volumeAvg) return 0;
  return parseFloat((indicators.volumeCurrent / indicators.volumeAvg).toFixed(4));
}

function getTrendStrength(indicators?: IndicatorSnapshot): number {
  if (!indicators?.price) return 0;
  const emaSpread = Math.abs(indicators.ema20 - indicators.ema200) / indicators.price;
  return parseFloat((emaSpread * 100).toFixed(4));
}


function detectMarketPhase(indicators?: IndicatorSnapshot): MarketPhase {
  if (!indicators || !indicators.price) return 'UNKNOWN';

  const atrRatio = indicators.atr / indicators.price;
  const volumeRatio = getVolumeRatio({ ...indicators });

  if (atrRatio > 0.035) return 'HIGH_VOLATILITY';
  if (volumeRatio >= 1.5 && Math.abs(indicators.macdHistogram) > 0) return 'BREAKOUT';
  if (indicators.trend === 'bullish') return 'TREND_UP';
  if (indicators.trend === 'bearish') return 'TREND_DOWN';
  if (indicators.trend === 'neutral') return 'RANGE';

  return 'UNKNOWN';
}

function getVolumeRatio(indicators?: IndicatorSnapshot): number {
  if (!indicators?.volumeAvg) return 0;
  return parseFloat((indicators.volumeCurrent / indicators.volumeAvg).toFixed(4));
}

function getTrendStrength(indicators?: IndicatorSnapshot): number {
  if (!indicators?.price) return 0;
  const emaSpread = Math.abs(indicators.ema20 - indicators.ema200) / indicators.price;
  return parseFloat((emaSpread * 100).toFixed(4));
}


function detectMarketPhase(indicators?: IndicatorSnapshot): MarketPhase {
  if (!indicators || !indicators.price) return 'UNKNOWN';

  const atrRatio = indicators.atr / indicators.price;
  const volumeRatio = getVolumeRatio({ ...indicators });

  if (atrRatio > 0.035) return 'HIGH_VOLATILITY';
  if (volumeRatio >= 1.5 && Math.abs(indicators.macdHistogram) > 0) return 'BREAKOUT';
  if (indicators.trend === 'bullish') return 'TREND_UP';
  if (indicators.trend === 'bearish') return 'TREND_DOWN';
  if (indicators.trend === 'neutral') return 'RANGE';

  return 'UNKNOWN';
}

function getVolumeRatio(indicators?: IndicatorSnapshot): number {
  if (!indicators?.volumeAvg) return 0;
  return parseFloat((indicators.volumeCurrent / indicators.volumeAvg).toFixed(4));
}

function getTrendStrength(indicators?: IndicatorSnapshot): number {
  if (!indicators?.price) return 0;
  const emaSpread = Math.abs(indicators.ema20 - indicators.ema200) / indicators.price;
  return parseFloat((emaSpread * 100).toFixed(4));
}


function detectMarketPhase(indicators?: IndicatorSnapshot): MarketPhase {
  if (!indicators || !indicators.price) return 'UNKNOWN';

  const atrRatio = indicators.atr / indicators.price;
  const volumeRatio = getVolumeRatio({ ...indicators });

  if (atrRatio > 0.035) return 'HIGH_VOLATILITY';
  if (volumeRatio >= 1.5 && Math.abs(indicators.macdHistogram) > 0) return 'BREAKOUT';
  if (indicators.trend === 'bullish') return 'TREND_UP';
  if (indicators.trend === 'bearish') return 'TREND_DOWN';
  if (indicators.trend === 'neutral') return 'RANGE';

  return 'UNKNOWN';
}

function getVolumeRatio(indicators?: IndicatorSnapshot): number {
  if (!indicators?.volumeAvg) return 0;
  return parseFloat((indicators.volumeCurrent / indicators.volumeAvg).toFixed(4));
}

function getTrendStrength(indicators?: IndicatorSnapshot): number {
  if (!indicators?.price) return 0;
  const emaSpread = Math.abs(indicators.ema20 - indicators.ema200) / indicators.price;
  return parseFloat((emaSpread * 100).toFixed(4));
}


function detectMarketPhase(indicators?: IndicatorSnapshot): MarketPhase {
  if (!indicators || !indicators.price) return 'UNKNOWN';

  const atrRatio = indicators.atr / indicators.price;
  const volumeRatio = getVolumeRatio({ ...indicators });

  if (atrRatio > 0.035) return 'HIGH_VOLATILITY';
  if (volumeRatio >= 1.5 && Math.abs(indicators.macdHistogram) > 0) return 'BREAKOUT';
  if (indicators.trend === 'bullish') return 'TREND_UP';
  if (indicators.trend === 'bearish') return 'TREND_DOWN';
  if (indicators.trend === 'neutral') return 'RANGE';

  return 'UNKNOWN';
}

function getVolumeRatio(indicators?: IndicatorSnapshot): number {
  if (!indicators?.volumeAvg) return 0;
  return parseFloat((indicators.volumeCurrent / indicators.volumeAvg).toFixed(4));
}

function getTrendStrength(indicators?: IndicatorSnapshot): number {
  if (!indicators?.price) return 0;
  const emaSpread = Math.abs(indicators.ema20 - indicators.ema200) / indicators.price;
  return parseFloat((emaSpread * 100).toFixed(4));
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
