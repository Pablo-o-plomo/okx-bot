import { config } from '../config';
import { getBotState, updateBotState, getOpenTrades, getOpenTradeBySymbol, getTodayClosedTrades } from '../database/db';
import { getTradingBalance } from '../utils/balance';
import { getInstrumentInfo } from '../okx/market';
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
  behavior: 'OFF' | 'WARNING ONLY' | 'AUTO PAUSE';
}

export interface RiskGuardSettings {
  riskGuardEnabled: boolean;
  autoPauseOnLimit: boolean;
  riskPerTrade: number;
  maxDailyLoss: number;
  maxLossStreak: number;
}

let autoPauseOnLimit = config.trading.autoPauseOnLimit;

function todayIso(): string {
  return new Date().toISOString().split('T')[0];
}

function nextTradingDayIso(): string {
  const tomorrow = new Date();
  tomorrow.setUTCHours(24, 0, 0, 0);
  return tomorrow.toISOString();
}

function isRiskLimitPause(reason?: string): boolean {
  if (!reason) return false;

  const normalized = reason.toLowerCase();
  return normalized.includes('дневной лимит убытка')
    || normalized.includes('daily loss limit')
    || normalized.includes('daily risk lock')
    || normalized.includes('убыточных сделок подряд')
    || normalized.includes('loss streak')
    || normalized.includes('risk limit');
}

function dailyRiskBehavior(): DailyRiskSnapshot['behavior'] {
  if (!config.trading.riskGuardEnabled) return 'OFF';
  return autoPauseOnLimit ? 'AUTO PAUSE' : 'WARNING ONLY';
}

function logRiskLimit(limit: string): void {
  logger.warn(`⚠️ Risk limit reached: ${limit}`);
  if (autoPauseOnLimit) {
    logger.warn('⏸ Auto-pause enabled, trading paused');
  } else {
    logger.warn('⚠️ Auto-pause disabled, trading continues');
  }
}

function clearRiskLimitPauseIfNeeded(state = getBotState()): void {
  if (isRiskLimitPause(state.pauseReason)) {
    updateBotState({ isPaused: false, pausedUntil: undefined, pauseReason: undefined });
  }
}

export function getRiskGuardSettings(): RiskGuardSettings {
  return {
    riskGuardEnabled: config.trading.riskGuardEnabled,
    autoPauseOnLimit,
    riskPerTrade: config.trading.riskPerTrade,
    maxDailyLoss: config.trading.maxDailyLoss,
    maxLossStreak: config.trading.maxLossesInRow,
  };
}

export function toggleAutoPauseOnLimit(): boolean {
  autoPauseOnLimit = !autoPauseOnLimit;
  logger.warn(`⏸ Auto Pause on limit: ${autoPauseOnLimit ? 'enabled' : 'disabled'}`);
  return autoPauseOnLimit;
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
    mode: config.trading.isLive ? 'LIVE' : 'PAPER',
    behavior: dailyRiskBehavior(),
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

  if (isRiskLimitPause(state.pauseReason)
    && (!config.trading.riskGuardEnabled || !autoPauseOnLimit || !snapshot.isLimitReached || state.lastDailyReset !== snapshot.tradingDay)) {
    updates.isPaused = false;
    updates.pausedUntil = undefined;
    updates.pauseReason = undefined;
  }

  updateBotState(updates);
  return snapshot;
}

function handleDailyRiskLimit(snapshot: DailyRiskSnapshot): RiskCheck {
  logRiskLimit(`daily loss ${snapshot.dailyLossPercent.toFixed(2)}/${config.trading.maxDailyLoss}%`);

  if (!autoPauseOnLimit) {
    clearRiskLimitPauseIfNeeded();
    return { allowed: true };
  }

  const pausedUntil = nextTradingDayIso();
  updateBotState({
    isPaused: true,
    pausedUntil,
    pauseReason: `Дневной лимит убытка ${config.trading.maxDailyLoss}% достигнут`,
    dailyLossPercent: snapshot.dailyLossPercent,
    lastDailyReset: snapshot.tradingDay,
  });

  return {
    allowed: false,
    reason: `Дневной лимит убытка ${config.trading.maxDailyLoss}% достигнут (${snapshot.dailyPnlPercent.toFixed(2)}%)`,
  };
}

function handleLossStreakLimit(consecutiveLosses: number): RiskCheck {
  logRiskLimit(`loss streak ${consecutiveLosses}/${config.trading.maxLossesInRow}`);

  if (!autoPauseOnLimit) {
    clearRiskLimitPauseIfNeeded();
    return { allowed: true };
  }

  const pausedUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  updateBotState({
    isPaused: true,
    pausedUntil,
    pauseReason: `${config.trading.maxLossesInRow} убыточных сделок подряд`,
  });

  return {
    allowed: false,
    reason: `Пауза 24ч: ${consecutiveLosses} убыточных сделок подряд`,
  };
}

/**
 * Run all risk management checks before accepting a signal.
 */
