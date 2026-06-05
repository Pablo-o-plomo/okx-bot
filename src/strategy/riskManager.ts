import { config } from '../config';
import { getBotState, updateBotState, getOpenTrades, getOpenTradeBySymbol, getTodayClosedTrades } from '../database/db';
import { getAccountBalance } from '../okx/trading';
import { logger } from '../utils/logger';
import type { Signal, Trade } from '../database/models';

export interface RiskCheck {
  allowed: boolean;
  reason?: string;
}

export interface DailyRiskSnapshot {
  tradingDay: string;
  dailyPnlPercent: number;
  dailyLossPercent: number;
  closedTradesCount: number;
  trades: Trade[];
  isLimitReached: boolean;
  mode: 'PAPER' | 'LIVE';
  behavior: 'WARNING ONLY' | 'RISK LOCK';
}

function todayIso(): string {
  return new Date().toISOString().split('T')[0];
}

function nextTradingDayIso(): string {
  const tomorrow = new Date();
  tomorrow.setUTCHours(24, 0, 0, 0);
  return tomorrow.toISOString();
}

function isDailyLossPause(reason?: string): boolean {
  if (!reason) return false;

  const normalized = reason.toLowerCase();
  return normalized.includes('дневной лимит убытка')
    || normalized.includes('daily loss limit')
    || normalized.includes('daily risk lock');
}

function isLiveMode(): boolean {
  return config.trading.isLive;
}

function isPaperMode(): boolean {
  return !config.trading.isLive;
}

function shouldLockDailyRisk(snapshot: DailyRiskSnapshot): boolean {
  return isLiveMode() && snapshot.isLimitReached;
}

function warnPaperDailyLossLimit(snapshot: DailyRiskSnapshot): void {
  logger.warn(`PAPER mode: daily loss limit exceeded, trading continues for learning. Daily PnL: ${snapshot.dailyPnlPercent.toFixed(2)}%.`);
}

export function getDailyRiskSnapshot(): DailyRiskSnapshot {
  const trades = getTodayClosedTrades();
  const dailyPnlPercent = trades.reduce((sum, trade) => sum + (trade.pnlPercent ?? 0), 0);
  const dailyLossPercent = Math.max(-dailyPnlPercent, 0);

  return {
    tradingDay: todayIso(),
    dailyPnlPercent,
    dailyLossPercent,
    closedTradesCount: trades.length,
    trades,
    isLimitReached: dailyPnlPercent <= -config.trading.maxDailyLoss,
    mode: isLiveMode() ? 'LIVE' : 'PAPER',
    behavior: isLiveMode() ? 'RISK LOCK' : 'WARNING ONLY',
  };
}

function syncDailyRiskState(): DailyRiskSnapshot {
  const snapshot = getDailyRiskSnapshot();
  const state = getBotState();
  const updates: Partial<typeof state> = {
    dailyLossPercent: snapshot.dailyLossPercent,
    lastDailyReset: snapshot.tradingDay,
  };

  if (state.lastDailyReset !== snapshot.tradingDay) {
    updates.consecutiveLosses = 0;
  }

  if (isDailyLossPause(state.pauseReason) && (!shouldLockDailyRisk(snapshot) || state.lastDailyReset !== snapshot.tradingDay)) {
    updates.isPaused = false;
    updates.pausedUntil = undefined;
    updates.pauseReason = undefined;
  }

  updateBotState(updates);
  return snapshot;
}

/**
 * Run all risk management checks before accepting a signal.
 */
export async function checkRisk(signal: Signal): Promise<RiskCheck> {
  const dailyRisk = syncDailyRiskState();
  const state = getBotState();

  // 1. Bot paused?
  if (state.isPaused) {
    if (!state.pausedUntil) {
      return { allowed: false, reason: state.pauseReason ?? 'Торговля приостановлена' };
    }
    if (new Date() < new Date(state.pausedUntil)) {
      return { allowed: false, reason: `Торговля приостановлена до ${state.pausedUntil} (${state.pauseReason})` };
    }
    // Auto-resume after pause period
    updateBotState({ isPaused: false, pausedUntil: undefined, pauseReason: undefined });
  }

  // 2. Daily net PnL limit from today's closed trades only.
  // In PAPER mode this is warning-only and must never pause or reject signals.
  if (dailyRisk.isLimitReached && isPaperMode()) {
    warnPaperDailyLossLimit(dailyRisk);
  }

  if (shouldLockDailyRisk(dailyRisk)) {
    const pausedUntil = nextTradingDayIso();
    updateBotState({
      isPaused: true,
      pausedUntil,
      pauseReason: `Дневной лимит убытка ${config.trading.maxDailyLoss}% достигнут`,
      dailyLossPercent: dailyRisk.dailyLossPercent,
      lastDailyReset: dailyRisk.tradingDay,
    });
    logger.warn(`Risk lock activated. Daily PnL: ${dailyRisk.dailyPnlPercent.toFixed(2)}%. Pausing until ${pausedUntil}`);
    return { allowed: false, reason: `Дневной лимит убытка ${config.trading.maxDailyLoss}% достигнут (${dailyRisk.dailyPnlPercent.toFixed(2)}%)` };
  }

  // 3. Max open positions
  const openTrades = getOpenTrades();
  if (openTrades.length >= config.trading.maxOpenPositions) {
    return { allowed: false, reason: `Максимум открытых позиций (${config.trading.maxOpenPositions}) достигнут` };
  }

  // 4. No duplicate symbol
  const existingTrade = getOpenTradeBySymbol(signal.symbol);
  if (existingTrade) {
    return { allowed: false, reason: `Уже есть открытая позиция по ${signal.symbol}` };
  }

  // 5. Consecutive losses
  if (state.consecutiveLosses >= config.trading.maxLossesInRow) {
    const pauseUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    updateBotState({
      isPaused: true,
      pausedUntil: pauseUntil,
      pauseReason: `${config.trading.maxLossesInRow} убыточных сделок подряд`,
    });
    return {
      allowed: false,
      reason: `Пауза 24ч: ${state.consecutiveLosses} убыточных сделок подряд`,
    };
  }

  // 6. Risk/reward
  if (signal.riskReward < 2) {
    return { allowed: false, reason: `Risk/Reward ${signal.riskReward} ниже минимума 1:2` };
  }

  // 7. Stop loss not too far (>3% from entry)
  const slDistance = Math.abs(signal.entryPrice - signal.stopLoss) / signal.entryPrice;
  if (slDistance > 0.03) {
    return { allowed: false, reason: `Стоп слишком далеко (${(slDistance * 100).toFixed(2)}% > 3%)` };
  }

  return { allowed: true };
}

