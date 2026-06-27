import { getOpenTrades, closeTrade, getTradeById, updateTradeExcursion, updateTradeStopLoss, updateTradeTpHit, updateTradeSlAlgoId, updateTradePartialClose } from '../database/db';
import { getTicker, getInstrumentInfo, getInstrumentTradeParams } from '../okx/market';
import { closePosition, closePartialPosition, moveStopLossToBreakeven, cancelAlgoOrder, updatePaperBalance } from '../okx/trading';
import { recordTradeResult } from './riskManager';
import { broadcastTpHit, broadcastTradeClosed, sendErrorAlert } from '../telegram/bot';
import { logger } from '../utils/logger';
import { config } from '../config';
import type { Trade, ErrorTag, TradeStatus } from '../database/models';
import { computeIndicators } from './indicators';
import { getCandles } from '../okx/market';

// Track which TPs have been hit per trade (in memory)
const tpHitMap = new Map<number, Set<number>>();

// Rounds size DOWN to the nearest lotSz increment.
function roundDownToLot(size: number, lotSz: number): number {
  if (lotSz <= 0) return 0;
  return Math.floor(size / lotSz) * lotSz;
}

/**
 * Monitor all open trades against current prices.
 * Called every minute by the scheduler.
 */
export async function monitorOpenTrades(): Promise<void> {
  const openTrades = getOpenTrades();
  if (openTrades.length === 0) return;

  await Promise.all(openTrades.map(trade => checkTrade(trade)));
}

async function checkTrade(trade: Trade): Promise<void> {
  const currentPrice = await getTicker(trade.symbol);
  if (!currentPrice || !trade.id) return;

  const id = trade.id;
  if (!tpHitMap.has(id)) tpHitMap.set(id, new Set());
  const hitTPs = tpHitMap.get(id)!;
  if (trade.tp1Hit) hitTPs.add(1);
  if (trade.tp2Hit) hitTPs.add(2);
  if (trade.tp3Hit) hitTPs.add(3);

  const isLong = trade.direction === 'LONG';
  updateTradeLifeMetrics(trade, currentPrice);

  // -- Check Stop Loss --
  const slHit = isLong
    ? currentPrice <= trade.stopLoss
    : currentPrice >= trade.stopLoss;

  if (slHit) {
    await handleClose(trade, trade.stopLoss, 'closed_sl');
    return;
  }

  // -- Check Take Profits --
  const tp3Hit = isLong ? currentPrice >= trade.takeProfit3 : currentPrice <= trade.takeProfit3;
  const tp2Hit = isLong ? currentPrice >= trade.takeProfit2 : currentPrice <= trade.takeProfit2;
  const tp1Hit = isLong ? currentPrice >= trade.takeProfit1 : currentPrice <= trade.takeProfit1;

  if (tp3Hit && !hitTPs.has(3)) {
    hitTPs.add(3);
    updateTradeTpHit(id, 1);
    updateTradeTpHit(id, 2);
    updateTradeTpHit(id, 3);
    await handleClose(trade, currentPrice, 'closed_tp3');
    tpHitMap.delete(id);
    return;
  }

  if (tp2Hit && !hitTPs.has(2) && !trade.tp2ClosedSize) {
    hitTPs.add(2);
    updateTradeTpHit(id, 1);
    updateTradeTpHit(id, 2);
    trade.tp1Hit = true;
    trade.tp2Hit = true;
    await handlePartialClose(trade, 2, currentPrice);
    await moveStopToLevel(trade, trade.takeProfit1);
    await broadcastTpHit(trade, 2, currentPrice, 'TP1');
    logger.info(`[TP2] ${trade.symbol} partial close + SL moved to TP1`);
    return;
  }

  // Guard !trade.tp1ClosedSize prevents re-executing partial close after bot restart
  if (tp1Hit && !hitTPs.has(1) && !trade.tp1ClosedSize) {
    hitTPs.add(1);
    updateTradeTpHit(id, 1);
    trade.tp1Hit = true;
    await handlePartialClose(trade, 1, currentPrice);
    await moveStopToBreakeven(trade);
    await broadcastTpHit(trade, 1, currentPrice, 'breakeven');
    logger.info(`[TP1] ${trade.symbol} partial close + SL moved to breakeven`);
  }
}

