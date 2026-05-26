import { getOpenTrades, closeTrade, getTradeById } from '../database/db';
import { getTicker } from '../okx/market';
import { closePosition, updatePaperBalance } from '../okx/trading';
import { recordTradeResult } from './riskManager';
import { broadcastTpHit, broadcastTradeClosed } from '../telegram/bot';
import { logger } from '../utils/logger';
import { config } from '../config';
import type { Trade, ErrorTag, TradeStatus } from '../database/models';
import { computeIndicators } from './indicators';
import { getCandles } from '../okx/market';

// Track which TPs have been hit per trade (in memory)
const tpHitMap = new Map<number, Set<number>>();
let monitorInProgress = false;

/**
 * Monitor all open trades against current prices.
 * Called every minute by the scheduler.
 */
export async function monitorOpenTrades(): Promise<void> {
  if (monitorInProgress) return;
  monitorInProgress = true;
  try {
    const openTrades = getOpenTrades();
    if (openTrades.length === 0) return;
    await Promise.all(openTrades.map(trade => checkTrade(trade)));
  } finally {
    monitorInProgress = false;
  }
}

async function checkTrade(trade: Trade): Promise<void> {
  const currentPrice = await getTicker(trade.symbol);
  if (!currentPrice || !trade.id) return;

  const id = trade.id;
  if (!tpHitMap.has(id)) tpHitMap.set(id, new Set());
  const hitTPs = tpHitMap.get(id)!;

  const isLong = trade.direction === 'LONG';

  // ── Check Stop Loss ──
  const slHit = isLong
    ? currentPrice <= trade.stopLoss
    : currentPrice >= trade.stopLoss;

  if (slHit) {
    await handleClose(trade, currentPrice, 'closed_sl');
    return;
  }

  // ── Check Take Profits ──
  const tp3Hit = isLong ? currentPrice >= trade.takeProfit3 : currentPrice <= trade.takeProfit3;
  const tp2Hit = isLong ? currentPrice >= trade.takeProfit2 : currentPrice <= trade.takeProfit2;
  const tp1Hit = isLong ? currentPrice >= trade.takeProfit1 : currentPrice <= trade.takeProfit1;

  if (tp3Hit && !hitTPs.has(3)) {
    hitTPs.add(3);
    await handleClose(trade, currentPrice, 'closed_tp3');
    tpHitMap.delete(id);
    return;
  }

  if (tp2Hit && !hitTPs.has(2)) {
    hitTPs.add(2);
    // Notify TP2 hit but keep trade open for TP3
    await broadcastTpHit(trade, 2, currentPrice);
    // Move SL to entry (breakeven)
    logger.info(`📈 TP2 hit for ${trade.symbol} — moving SL to breakeven`);
    return;
  }

  if (tp1Hit && !hitTPs.has(1)) {
    hitTPs.add(1);
    await broadcastTpHit(trade, 1, currentPrice);
    logger.info(`📈 TP1 hit for ${trade.symbol}`);
  }
}

async function handleClose(
  trade: Trade,
  exitPrice: number,
  status: TradeStatus,
): Promise<void> {
  if (!trade.id) return;

  const isWin = status !== 'closed_sl';
  const result = isWin ? 'win' : 'loss';
  const isLong = trade.direction === 'LONG';

  const pnlPercent = isLong
    ? ((exitPrice - trade.entryPrice) / trade.entryPrice) * 100 * trade.leverage
    : ((trade.entryPrice - exitPrice) / trade.entryPrice) * 100 * trade.leverage;

  const pnlUsdt = (pnlPercent / 100) * trade.positionSize * trade.entryPrice;

  // ── Generate exit analysis ──
  const { exitReason, exitAnalysis, improvements, errorTags } =
    await generateExitAnalysis(trade, status, exitPrice, pnlPercent);

  // ── Close in paper/live ──
  try {
    await closePosition(trade.symbol, trade.direction, trade.positionSize, exitPrice);
  } catch (err: any) {
    logger.error(`Failed to place close order: ${err.message}`);
  }

  // ── Update DB ──
  closeTrade(
    trade.id,
    exitPrice,
    status,
    result,
    parseFloat(pnlPercent.toFixed(4)),
    parseFloat(pnlUsdt.toFixed(4)),
    exitReason,
    exitAnalysis,
    improvements,
    errorTags,
  );

  // ── Update paper balance ──
  if (!config.trading.isLive) {
    updatePaperBalance(pnlUsdt);
  }

  // ── Update risk counters ──
  recordTradeResult(pnlPercent);

  // ── Send Telegram notification ──
  const updatedTrade = getTradeById(trade.id);
  if (updatedTrade) {
    await broadcastTradeClosed(updatedTrade, improvements);
  }

  tpHitMap.delete(trade.id);
  logger.info(`Trade ${trade.id} closed: ${status} | PnL: ${pnlPercent.toFixed(2)}%`);
}

