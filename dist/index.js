"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const node_cron_1 = __importDefault(require("node-cron"));
const express_1 = __importDefault(require("express"));
const config_1 = require("./config");
const db_1 = require("./database/db");
const bot_1 = require("./telegram/bot");
const signalEngine_1 = require("./strategy/signalEngine");
const riskManager_1 = require("./strategy/riskManager");
const tradeManager_1 = require("./strategy/tradeManager");
const db_2 = require("./database/db");
const trading_1 = require("./okx/trading");
const dailyReport_1 = require("./reports/dailyReport");
const learningReport_1 = require("./reports/learningReport");
const logger_1 = require("./utils/logger");
// ─── Init ──────────────────────────────────────────────────────────────────────
async function bootstrap() {
    // Create logs dir
    fs_1.default.mkdirSync(path_1.default.join(process.cwd(), 'logs'), { recursive: true });
    logger_1.logger.info('🚀 Starting OKX Trading Bot...');
    logger_1.logger.info(`   OKX API mode: ${config_1.config.okx.isDemo ? 'DEMO' : 'LIVE'}`);
    logger_1.logger.info(`   Trade execution: ${config_1.config.trading.isLive ? 'LIVE' : 'PAPER'}`);
    logger_1.logger.info(`   Auto trade: ${config_1.config.trading.autoTrade ? 'ON' : 'OFF'}`);
    logger_1.logger.info(`   🛡️ Risk Guard: ${config_1.config.trading.riskGuardEnabled ? 'enabled' : 'disabled'}`);
    logger_1.logger.info(`   ⏸ Auto Pause on limit: ${config_1.config.trading.autoPauseOnLimit ? 'enabled' : 'disabled'}`);
    logger_1.logger.info(`   Symbols: ${config_1.config.trading.symbols.join(', ')}`);
    logger_1.logger.info(`   Timeframes: ${config_1.config.trading.timeframes.join(', ')}`);
    // 1. Database
    (0, db_1.initDb)();
    if (!config_1.config.trading.isLive) {
        logger_1.logger.info(`   Paper start balance: ${config_1.config.trading.paperStartBalance.toFixed(2)} USDT`);
        logger_1.logger.info(`   Paper trading balance: ${(0, db_1.getPaperTradingBalance)().toFixed(2)} USDT`);
    }
    // 2. Telegram bot
    (0, bot_1.initTelegramBot)();
    // 3. Express health check
    const app = (0, express_1.default)();
    app.get('/health', (_, res) => res.json({
        status: 'ok',
        okxApiMode: config_1.config.okx.isDemo ? 'demo' : 'live',
        tradeExecution: config_1.config.trading.mode,
        autoTrade: config_1.config.trading.autoTrade,
    }));
    app.listen(config_1.config.server.port, () => logger_1.logger.info(`🌐 Health check: http://localhost:${config_1.config.server.port}/health`));
    // 4. Start schedulers
    setupSchedulers();
    logger_1.logger.info('✅ Bot fully initialized');
}
// ─── Scheduler ────────────────────────────────────────────────────────────────
function setupSchedulers() {
    // Signal scanning — every 5 minutes
    node_cron_1.default.schedule('*/5 * * * *', async () => {
        await runSignalScan();
    });
    // Trade monitoring — every minute
    node_cron_1.default.schedule('* * * * *', async () => {
        try {
            await (0, tradeManager_1.monitorOpenTrades)();
        }
        catch (err) {
            logger_1.logger.error(`Monitor error: ${err.message}`);
        }
    });
    // Daily report — every day at 23:55
    node_cron_1.default.schedule('55 23 * * *', async () => {
        await (0, dailyReport_1.sendDailyReport)();
    });
    // Learning analysis — triggered when 20+ new closed trades accumulate since last run
    node_cron_1.default.schedule('0 * * * *', async () => {
        const lastId = (0, db_1.getLastAnalyzedTradeId)();
        const newClosed = (0, db_1.countNewClosedTrades)(lastId);
        if (newClosed >= 20) {
            const maxId = (0, db_1.getMaxClosedTradeId)();
            logger_1.logger.info(`📚 Learning analysis triggered: ${newClosed} new closed trades since trade #${lastId}`);
            try {
                await (0, learningReport_1.runLearningAnalysis)();
                (0, db_1.setLastAnalyzedTradeId)(maxId);
                logger_1.logger.info(`📚 Learning marker updated to trade #${maxId}`);
            }
            catch (err) {
                logger_1.logger.error(`📚 Learning analysis failed: ${err.message}`);
            }
        }
    });
    // Premium feed heartbeat — every 30 minutes
    node_cron_1.default.schedule('*/30 * * * *', async () => {
        await (0, bot_1.broadcastScannerHeartbeat)();
    });
    logger_1.logger.info('⏰ Schedulers started');
}
// ─── Signal Scan ──────────────────────────────────────────────────────────────
async function runSignalScan() {
    const signalsBefore = (0, db_1.getRecentSignals)(100).length;
    for (const symbol of config_1.config.trading.symbols) {
        try {
            await processSymbol(symbol);
        }
        catch (err) {
            logger_1.logger.error(`Error processing ${symbol}: ${err.message}`);
            await (0, bot_1.sendErrorAlert)(err.message, `Signal scan: ${symbol}`).catch(() => { });
        }
    }
    const signalsAfter = (0, db_1.getRecentSignals)(100).length;
    const newSignalsFound = Math.max(signalsAfter - signalsBefore, 0);
    (0, bot_1.recordScannerRun)(config_1.config.trading.symbols.length, newSignalsFound, (0, db_1.getOpenTrades)().length);
}
async function processSymbol(symbol) {
    const signal = await (0, signalEngine_1.analyzeSymbol)(symbol);
    if (!signal)
        return false;
    // Risk check
    const riskCheck = await (0, riskManager_1.checkRisk)(signal);
    if (!riskCheck.allowed) {
        logger_1.logger.info(`⛔ Signal rejected for ${symbol}: ${riskCheck.reason}`);
        return false;
    }
    // Calculate position size
    signal.positionSize = await (0, riskManager_1.calculatePositionSize)(signal);
    if (signal.positionSize <= 0) {
        logger_1.logger.warn(`⚠️ Position size 0 for ${symbol} — signal skipped (balance too low for minimum contract size or slDistance=0)`);
        return false;
    }
    // Save signal to DB
    const signalId = (0, db_2.saveSignal)(signal);
    signal.id = signalId;
    // Broadcast to Telegram
    await (0, bot_1.broadcastSignal)(signal);
    if (config_1.config.trading.isLive && !config_1.config.trading.autoTrade) {
        logger_1.logger.info(`AUTO_TRADE=false; signal published without placing order for ${symbol}`);
        return false;
    }
    // Place paper/live order
    try {
        const order = await (0, trading_1.placeOrder)(signal);
        logger_1.logger.info(`📋 Order placed: ${order.orderId} (${order.paper ? 'paper' : 'live'})`);
        // Save trade
        (0, db_2.saveTrade)({
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
        logger_1.logger.info(`✅ Trade opened: ${signal.direction} ${signal.symbol} @ ${signal.entryPrice}`);
        return true;
    }
    catch (err) {
        logger_1.logger.error(`Failed to open trade for ${symbol}: ${err.message}`);
        await (0, bot_1.sendErrorAlert)(err.message, `Order placement: ${symbol}`);
        return false;
    }
}
function detectMarketPhase(indicators) {
    if (!indicators || !indicators.price)
        return 'UNKNOWN';
    const atrRatio = indicators.atr / indicators.price;
    const volumeRatio = getVolumeRatio({ ...indicators });
    if (atrRatio > 0.035)
        return 'HIGH_VOLATILITY';
    if (volumeRatio >= 1.5 && Math.abs(indicators.macdHistogram) > 0)
        return 'BREAKOUT';
    if (indicators.trend === 'bullish')
        return 'TREND_UP';
    if (indicators.trend === 'bearish')
        return 'TREND_DOWN';
    if (indicators.trend === 'neutral')
        return 'RANGE';
    return 'UNKNOWN';
}
function getVolumeRatio(indicators) {
    if (!indicators?.volumeAvg)
        return 0;
    return parseFloat((indicators.volumeCurrent / indicators.volumeAvg).toFixed(4));
}
function getTrendStrength(indicators) {
    if (!indicators?.price || indicators.ema200 === null)
        return 0;
    const emaSpread = Math.abs(indicators.ema20 - indicators.ema200) / indicators.price;
    return parseFloat((emaSpread * 100).toFixed(4));
}
// ─── Unhandled errors ─────────────────────────────────────────────────────────
process.on('unhandledRejection', (reason) => {
    logger_1.logger.error(`Unhandled rejection: ${reason?.message || reason}`);
    (0, bot_1.sendErrorAlert)(reason?.message || String(reason), 'unhandledRejection').catch(() => { });
});
process.on('uncaughtException', (err) => {
    logger_1.logger.error(`Uncaught exception: ${err.message}`);
    (0, bot_1.sendErrorAlert)(err.message, 'uncaughtException').catch(() => { });
    process.exit(1);
});
// ─── Boot ──────────────────────────────────────────────────────────────────────
bootstrap().catch(err => {
    logger_1.logger.error(`Fatal startup error: ${err.message}`);
    process.exit(1);
});
//# sourceMappingURL=index.js.map