function updateTradeLifeMetrics(trade: Trade, currentPrice: number): void {
  if (!trade.id) return;

  const pnlPercent = trade.direction === 'LONG'
    ? ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100 * trade.leverage
    : ((trade.entryPrice - currentPrice) / trade.entryPrice) * 100 * trade.leverage;

  const maxProfitPercent = Math.max(pnlPercent, 0);
  const maxDrawdownPercent = Math.max(-pnlPercent, 0);
  updateTradeExcursion(
    trade.id,
    parseFloat(maxProfitPercent.toFixed(4)),
    parseFloat(maxDrawdownPercent.toFixed(4)),
  );
}

// Partially close ~33% of the initial position at TP1 or TP2.
// Respects lotSz / minSz. On exchange failure: logs and returns without updating DB.
// Paper balance is credited immediately; handleClose credits only the remainder.
async function handlePartialClose(
  trade: Trade,
  tpLevel: 1 | 2,
  currentPrice: number,
): Promise<void> {
  if (!trade.id) return;

  // Instrument sizing (fallback: ctVal=1, lotSz=1, minSz=1 -- never throws)
  const { ctVal, lotSz, minSz } = await getInstrumentTradeParams(trade.symbol);

  // Target 33% of the original full position size
  const targetCloseSize = trade.positionSize * 0.33;
  const closeSize = roundDownToLot(targetCloseSize, lotSz);
  const currentRemaining = trade.remainingSize ?? trade.positionSize;

  if (closeSize <= 0 || closeSize < minSz) {
    logger.warn(
      `Partial close skipped for ${trade.symbol} TP${tpLevel}: closeSize=${closeSize} < minSz=${minSz}`,
    );
    return; // caller still proceeds to SL move
  }

  // Safety guard: never close more than what remains
  const actualCloseSize = Math.min(closeSize, currentRemaining);

  try {
    await closePartialPosition(trade.symbol, trade.direction, actualCloseSize, currentPrice);
  } catch (err: any) {
    logger.error(`Partial close failed for ${trade.symbol} TP${tpLevel}: ${err.message}`);
    sendErrorAlert(err.message, `Partial close TP${tpLevel}: ${trade.symbol}`).catch(() => {});
    return; // do not update DB or balance -- position unchanged on exchange
  }

  // Realized PnL for the closed portion only
  const priceDiff = trade.direction === 'LONG'
    ? currentPrice - trade.entryPrice
    : trade.entryPrice - currentPrice;
  const partialPnlUsdt = actualCloseSize * ctVal * priceDiff;
  const newRemainingSize = parseFloat((currentRemaining - actualCloseSize).toFixed(8));

  // Persist to DB
  updateTradePartialClose(trade.id, tpLevel, actualCloseSize, partialPnlUsdt, newRemainingSize);

  // Update in-memory trade object (used by subsequent SL move and handleClose)
  if (tpLevel === 1) {
    trade.tp1ClosedSize = actualCloseSize;
    trade.tp1PnlUsdt = partialPnlUsdt;
  } else {
    trade.tp2ClosedSize = actualCloseSize;
    trade.tp2PnlUsdt = partialPnlUsdt;
  }
  trade.remainingSize = newRemainingSize;

  // Paper balance: credit the partial PnL now (final close credits only the remainder)
  if (!config.trading.isLive) {
    updatePaperBalance(partialPnlUsdt);
  }

  logger.info(
    `TP${tpLevel} partial close: ${trade.symbol} ` +
    `closed=${actualCloseSize} pnl=${partialPnlUsdt.toFixed(2)} USDT ` +
    `remaining=${newRemainingSize}`,
  );
}

// Move SL to an arbitrary price level.
// Uses trade.remainingSize for the algo order size (correct after partial closes).
// Cancels the previous SL algo before placing the new one.
async function moveStopToLevel(trade: Trade, newStopLoss: number): Promise<void> {
  if (!trade.id) return;

  updateTradeStopLoss(trade.id, newStopLoss);
  trade.stopLoss = newStopLoss;

  // After partial closes the algo order must cover only remaining contracts
  const orderSize = trade.remainingSize ?? trade.positionSize;

  if (trade.slAlgoId) {
    try {
      await cancelAlgoOrder(trade.symbol, trade.slAlgoId);
      logger.info(`Cancelled old SL algo order ${trade.slAlgoId} for ${trade.symbol}`);
    } catch (err: any) {
      logger.warn(`Failed to cancel old SL algo ${trade.slAlgoId} for ${trade.symbol}: ${err.message}`);
      sendErrorAlert(err.message, `Cancel SL algo: ${trade.symbol}`).catch(() => {});
      // Don't abort -- proceed to place the new algo order regardless
    }
  }

  try {
    const result = await moveStopLossToBreakeven(
      trade.symbol,
      trade.direction,
      orderSize,
      newStopLoss,
    );

    if (!result.paper && trade.id) {
      updateTradeSlAlgoId(trade.id, result.orderId);
      trade.slAlgoId = result.orderId;
      logger.info(`SL algo order saved: ${result.orderId} for ${trade.symbol}`);
    }
  } catch (err: any) {
    logger.error(`Failed to move SL to ${newStopLoss} for ${trade.symbol}: ${err.message}`);
    sendErrorAlert(err.message, `Move SL to ${newStopLoss}: ${trade.symbol}`).catch(() => {});
  }
}