async function generateExitAnalysis(
  trade: Trade,
  status: TradeStatus,
  exitPrice: number,
  pnlPercent: number,
): Promise<{
  exitReason: string;
  exitAnalysis: string;
  improvements: string[];
  errorTags: ErrorTag[];
}> {
  // Fetch current indicators for analysis
  let currentIndicators = null;
  try {
    const candles = await getCandles(trade.symbol, '1H', 50);
    currentIndicators = computeIndicators(candles, '1H');
  } catch { /* ignore */ }

  const exitReasons: string[] = [];
  const improvements: string[] = [];
  const errorTags: ErrorTag[] = [];

  switch (status) {
    case 'closed_tp1':
      exitReasons.push('Достигнут Take Profit 1');
      break;
    case 'closed_tp2':
      exitReasons.push('Достигнут Take Profit 2');
      if (currentIndicators) {
        if (currentIndicators.rsi > 70) exitReasons.push('RSI вошел в зону перегрева');
        if (currentIndicators.volumeCurrent < currentIndicators.volumeAvg) {
          exitReasons.push('Объем начал снижаться');
        }
      }
      break;
    case 'closed_tp3':
      exitReasons.push('Достигнут Take Profit 3 — полная цель достигнута');
      break;
    case 'closed_sl':
      exitReasons.push('Stop Loss сработал корректно');
      if (currentIndicators) {
        if (trade.direction === 'LONG' && currentIndicators.trend !== 'bullish') {
          exitReasons.push('Тренд развернулся против позиции');
          errorTags.push('trend_against_trade');
        }
        if (currentIndicators.volumeCurrent < currentIndicators.volumeAvg) {
          exitReasons.push('Объем не подтвердил движение');
          errorTags.push('weak_volume');
        }
      }

      // Analyze entry quality
      const entryIndicators = trade.indicatorsAtEntry;
      if (entryIndicators) {
        const slDistance = Math.abs(trade.entryPrice - trade.stopLoss) / trade.entryPrice;
        if (slDistance < 0.005) {
          improvements.push('Стоп был слишком близко — расширить ATR-множитель');
          errorTags.push('stop_too_tight');
        }
        if (entryIndicators.volumeCurrent < entryIndicators.volumeAvg) {
          improvements.push('Не входить при слабом объеме на входе');
          errorTags.push('weak_volume');
        }
        if ((trade.direction === 'LONG' && entryIndicators.rsi > 65) ||
            (trade.direction === 'SHORT' && entryIndicators.rsi < 35)) {
          improvements.push('Избегать входов в перегретую зону RSI');
          errorTags.push('late_entry');
        }
      }

      if (improvements.length === 0) {
        improvements.push('Сделка выполнена по плану — стоп сработал штатно');
      }
      break;
  }

  const isWin = status !== 'closed_sl';
  const exitAnalysis = isWin
    ? `Сделка отработала по плану. PnL: +${pnlPercent.toFixed(2)}%. ${errorTags.length === 0 ? 'Ошибок нет.' : ''}`
    : `Убыток ${pnlPercent.toFixed(2)}%. Stop Loss сработал корректно. ${improvements.length > 0 ? 'Есть точки для улучшения.' : ''}`;

  return {
    exitReason: exitReasons.join('\n- '),
    exitAnalysis,
    improvements,
    errorTags,
  };
}
