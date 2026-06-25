"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRiskGuardSettings = getRiskGuardSettings;
exports.toggleAutoPauseOnLimit = toggleAutoPauseOnLimit;
exports.getDailyRiskSnapshot = getDailyRiskSnapshot;
exports.checkRisk = checkRisk;
exports.calculatePositionSize = calculatePositionSize;
exports.recordTradeResult = recordTradeResult;
exports.pauseBot = pauseBot;
exports.resumeBot = resumeBot;
exports.resetDailyRiskLock = resetDailyRiskLock;
const config_1 = require("../config");
const db_1 = require("../database/db");
const balance_1 = require("../utils/balance");
const market_1 = require("../okx/market");
const logger_1 = require("../utils/logger");
let autoPauseOnLimit = config_1.config.trading.autoPauseOnLimit;
function todayIso() {
    return new Date().toISOString().split('T')[0];
}
function nextTradingDayIso() {
    const tomorrow = new Date();
    tomorrow.setUTCHours(24, 0, 0, 0);
    return tomorrow.toISOString();
}
function isRiskLimitPause(reason) {
    if (!reason)
        return false;
    const normalized = reason.toLowerCase();
    return normalized.includes('дневной лимит убытка')
        || normalized.includes('daily loss limit')
        || normalized.includes('daily risk lock')
        || normalized.includes('убыточных сделок подряд')
        || normalized.includes('loss streak')
        || normalized.includes('risk limit');
}
function dailyRiskBehavior() {
    if (!config_1.config.trading.riskGuardEnabled)
        return 'OFF';
    return autoPauseOnLimit ? 'AUTO PAUSE' : 'WARNING ONLY';
}
function logRiskLimit(limit) {
    logger_1.logger.warn(`⚠️ Risk limit reached: ${limit}`);
    if (autoPauseOnLimit) {
        logger_1.logger.warn('⏸ Auto-pause enabled, trading paused');
    }
    else {
        logger_1.logger.warn('⚠️ Auto-pause disabled, trading continues');
    }
}
function clearRiskLimitPauseIfNeeded(state = (0, db_1.getBotState)()) {
    if (isRiskLimitPause(state.pauseReason)) {
        (0, db_1.updateBotState)({ isPaused: false, pausedUntil: undefined, pauseReason: undefined });
    }
}
function getRiskGuardSettings() {
    return {
        riskGuardEnabled: config_1.config.trading.riskGuardEnabled,
        autoPauseOnLimit,
        riskPerTrade: config_1.config.trading.riskPerTrade,
        maxDailyLoss: config_1.config.trading.maxDailyLoss,
        maxLossStreak: config_1.config.trading.maxLossesInRow,
    };
}
function toggleAutoPauseOnLimit() {
    autoPauseOnLimit = !autoPauseOnLimit;
    logger_1.logger.warn(`⏸ Auto Pause on limit: ${autoPauseOnLimit ? 'enabled' : 'disabled'}`);
    return autoPauseOnLimit;
}
function getDailyRiskSnapshot() {
    const trades = (0, db_1.getTodayClosedTrades)();
    const dailyPnlPercent = trades.reduce((sum, trade) => sum + (trade.pnlPercent ?? 0), 0);
    const dailyLossPercent = Math.max(-dailyPnlPercent, 0);
    return {
        tradingDay: todayIso(),
        dailyPnlPercent,
        dailyLossPercent,
        closedTradesCount: trades.length,
        trades,
        isLimitReached: dailyPnlPercent <= -config_1.config.trading.maxDailyLoss,
        mode: config_1.config.trading.isLive ? 'LIVE' : 'PAPER',
        behavior: dailyRiskBehavior(),
    };
}
function syncDailyRiskState() {
    const snapshot = getDailyRiskSnapshot();
    const state = (0, db_1.getBotState)();
    const updates = {
        dailyLossPercent: snapshot.dailyLossPercent,
        lastDailyReset: snapshot.tradingDay,
    };
    if (state.lastDailyReset !== snapshot.tradingDay) {
        updates.consecutiveLosses = 0;
    }
    if (isRiskLimitPause(state.pauseReason)
        && (!config_1.config.trading.riskGuardEnabled || !autoPauseOnLimit || !snapshot.isLimitReached || state.lastDailyReset !== snapshot.tradingDay)) {
        updates.isPaused = false;
        updates.pausedUntil = undefined;
        updates.pauseReason = undefined;
    }
    (0, db_1.updateBotState)(updates);
    return snapshot;
}
function handleDailyRiskLimit(snapshot) {
    logRiskLimit(`daily loss ${snapshot.dailyLossPercent.toFixed(2)}/${config_1.config.trading.maxDailyLoss}%`);
    if (!autoPauseOnLimit) {
        clearRiskLimitPauseIfNeeded();
        return { allowed: true };
    }
    const pausedUntil = nextTradingDayIso();
    (0, db_1.updateBotState)({
        isPaused: true,
        pausedUntil,
        pauseReason: `Дневной лимит убытка ${config_1.config.trading.maxDailyLoss}% достигнут`,
        dailyLossPercent: snapshot.dailyLossPercent,
        lastDailyReset: snapshot.tradingDay,
    });
    return {
        allowed: false,
        reason: `Дневной лимит убытка ${config_1.config.trading.maxDailyLoss}% достигнут (${snapshot.dailyPnlPercent.toFixed(2)}%)`,
    };
}
function handleLossStreakLimit(consecutiveLosses) {
    logRiskLimit(`loss streak ${consecutiveLosses}/${config_1.config.trading.maxLossesInRow}`);
    if (!autoPauseOnLimit) {
        clearRiskLimitPauseIfNeeded();
        return { allowed: true };
    }
    const pausedUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    (0, db_1.updateBotState)({
        isPaused: true,
        pausedUntil,
        pauseReason: `${config_1.config.trading.maxLossesInRow} убыточных сделок подряд`,
    });
    return {
        allowed: false,
        reason: `Пауза 24ч: ${consecutiveLosses} убыточных сделок подряд`,
    };
}
/**
 * Run all risk management checks before accepting a signal.
 */