// Convenience: move SL to entry price (breakeven).
async function moveStopToBreakeven(trade: Trade): Promise<void> {
  await moveStopToLevel(trade, trade.entryPrice);
}

async function handleClose(
  trade: Trade,
  exitPrice: number,
  status: TradeStatus,
): Promise<void> {
  if (!trade.id) return;

  const isLong = trade.direction === 'LONG';
  const isBreakeven = status === 'closed_sl' && exitPrice === trade.entryPrice;
  const isWin = status !== 'closed_sl';
  const result = isBreakeven ? 'breakeven' : isWin ? 'win' : 'loss';

  // Size remaining after any partial closes at TP1/TP2
  const closeSize = trade.remainingSize ?? trade.positionSize;

  // priceDiff: positive = profit for the given direction
  const priceDiff = isLong
    ? exitPrice - trade.entryPrice
    : trade.entryPrice - exitPrice;

  // pnlPercent: leverage-adjusted ROE on full initial margin (unchanged semantics)
  const pnlPercent = (priceDiff / trade.entryPrice) * 100 * trade.leverage;

  // finalPnlUsdt: PnL on the REMAINING portion only (partial close PnLs already applied)
  let finalPnlUsdt: number;
  if (trade.symbol.endsWith('-SWAP')) {
    let ctVal = 1;
    try {
      const info = await getInstrumentInfo(trade.symbol);
      ctVal = info?.ctVal ?? 1;
    } catch {
      logger.warn(`Could not fetch ctVal for ${trade.symbol}, pnlUsdt computed with ctVal=1`);
    }
    finalPnlUsdt = closeSize * ctVal * priceDiff;
  } else {
    finalPnlUsdt = closeSize * priceDiff;
  }

  // Total realized PnL = TP1 partial + TP2 partial + final remaining portion
  const totalPnlUsdt =
    (trade.tp1PnlUsdt ?? 0) + (trade.tp2PnlUsdt ?? 0) + finalPnlUsdt;

  // -- Generate exit analysis --
  const { exitReason, exitAnalysis, improvements, errorTags } =
    await generateExitAnalysis(trade, status, exitPrice, pnlPercent);

  // -- Close in paper/live --
  // Closes only the remaining contracts; partial closes already happened at TP1/TP2.
  // Paper closePosition never throws; live throws on OKX rejection.
  try {
    await closePosition(trade.symbol, trade.direction, closeSize, exitPrice);
  } catch (err: any) {
    logger.error(`Failed to place close order for ${trade.symbol} #${trade.id}: ${err.message}`);
    sendErrorAlert(err.message, `Close position: ${trade.symbol} #${trade.id}`).catch(() => {});
    return; // position remains open; do not update DB, balance, or stats
  }

  // -- Update DB --
  // totalPnlUsdt (stored in pnl_usdt column) includes all partial close PnLs
  closeTrade(
    trade.id,
    exitPrice,
    status,
    result,
    parseFloat(pnlPercent.toFixed(4)),
    parseFloat(totalPnlUsdt.toFixed(4)),
    exitReason,
    exitAnalysis,
    improvements,
    errorTags,
  );

  // -- Update paper balance with FINAL portion only --
  // TP1 and TP2 partial PnLs were already applied in handlePartialClose.
  if (!config.trading.isLive) {
    updatePaperBalance(finalPnlUsdt);
  }

  // -- Update risk counters --
  recordTradeResult(pnlPercent);

  // -- Send Telegram notification --
  const updatedTrade = getTradeById(trade.id);
  if (updatedTrade) {
    await broadcastTradeClosed(updatedTrade, improvements);
  }

  tpHitMap.delete(trade.id);
  logger.info(
    `Trade ${trade.id} closed: ${status} | PnL: ${pnlPercent.toFixed(2)}% | ` +
    `Total USDT: ${totalPnlUsdt.toFixed(2)} (final: ${finalPnlUsdt.toFixed(2)})`,
  );
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
        // Skip stop_too_tight check if TP1 was hit and SL was already moved to breakeven
        if (!trade.tp1Hit && slDistance < 0.005) {
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