export async function checkRisk(signal: Signal): Promise<RiskCheck> {
  const dailyRisk = syncDailyRiskState();
  const state = getBotState();

  // 1. Bot paused? Manual pauses still block trading independently of Risk Guard.
  if (state.isPaused) {
    if (!state.pausedUntil) {
      return { allowed: false, reason: state.pauseReason ?? 'Торговля приостановлена' };
    }
    if (new Date() < new Date(state.pausedUntil)) {
      return { allowed: false, reason: `Торговля приостановлена до ${state.pausedUntil} (${state.pauseReason})` };
    }
    updateBotState({ isPaused: false, pausedUntil: undefined, pauseReason: undefined });
  }

  // 2. Risk Guard limits. They warn by default and pause only when Auto Pause is enabled.
  if (config.trading.riskGuardEnabled) {
    if (dailyRisk.isLimitReached) {
      const result = handleDailyRiskLimit(dailyRisk);
      if (!result.allowed) return result;
    }

    if (state.consecutiveLosses >= config.trading.maxLossesInRow) {
      const result = handleLossStreakLimit(state.consecutiveLosses);
      if (!result.allowed) return result;
    }
  } else {
    clearRiskLimitPauseIfNeeded(state);
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
function floorToLotSz(value: number, lotSz: number): number {
  if (lotSz <= 0) return value;
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
export async function calculatePositionSize(signal: Signal): Promise<number> {
  const balance = await getTradingBalance();
  const riskUsdt = balance * (config.trading.riskPerTrade / 100);
  const slDistance = Math.abs(signal.entryPrice - signal.stopLoss);

  if (slDistance === 0) return 0;

  const isSwap = signal.symbol.endsWith('-SWAP');

  if (isSwap) {
    // Fetch real contract spec from OKX
    const info = await getInstrumentInfo(signal.symbol);
    const ctVal = info?.ctVal ?? 1;      // USDT value of 1 base unit per contract
    const minSz = info?.minSz ?? 1;      // minimum order size in contracts
    const lotSz = info?.lotSz ?? 1;      // order size increment in contracts

    // Loss in USDT if SL is hit, per 1 contract
    const lossPerContractUsdt = slDistance * ctVal;
    if (lossPerContractUsdt === 0) return 0;

    const rawContracts = riskUsdt / lossPerContractUsdt;
    const contracts = floorToLotSz(rawContracts, lotSz);

    // If floored size is below exchange minimum — reject the trade to avoid exceeding risk
    if (contracts < minSz) {
      logger.warn(
        `⚠️ Position sizing [${signal.symbol}]: contracts=${contracts} < minSz=${minSz} — skipping. ` +
        `riskUsdt=${riskUsdt.toFixed(2)} rawContracts=${rawContracts.toFixed(4)} lotSz=${lotSz}`,
      );
      return 0;
    }

    const notionalUsdt = contracts * ctVal * signal.entryPrice;
    logger.info(
      `📐 Position sizing [${signal.symbol}]: ctVal=${ctVal} minSz=${minSz} lotSz=${lotSz} | ` +
      `riskUsdt=${riskUsdt.toFixed(2)} lossPerContract=${lossPerContractUsdt.toFixed(4)} | ` +
      `contracts=${contracts} notional≈${notionalUsdt.toFixed(2)} USDT`,
    );

    return contracts;
  }

  // SPOT: size in base asset units
  const size = riskUsdt / slDistance;
  return parseFloat(Math.max(size, 0.001).toFixed(6));
}

/**
 * Called after a trade closes. Updates counters and checks daily realized loss.
 */
export function recordTradeResult(pnlPercent: number): void {
  const state = getBotState();
  const dailyRisk = getDailyRiskSnapshot();
  const nextConsecutiveLosses = pnlPercent < 0 ? state.consecutiveLosses + 1 : 0;
  const updates: Partial<typeof state> = {
    consecutiveLosses: nextConsecutiveLosses,
    dailyLossPercent: dailyRisk.dailyLossPercent,
    lastDailyReset: dailyRisk.tradingDay,
  };

  if (!config.trading.riskGuardEnabled) {
    if (isRiskLimitPause(state.pauseReason)) {
      updates.isPaused = false;
      updates.pausedUntil = undefined;
      updates.pauseReason = undefined;
    }
    updateBotState(updates);
    return;
  }

  if (dailyRisk.isLimitReached) {
    logRiskLimit(`daily loss ${dailyRisk.dailyLossPercent.toFixed(2)}/${config.trading.maxDailyLoss}%`);
    if (autoPauseOnLimit) {
      updates.isPaused = true;
      updates.pausedUntil = nextTradingDayIso();
      updates.pauseReason = `Дневной лимит убытка ${config.trading.maxDailyLoss}% превышен`;
    } else if (isRiskLimitPause(state.pauseReason)) {
      updates.isPaused = false;
      updates.pausedUntil = undefined;
      updates.pauseReason = undefined;
    }
  } else if (nextConsecutiveLosses >= config.trading.maxLossesInRow) {
    logRiskLimit(`loss streak ${nextConsecutiveLosses}/${config.trading.maxLossesInRow}`);
    if (autoPauseOnLimit) {
      updates.isPaused = true;
      updates.pausedUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      updates.pauseReason = `${config.trading.maxLossesInRow} убыточных сделок подряд`;
    } else if (isRiskLimitPause(state.pauseReason)) {
      updates.isPaused = false;
      updates.pausedUntil = undefined;
      updates.pauseReason = undefined;
    }
  } else if (isRiskLimitPause(state.pauseReason)) {
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
  const clearingRiskLimitPause = isRiskLimitPause(state.pauseReason);

  updateBotState({
    isPaused: clearingRiskLimitPause ? false : state.isPaused,
    pausedUntil: clearingRiskLimitPause ? undefined : state.pausedUntil,
    pauseReason: clearingRiskLimitPause ? undefined : state.pauseReason,
    consecutiveLosses: 0,
    dailyLossPercent: 0,
    lastDailyReset: snapshot.tradingDay,
  });
  logger.warn('🧯 Daily risk lock manually reset');
  return snapshot;
}
