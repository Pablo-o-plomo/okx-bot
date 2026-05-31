import { config } from '../config';
import { getBotState, updateBotState, getOpenTrades, getOpenTradeBySymbol, getLastNTrades } from '../database/db';
import { getAccountBalance } from '../okx/trading';
import { logger } from '../utils/logger';
import { broadcastMessage } from '../telegram/bot';
import type { Signal } from '../database/models';

export interface RiskCheck {
  allowed: boolean;
  reason?: string;
}

/**
 * Run all risk management checks before accepting a signal.
 */
export async function checkRisk(signal: Signal): Promise<RiskCheck> {
  const state = getBotState();

  // 1. Bot paused?
  if (state.isPaused) {
    if (state.pausedUntil && new Date() < new Date(state.pausedUntil)) {
      return { allowed: false, reason: `Торговля приостановлена до ${state.pausedUntil} (${state.pauseReason})` };
    }
    // Auto-resume after pause period
    updateBotState({ isPaused: false, pausedUntil: undefined, pauseReason: undefined });
  }

  // 2. Reset daily loss counter if new day
  const today = new Date().toISOString().split('T')[0];
  if (state.lastDailyReset !== today) {
    updateBotState({ dailyLossPercent: 0, lastDailyReset: today });
  }

  // 3. Daily loss limit
  if (state.dailyLossPercent >= config.trading.maxDailyLoss) {
    return { allowed: false, reason: `Дневной лимит убытка ${config.trading.maxDailyLoss}% достигнут (${state.dailyLossPercent.toFixed(2)}%)` };
  }

  // 4. Max open positions
  const openTrades = getOpenTrades();
  if (openTrades.length >= config.trading.maxOpenPositions) {
    return { allowed: false, reason: `Максимум открытых позиций (${config.trading.maxOpenPositions}) достигнут` };
  }

  // 5. No duplicate symbol
  const existingTrade = getOpenTradeBySymbol(signal.symbol);
  if (existingTrade) {
    return { allowed: false, reason: `Уже есть открытая позиция по ${signal.symbol}` };
  }

  // 6. Consecutive losses
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

  // 7. Risk/reward
  if (signal.riskReward < 2) {
    return { allowed: false, reason: `Risk/Reward ${signal.riskReward} ниже минимума 1:2` };
  }

  // 8. Stop loss not too far (>3% from entry)
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
 * Called after a trade closes. Updates counters and checks daily loss.
 */
export function recordTradeResult(pnlPercent: number): void {
  const state = getBotState();
  const updates: Partial<typeof state> = {};

  if (pnlPercent < 0) {
    updates.consecutiveLosses = state.consecutiveLosses + 1;
    updates.dailyLossPercent = state.dailyLossPercent + Math.abs(pnlPercent);

    // Check if daily loss exceeded
    if ((updates.dailyLossPercent ?? 0) >= config.trading.maxDailyLoss) {
      const tomorrow = new Date();
      tomorrow.setHours(24, 0, 0, 0);
      updates.isPaused = true;
      updates.pausedUntil = tomorrow.toISOString();
      updates.pauseReason = `Дневной лимит убытка ${config.trading.maxDailyLoss}% превышен`;
      logger.warn(`⛔ Daily loss limit reached. Pausing until ${tomorrow.toISOString()}`);
      broadcastMessage(`🛑 <b>Бот поставлен на паузу</b>\nПричина: ${updates.pauseReason}`).catch(()=>{});
    }
  } else {
    updates.consecutiveLosses = 0;
  }

  const recent = getLastNTrades(20);
  if (recent.length >= 20) {
    const dd = recent.reduce((a,t)=>a+(t.pnlPercent||0),0);
    if (dd <= -Math.abs(config.trading.defensiveModeDrawdown)) {
      updates.mode = 'defensive';
      updates.isPaused = true;
      updates.pauseReason = `Просадка за 20 сделок хуже -${Math.abs(config.trading.defensiveModeDrawdown)}%`;
      broadcastMessage(`🛑 <b>Trading paused</b>\n\nReason:\n${updates.pauseReason}`).catch(()=>{});
    }
  }
  if ((updates.consecutiveLosses ?? state.consecutiveLosses) >= config.trading.maxLossesInRow) {
    updates.isPaused = true; updates.pausedUntil = new Date(Date.now()+24*60*60*1000).toISOString(); updates.pauseReason = `${config.trading.maxLossesInRow} убыточных подряд`;
    broadcastMessage(`🛑 <b>Бот поставлен на паузу</b>\nПричина: ${updates.pauseReason}`).catch(()=>{});
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
