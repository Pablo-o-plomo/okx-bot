"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordScannerRun = recordScannerRun;
exports.initTelegramBot = initTelegramBot;
exports.getBot = getBot;
exports.broadcastSignal = broadcastSignal;
exports.broadcastTradeClosed = broadcastTradeClosed;
exports.broadcastTpHit = broadcastTpHit;
exports.sendErrorAlert = sendErrorAlert;
exports.broadcastScannerHeartbeat = broadcastScannerHeartbeat;
exports.broadcastMessage = broadcastMessage;
const node_telegram_bot_api_1 = __importDefault(require("node-telegram-bot-api"));
const config_1 = require("../config");
const logger_1 = require("../utils/logger");
const messages_1 = require("./messages");
const db_1 = require("../database/db");
const balance_1 = require("../utils/balance");
const riskManager_1 = require("../strategy/riskManager");
const dailyReport_1 = require("../reports/dailyReport");
const learningReport_1 = require("../reports/learningReport");
let bot;
const ADMIN_IDS = config_1.config.telegram.adminId ? [config_1.config.telegram.adminId] : [];
const scannerTelemetry = {
    checkedSymbols: config_1.config.trading.symbols.length,
    signalsFound: 0,
    openPositions: 0,
    lastScan: undefined,
};
function formatClock(date = new Date()) {
    return date.toISOString().slice(11, 16);
}
function recordScannerRun(checkedSymbols, signalsFound, openPositions) {
    scannerTelemetry.checkedSymbols = checkedSymbols;
    scannerTelemetry.signalsFound = signalsFound;
    scannerTelemetry.openPositions = openPositions;
    scannerTelemetry.lastScan = formatClock();
}
function initTelegramBot() {
    bot = new node_telegram_bot_api_1.default(config_1.config.telegram.botToken, { polling: true });
    if (ADMIN_IDS.length === 0) {
        logger_1.logger.warn('⚠️  TELEGRAM_ADMIN_ID not set — all admin commands are DISABLED. Set it in .env to enable /pause, /resume, /positions, /risk, etc.');
    }
    registerCommands();
    logger_1.logger.info('🤖 Telegram bot started');
    return bot;
}
function getBot() {
    if (!bot)
        throw new Error('Telegram bot not initialized');
    return bot;
}
function isAdmin(chatId) {
    if (ADMIN_IDS.length === 0)
        return false; // No admin configured = nobody is admin
    return ADMIN_IDS.includes(chatId);
}
function formatBalance(balance) {
    return balance === null ? 'unavailable' : `${balance.toFixed(2)} USDT`;
}
const MAIN_MENU_KEYBOARD = {
    keyboard: [
        [{ text: '📊 Статус' }, { text: '⏸ Пауза' }],
        [{ text: '▶️ Возобновить' }, { text: '📦 Позиции' }],
        [{ text: '📈 Сигналы' }, { text: '📋 Отчет' }],
        [{ text: '⚙️ Риск' }, { text: '🛡️ Риск-менеджмент' }],
        [{ text: '⏸ Автопауза' }, { text: '⚙️ Настройки риска' }],
        [{ text: '🧠 Анализ' }, { text: '🧠 Learning' }],
    ],
    resize_keyboard: true,
    is_persistent: true,
};
function registerCommands() {
    // /start
    bot.onText(/\/start/, async (msg) => {
        await sendStatus(msg.chat.id.toString());
    });
    // /balance
    bot.onText(/\/balance/, async (msg) => {
        if (!isAdmin(msg.chat.id.toString()))
            return;
        await sendBalance(msg.chat.id.toString());
    });
    // /signals
    bot.onText(/\/signals/, async (msg) => {
        await sendSignals(msg.chat.id.toString());
    });
    // /positions
    bot.onText(/\/positions/, async (msg) => {
        if (!isAdmin(msg.chat.id.toString()))
            return;
        await sendPositions(msg.chat.id.toString());
    });
    // /stats
    bot.onText(/\/stats/, async (msg) => {
        await sendStats(msg.chat.id.toString());
    });
    // /pause
    bot.onText(/\/pause/, (msg) => {
        if (!isAdmin(msg.chat.id.toString()))
            return;
        sendPause(msg.chat.id.toString());
    });
    // /resume
    bot.onText(/\/resume/, (msg) => {
        if (!isAdmin(msg.chat.id.toString()))
            return;
        sendResume(msg.chat.id.toString());
    });
    // /mode
    bot.onText(/\/mode/, async (msg) => {
        if (!isAdmin(msg.chat.id.toString()))
            return;
        await sendMode(msg.chat.id.toString());
    });
    // /risk
    bot.onText(/\/risk/, async (msg) => {
        if (!isAdmin(msg.chat.id.toString()))
            return;
        await sendRisk(msg.chat.id.toString());
    });
    // /reset-risk
    bot.onText(/\/reset-risk/, async (msg) => {
        if (!isAdmin(msg.chat.id.toString()))
            return;
        await sendResetRisk(msg.chat.id.toString());
    });
    // /report
    bot.onText(/\/report/, async (msg) => {
        if (!isAdmin(msg.chat.id.toString()))
            return;
        await sendReport(msg.chat.id.toString());
    });
    // /errors
    bot.onText(/\/errors/, async (msg) => {
        if (!isAdmin(msg.chat.id.toString()))
            return;
        await sendErrors(msg.chat.id.toString());
    });
    // /analyze (trigger learning report manually)
    bot.onText(/\/analyze/, async (msg) => {
        if (!isAdmin(msg.chat.id.toString()))
            return;
        await sendAnalyze(msg.chat.id.toString());
    });
    // /learning
    bot.onText(/\/learning/, async (msg) => {
        if (!isAdmin(msg.chat.id.toString()))
            return;
        await sendLearning(msg.chat.id.toString());
    });
    // Reply keyboard buttons
    bot.onText(/^📊 Статус$/, async (msg) => {
        await sendStatus(msg.chat.id.toString());
    });
    bot.onText(/^⏸ Пауза$/, (msg) => {
        if (!isAdmin(msg.chat.id.toString()))
            return;
        sendPause(msg.chat.id.toString());
    });
    bot.onText(/^▶️ Возобновить$/, (msg) => {
        if (!isAdmin(msg.chat.id.toString()))
            return;
        sendResume(msg.chat.id.toString());
    });
    bot.onText(/^📦 Позиции$/, async (msg) => {
        if (!isAdmin(msg.chat.id.toString()))
            return;
        await sendPositions(msg.chat.id.toString());
    });
    bot.onText(/^📈 Сигналы$/, async (msg) => {
        await sendSignals(msg.chat.id.toString());
    });
    bot.onText(/^📋 Отчет$/, async (msg) => {
        if (!isAdmin(msg.chat.id.toString()))
            return;
        await sendReport(msg.chat.id.toString());
    });
    bot.onText(/^⚙️ Риск$/, async (msg) => {
        if (!isAdmin(msg.chat.id.toString()))
            return;
        await sendRisk(msg.chat.id.toString());
    });
    bot.onText(/^🛡️ Риск-менеджмент$/, async (msg) => {
        if (!isAdmin(msg.chat.id.toString()))
            return;
        await sendRiskManagement(msg.chat.id.toString());
    });
    bot.onText(/^⏸ Автопауза$/, async (msg) => {
        if (!isAdmin(msg.chat.id.toString()))
            return;
        await sendAutoPauseToggle(msg.chat.id.toString());
    });
    bot.onText(/^⚙️ Настройки риска$/, async (msg) => {
        if (!isAdmin(msg.chat.id.toString()))
            return;
        await sendRiskSettings(msg.chat.id.toString());
    });
    bot.onText(/^🧠 Анализ$/, async (msg) => {
        if (!isAdmin(msg.chat.id.toString()))
            return;
        await sendAnalyze(msg.chat.id.toString());
    });
    bot.onText(/^🧠 Learning$/, async (msg) => {
        if (!isAdmin(msg.chat.id.toString()))
            return;
        await sendLearning(msg.chat.id.toString());
    });
    // Handle polling errors gracefully
    bot.on('polling_error', (err) => {
        logger_1.logger.error(`Telegram polling error: ${err.message}`);
    });
}
async function sendStatus(chatId) {
    const state = (0, db_1.getBotState)();
    const openTrades = (0, db_1.getOpenTrades)();
    const balanceView = await (0, balance_1.getBalanceView)();
    await send(chatId, (0, messages_1.formatStatusMessage)({
        okxApiMode: balanceView.okxApiMode,
        mode: balanceView.tradeMode,
        autoTrade: balanceView.autoTrade,
        isPaused: state.isPaused,
        openPositions: openTrades.length,
        balance: balanceView.tradingBalance,
        okxBalance: balanceView.okxBalance,
        consecutiveLosses: state.consecutiveLosses,
        pauseReason: state.pauseReason,
        symbolsCount: config_1.config.trading.symbols.length,
        timeframes: config_1.config.trading.timeframes,
        lastScan: scannerTelemetry.lastScan,
    }), true);
}
async function sendBalance(chatId) {
    const balanceView = await (0, balance_1.getBalanceView)();
    const okxLine = balanceView.tradeMode === 'LIVE' ? '' : `\nOKX balance: <b>${formatBalance(balanceView.okxBalance ?? null)}</b>`;
    await send(chatId, `
💰 <b>BALANCE</b>

${balanceView.tradeMode === 'LIVE' ? 'Balance' : 'Paper balance'}: <b>${formatBalance(balanceView.tradingBalance)}</b>${okxLine}
Mode: <b>${balanceView.tradeMode}</b>
`.trim(), true);
}
async function sendSignals(chatId) {
    const signals = (0, db_1.getRecentSignals)(5);
    if (signals.length === 0) {
        await send(chatId, '📈 <b>No recent signals</b>', true);
        return;
    }
    await send(chatId, (0, messages_1.formatSignalsListMessage)(signals), true);
}
async function sendPositions(chatId) {
    const trades = (0, db_1.getOpenTrades)();
    if (trades.length === 0) {
        await send(chatId, '📦 <b>No open positions</b>', true);
        return;
    }
    await send(chatId, (0, messages_1.formatPositionsMessage)(trades), true);
}
async function sendStats(chatId) {
    const trades = (0, db_1.getLastNTrades)(50);
    const closed = trades.filter(t => t.status !== 'open');
    if (closed.length === 0) {
        await send(chatId, '📊 <b>No closed trades</b>', true);
        return;
    }
    const wins = closed.filter(t => t.result === 'win');
    const winRate = (wins.length / closed.length) * 100;
    const totalPnl = closed.reduce((a, t) => a + (t.pnlPercent ?? 0), 0);
    const avgWin = wins.length > 0 ? wins.reduce((a, t) => a + (t.pnlPercent ?? 0), 0) / wins.length : 0;
    const losses = closed.filter(t => t.result === 'loss');
    const avgLoss = losses.length > 0 ? losses.reduce((a, t) => a + (t.pnlPercent ?? 0), 0) / losses.length : 0;
    await send(chatId, `
📊 <b>PERFORMANCE</b>

Trades: <b>${closed.length}</b>
Wins / Losses: <b>${wins.length} / ${losses.length}</b>
Winrate: <b>${winRate.toFixed(1)}%</b>
PNL: <b>${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}%</b>
Avg win/loss: <b>+${avgWin.toFixed(2)}% / ${avgLoss.toFixed(2)}%</b>
`.trim(), true);
}
function sendPause(chatId) {
    (0, riskManager_1.pauseBot)('Ручная остановка через Telegram');
    send(chatId, '⏸ Торговля поставлена на паузу. Новые сделки открываться не будут.', true);
}
function sendResume(chatId) {
    (0, riskManager_1.resumeBot)();
    send(chatId, '▶️ Торговля возобновлена. Сканер снова проверяет рынок каждые 5 минут.', true);
}
async function sendMode(chatId) {
    await send(chatId, `
⚙️ <b>MODE</b>

OKX API mode: <b>${config_1.config.okx.isDemo ? 'DEMO' : 'LIVE'}</b>
Trade execution: <b>${config_1.config.trading.isLive ? 'LIVE' : 'PAPER'}</b>
Auto trade: <b>${config_1.config.trading.autoTrade ? 'ON' : 'OFF'}</b>
`.trim(), true);
}
function riskOnOff(value) {
    return value ? 'ВКЛ' : 'ВЫКЛ';
}
function riskManagementText() {
    const state = (0, db_1.getBotState)();
    const dailyRisk = (0, riskManager_1.getDailyRiskSnapshot)();
    const settings = (0, riskManager_1.getRiskGuardSettings)();
    return `
🛡️ <b>Риск-менеджмент: ${riskOnOff(settings.riskGuardEnabled)}</b>
Автопауза при лимитах: <b>${riskOnOff(settings.autoPauseOnLimit)}</b>
Риск на сделку: <b>${settings.riskPerTrade}%</b>
Макс. дневной убыток: <b>${settings.maxDailyLoss}%</b>
Макс. убытков подряд: <b>${settings.maxLossStreak}</b>
Текущий дневной убыток: <b>${dailyRisk.dailyLossPercent.toFixed(2)}%</b>
Убытков подряд сейчас: <b>${state.consecutiveLosses}</b>
`.trim();
}
async function sendRisk(chatId) {
    const state = (0, db_1.getBotState)();
    const dailyRisk = (0, riskManager_1.getDailyRiskSnapshot)();
    const settings = (0, riskManager_1.getRiskGuardSettings)();
    const riskLockOn = settings.autoPauseOnLimit && dailyRisk.isLimitReached && state.isPaused;
    const tradeLines = dailyRisk.trades.length > 0
        ? dailyRisk.trades.slice(0, 4).map(trade => `• #${trade.id} ${trade.symbol} ${trade.direction} ${trade.pnlPercent && trade.pnlPercent >= 0 ? '+' : ''}${(trade.pnlPercent ?? 0).toFixed(2)}%`).join('\n')
        : '—';
    await send(chatId, `
📊 <b>Risk Status</b>

Mode: <b>${dailyRisk.mode}</b>
Risk Guard: <b>${settings.riskGuardEnabled ? 'ON' : 'OFF'}</b>
Auto Pause: <b>${settings.autoPauseOnLimit ? 'ON' : 'OFF'}</b>
Daily Net PnL: <b>${dailyRisk.dailyPnlPercent >= 0 ? '+' : ''}${dailyRisk.dailyPnlPercent.toFixed(2)}%</b>
Closed Trades Today: <b>${dailyRisk.closedTradesCount}</b>
Risk Lock: <b>${riskLockOn ? 'ON' : 'OFF'}</b>
Paused Until: <b>${state.pausedUntil ?? '—'}</b>
Daily Limit: <b>${settings.maxDailyLoss}%</b>
Loss streak: <b>${state.consecutiveLosses} / ${settings.maxLossStreak}</b>
Daily limit behavior: <b>${dailyRisk.behavior}</b>
Reason: <b>${riskLockOn ? (state.pauseReason ?? '—') : '—'}</b>

Trades:
${tradeLines}
`.trim(), true);
}
async function sendRiskManagement(chatId) {
    await send(chatId, riskManagementText(), true);
}
async function sendRiskSettings(chatId) {
    const settings = (0, riskManager_1.getRiskGuardSettings)();
    await send(chatId, `
⚙️ <b>Настройки риска</b>

Risk Guard: <b>${settings.riskGuardEnabled ? 'ON' : 'OFF'}</b>
Auto Pause: <b>${settings.autoPauseOnLimit ? 'ON' : 'OFF'}</b>
Risk per trade: <b>${settings.riskPerTrade}%</b>
Max daily loss: <b>${settings.maxDailyLoss}%</b>
Max loss streak: <b>${settings.maxLossStreak}</b>
`.trim(), true);
}
async function sendAutoPauseToggle(chatId) {
    const enabled = (0, riskManager_1.toggleAutoPauseOnLimit)();
    await send(chatId, `
⏸ <b>Автопауза при лимитах: ${riskOnOff(enabled)}</b>

Риск-менеджмент: <b>${riskOnOff((0, riskManager_1.getRiskGuardSettings)().riskGuardEnabled)}</b>
`.trim(), true);
}
async function sendResetRisk(chatId) {
    if (config_1.config.trading.isLive) {
        await send(chatId, '🧯 <b>Reset unavailable</b>\n\nPaper mode only.', true);
        return;
    }
    const snapshot = (0, riskManager_1.resetDailyRiskLock)();
    await send(chatId, `
🧯 <b>RISK RESET</b>

Mode: <b>PAPER</b>
Daily lock: <b>cleared</b>
Closed today: <b>${snapshot.closedTradesCount}</b>
Realized PnL: <b>${snapshot.dailyPnlPercent >= 0 ? '+' : ''}${snapshot.dailyPnlPercent.toFixed(2)}%</b>
`.trim(), true);
}
async function sendReport(chatId) {
    try {
        const report = await (0, dailyReport_1.generateDailyReport)();
        await send(chatId, report, true);
    }
    catch (err) {
        logger_1.logger.error(`Report error: ${err.message}`);
        await send(chatId, '📋 <b>Report unavailable</b>\n\nTry again later.', true);
    }
}
async function sendErrors(chatId) {
    const trades = (0, db_1.getLastNTrades)(20).filter(t => t.result === 'loss');
    if (trades.length === 0) {
        await send(chatId, '✅ <b>No loss patterns</b>', true);
        return;
    }
    const tagCounts = {};
    for (const t of trades) {
        for (const tag of t.errorTags ?? []) {
            tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;
        }
    }
    const sorted = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 3);
    const text = sorted.map(([tag, count]) => `• ${tag.replace(/_/g, ' ')}: ${count}x`).join('\n');
    await send(chatId, `⚠️ <b>LOSS PATTERNS</b>\n\n${text}`, true);
}
async function sendAnalyze(chatId) {
    try {
        const report = (0, learningReport_1.generateLearningReport)(20);
        if (report) {
            await send(chatId, (0, messages_1.formatLearningReport)(report), true);
        }
        else {
            const completedTrades = (0, db_1.getLastNTrades)(10).filter(t => t.status !== 'open').length;
            await send(chatId, (0, messages_1.formatLearningInProgressMessage)(completedTrades), true);
        }
    }
    catch (err) {
        logger_1.logger.error(`AI analysis error: ${err.message}`);
        await send(chatId, '🧠 <b>AI unavailable</b>\n\nTry again later.', true);
    }
}
async function sendLearning(chatId) {
    try {
        const dashboard = (0, learningReport_1.generateLearningDashboard)(100);
        await send(chatId, (0, messages_1.formatLearningDashboard)(dashboard), true);
    }
    catch (err) {
        logger_1.logger.error(`Learning dashboard error: ${err.message}`);
        await send(chatId, '🧠 <b>Learning unavailable</b>\n\nTry again later.', true);
    }
}
// ─── Outbound helpers ─────────────────────────────────────────────────────────
async function send(chatId, text, withMenu = false) {
    try {
        const options = {
            parse_mode: 'HTML',
            disable_web_page_preview: true,
        };
        if (withMenu) {
            options.reply_markup = MAIN_MENU_KEYBOARD;
        }
        await bot.sendMessage(chatId, text, options);
    }
    catch (err) {
        logger_1.logger.error(`Failed to send Telegram message: ${err.message}`);
    }
}
async function broadcastSignal(signal) {
    await send(config_1.config.telegram.chatId, (0, messages_1.formatSignalMessage)(signal));
}
async function broadcastTradeClosed(trade, improvements) {
    await send(config_1.config.telegram.chatId, (0, messages_1.formatTradeClosedMessage)(trade, improvements));
}
async function broadcastTpHit(trade, level, price, stopMovedToBreakeven = false) {
    const text = (0, messages_1.formatTpUpdateMessage)(trade, level, price, stopMovedToBreakeven);
    await send(config_1.config.telegram.chatId, text);
}
async function sendErrorAlert(error, context) {
    if (!config_1.config.telegram.adminId) {
        logger_1.logger.error(`Telegram admin alert skipped: ${context ? `${context}: ` : ''}${error}`);
        return;
    }
    await send(config_1.config.telegram.adminId, (0, messages_1.formatErrorAlert)(error, context));
}
async function broadcastScannerHeartbeat() {
    await send(config_1.config.telegram.chatId, (0, messages_1.formatHeartbeatMessage)(scannerTelemetry));
}
async function broadcastMessage(text) {
    await send(config_1.config.telegram.chatId, text);
}
//# sourceMappingURL=bot.js.map