async function checkRisk(signal) {
    const dailyRisk = syncDailyRiskState();
    const state = (0, db_1.getBotState)();
    // 1. Bot paused? Manual pauses still block trading independently of Risk Guard.
    if (state.isPaused) {
        if (!state.pausedUntil) {
            return { allowed: false, reason: state.pauseReason ?? 'Торговля приостановлена' };
        }
        if (new Date() < new Date(state.pausedUntil)) {
            return { allowed: false, reason: `Торговля приостановлена до ${state.pausedUntil} (${state.pauseReason})` };
        }
        (0, db_1.updateBotState)({ isPaused: false, pausedUntil: undefined, pauseReason: undefined });
    }
    // 2. Risk Guard limits. They warn by default and pause only when Auto Pause is enabled.
    if (config_1.config.trading.riskGuardEnabled) {
        if (dailyRisk.isLimitReached) {
            const result = handleDailyRiskLimit(dailyRisk);
            if (!result.allowed)
                return result;
        }
        if (state.consecutiveLosses >= config_1.config.trading.maxLossesInRow) {
            const result = handleLossStreakLimit(state.consecutiveLosses);
            if (!result.allowed)
                return result;
        }
    }
    else {
        clearRiskLimitPauseIfNeeded(state);
    }
    // 3. Max open positions
    const openTrades = (0, db_1.getOpenTrades)();
    if (openTrades.length >= config_1.config.trading.maxOpenPositions) {
        return { allowed: false, reason: `Максимум открытых позиций (${config_1.config.trading.maxOpenPositions}) достигнут` };
    }
    // 4. No duplicate symbol
    const existingTrade = (0, db_1.getOpenTradeBySymbol)(signal.symbol);
    if (existingTrade) {
        return { allowed: false, reason: `Уже есть открытая позиция по ${signal.symbol}` };
    }
    // 5. Risk/reward
    if (signal.riskReward < 2) {
        return { allowed: false, reason: `Risk/Reward ${signal.riskReward} ниже минимума 1:2` };
    }
    // 6. Stop loss not too far (>3% from entry)
    const slDistance = Math.abs(signal.entryPrice - signal.stopLoss) / signal.entryPrice;
    if (slDistance > 0.03) {
        return { allowed: false, reason: `Стоп слишком далеко (${(slDistance * 100).toFixed(2)}% > 3%)` };
    }
    return { allowed: true };
}
/**
 * Floor a value to the nearest multiple of lotSz (round down, never up).
 */
function floorToLotSz(value, lotSz) {
    if (lotSz <= 0)
        return value;
    const decimals = (lotSz.toString().split('.')[1] ?? '').length;
    return parseFloat((Math.floor(value / lotSz) * lotSz).toFixed(decimals));
}
/**
 * Calculate position size based on account balance and risk %.
 *
 * For USDT-SWAP: returns number of contracts
 *   contracts = riskUsdt / (|entry - stopLoss| * ctVal)
 *   floored to lotSz, clamped to minSz.
 *
 * For SPOT: returns base asset quantity
 *   size = riskUsdt / |entry - stopLoss|
 */