/**
 * Calculate position size based on account balance and risk %.
 */
export async function calculatePositionSize(signal: Signal): Promise<number> {
  const balance = await getAccountBalance();
  const riskAmount = balance * (config.trading.riskPerTrade / 100);
  const slDistance = Math.abs(signal.entryPrice - signal.stopLoss);

  if (slDistance === 0) return 0;

  // For SWAP: size in contracts. For SPOT: size in quote currency
  const isSwap = signal.symbol.endsWith('-SWAP');
  if (isSwap) {
    // Contract value assumed 1 USD (most OKX USDT perps)
    const size = (riskAmount / slDistance) / signal.leverage;
    return parseFloat(Math.max(size, 0.01).toFixed(2));
  } else {
    const size = riskAmount / slDistance;
    return parseFloat(Math.max(size, 0.001).toFixed(6));
  }
}

/**
 * Called after a trade closes. Updates counters and checks daily realized loss.
 */
export function recordTradeResult(pnlPercent: number): void {
  const state = getBotState();
  const dailyRisk = getDailyRiskSnapshot();
  const updates: Partial<typeof state> = {
    consecutiveLosses: pnlPercent < 0 ? state.consecutiveLosses + 1 : 0,
    dailyLossPercent: dailyRisk.dailyLossPercent,
    lastDailyReset: dailyRisk.tradingDay,
  };

  if (dailyRisk.isLimitReached && isPaperMode()) {
    updates.isPaused = isDailyLossPause(state.pauseReason) ? false : state.isPaused;
    updates.pausedUntil = isDailyLossPause(state.pauseReason) ? undefined : state.pausedUntil;
    updates.pauseReason = isDailyLossPause(state.pauseReason) ? undefined : state.pauseReason;
    warnPaperDailyLossLimit(dailyRisk);
  } else if (shouldLockDailyRisk(dailyRisk)) {
    const pausedUntil = nextTradingDayIso();
    updates.isPaused = true;
    updates.pausedUntil = pausedUntil;
    updates.pauseReason = `Дневной лимит убытка ${config.trading.maxDailyLoss}% превышен`;
    logger.warn(`Risk lock activated. Daily PnL: ${dailyRisk.dailyPnlPercent.toFixed(2)}%. Pausing until ${pausedUntil}`);
  } else if (isDailyLossPause(state.pauseReason)) {
    updates.isPaused = false;
    updates.pausedUntil = undefined;
    updates.pauseReason = undefined;
  }

  updateBotState(updates);
}

/**
 * Manual pause/resume.
 */
export function pauseBot(reason = 'Ручная остановка'): void {
  updateBotState({ isPaused: true, pauseReason: reason });
  logger.warn(`⛔ Bot paused: ${reason}`);
}

export function resumeBot(): void {
  updateBotState({ isPaused: false, pausedUntil: undefined, pauseReason: undefined, consecutiveLosses: 0 });
  logger.info('▶️ Bot resumed');
}

export function resetDailyRiskLock(): DailyRiskSnapshot {
  const snapshot = getDailyRiskSnapshot();
  const state = getBotState();
  const clearingDailyLock = isDailyLossPause(state.pauseReason);

  updateBotState({
    isPaused: clearingDailyLock ? false : state.isPaused,
    pausedUntil: clearingDailyLock ? undefined : state.pausedUntil,
    pauseReason: clearingDailyLock ? undefined : state.pauseReason,
    consecutiveLosses: 0,
    dailyLossPercent: 0,
    lastDailyReset: snapshot.tradingDay,
  });
  logger.warn('🧯 Daily risk lock manually reset');
  return snapshot;
}