async function calculatePositionSize(signal) {
    const balance = await (0, balance_1.getTradingBalance)();
    const riskUsdt = balance * (config_1.config.trading.riskPerTrade / 100);
    const slDistance = Math.abs(signal.entryPrice - signal.stopLoss);
    if (slDistance === 0)
        return 0;
    const isSwap = signal.symbol.endsWith('-SWAP');
    if (isSwap) {
        // Fetch real contract spec from OKX
        const info = await (0, market_1.getInstrumentInfo)(signal.symbol);
        const ctVal = info?.ctVal ?? 1; // USDT value of 1 base unit per contract
        const minSz = info?.minSz ?? 1; // minimum order size in contracts
        const lotSz = info?.lotSz ?? 1; // order size increment in contracts
        // Loss in USDT if SL is hit, per 1 contract
        const lossPerContractUsdt = slDistance * ctVal;
        if (lossPerContractUsdt === 0)
            return 0;
        const rawContracts = riskUsdt / lossPerContractUsdt;
        const contracts = floorToLotSz(rawContracts, lotSz);
        // If floored size is below exchange minimum — reject the trade to avoid exceeding risk
        if (contracts < minSz) {
            logger_1.logger.warn(`⚠️ Position sizing [${signal.symbol}]: contracts=${contracts} < minSz=${minSz} — skipping. ` +
                `riskUsdt=${riskUsdt.toFixed(2)} rawContracts=${rawContracts.toFixed(4)} lotSz=${lotSz}`);
            return 0;
        }
        const notionalUsdt = contracts * ctVal * signal.entryPrice;
        logger_1.logger.info(`📐 Position sizing [${signal.symbol}]: ctVal=${ctVal} minSz=${minSz} lotSz=${lotSz} | ` +
            `riskUsdt=${riskUsdt.toFixed(2)} lossPerContract=${lossPerContractUsdt.toFixed(4)} | ` +
            `contracts=${contracts} notional≈${notionalUsdt.toFixed(2)} USDT`);
        return contracts;
    }
    // SPOT: size in base asset units
    const size = riskUsdt / slDistance;
    return parseFloat(Math.max(size, 0.001).toFixed(6));
}
/**
 * Called after a trade closes. Updates counters and checks daily realized loss.
 */
function recordTradeResult(pnlPercent) {
    const state = (0, db_1.getBotState)();
    const dailyRisk = getDailyRiskSnapshot();
    const nextConsecutiveLosses = pnlPercent < 0 ? state.consecutiveLosses + 1 : 0;
    const updates = {
        consecutiveLosses: nextConsecutiveLosses,
        dailyLossPercent: dailyRisk.dailyLossPercent,
        lastDailyReset: dailyRisk.tradingDay,
    };
    if (!config_1.config.trading.riskGuardEnabled) {
        if (isRiskLimitPause(state.pauseReason)) {
            updates.isPaused = false;
            updates.pausedUntil = undefined;
            updates.pauseReason = undefined;
        }
        (0, db_1.updateBotState)(updates);
        return;
    }
    if (dailyRisk.isLimitReached) {
        logRiskLimit(`daily loss ${dailyRisk.dailyLossPercent.toFixed(2)}/${config_1.config.trading.maxDailyLoss}%`);
        if (autoPauseOnLimit) {
            updates.isPaused = true;
            updates.pausedUntil = nextTradingDayIso();
            updates.pauseReason = `Дневной лимит убытка ${config_1.config.trading.maxDailyLoss}% превышен`;
        }
        else if (isRiskLimitPause(state.pauseReason)) {
            updates.isPaused = false;
            updates.pausedUntil = undefined;
            updates.pauseReason = undefined;
        }
    }
    else if (nextConsecutiveLosses >= config_1.config.trading.maxLossesInRow) {
        logRiskLimit(`loss streak ${nextConsecutiveLosses}/${config_1.config.trading.maxLossesInRow}`);
        if (autoPauseOnLimit) {
            updates.isPaused = true;
            updates.pausedUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
            updates.pauseReason = `${config_1.config.trading.maxLossesInRow} убыточных сделок подряд`;
        }
        else if (isRiskLimitPause(state.pauseReason)) {
            updates.isPaused = false;
            updates.pausedUntil = undefined;
            updates.pauseReason = undefined;
        }
    }
    else if (isRiskLimitPause(state.pauseReason)) {
        updates.isPaused = false;
        updates.pausedUntil = undefined;
        updates.pauseReason = undefined;
    }
    (0, db_1.updateBotState)(updates);
}
/**
 * Manual pause/resume.
 */
function pauseBot(reason = 'Ручная остановка') {
    (0, db_1.updateBotState)({ isPaused: true, pauseReason: reason });
    logger_1.logger.warn(`⛔ Bot paused: ${reason}`);
}
function resumeBot() {
    (0, db_1.updateBotState)({ isPaused: false, pausedUntil: undefined, pauseReason: undefined, consecutiveLosses: 0 });
    logger_1.logger.info('▶️ Bot resumed');
}
function resetDailyRiskLock() {
    const snapshot = getDailyRiskSnapshot();
    const state = (0, db_1.getBotState)();
    const clearingRiskLimitPause = isRiskLimitPause(state.pauseReason);
    (0, db_1.updateBotState)({
        isPaused: clearingRiskLimitPause ? false : state.isPaused,
        pausedUntil: clearingRiskLimitPause ? undefined : state.pausedUntil,
        pauseReason: clearingRiskLimitPause ? undefined : state.pauseReason,
        consecutiveLosses: 0,
        dailyLossPercent: 0,
        lastDailyReset: snapshot.tradingDay,
    });
    logger_1.logger.warn('🧯 Daily risk lock manually reset');
    return snapshot;
}
//# sourceMappingURL=riskManager.js.map