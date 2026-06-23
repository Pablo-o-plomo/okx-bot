import { okxClient } from './client';
import { config } from '../config';
import { logger } from '../utils/logger';
import { getBotState, getPaperTradingBalance, updateBotState } from '../database/db';
import type { Signal } from '../database/models';

export interface OrderResult {
  orderId: string;
  symbol: string;
  side: string;
  price: number;
  size: number;
  status: string;
  paper: boolean;
}

let paperOrderCounter = 1000;

/**
 * Place order — routes to paper or live depending on config.
 */
export async function placeOrder(signal: Signal): Promise<OrderResult> {
  if (!config.trading.isLive) {
    return paperOrder(signal);
  }

  if (!config.trading.autoTrade) {
    logger.warn('LIVE trade execution requested but AUTO_TRADE=false; order not sent');
    return {
      orderId: `SKIPPED-${paperOrderCounter++}`,
      symbol: signal.symbol,
      side: signal.direction === 'LONG' ? 'buy' : 'sell',
      price: signal.entryPrice,
      size: signal.positionSize,
      status: 'skipped',
      paper: true,
    };
  }

  return liveOrder(signal);
}

/**
 * Paper trading — simulates order fill at entry price.
 */
function paperOrder(signal: Signal): OrderResult {
  const orderId = `PAPER-${paperOrderCounter++}`;
  logger.info(`📄 Paper order: ${signal.direction} ${signal.symbol} @ ${signal.entryPrice}`);
  return {
    orderId,
    symbol: signal.symbol,
    side: signal.direction === 'LONG' ? 'buy' : 'sell',
    price: signal.entryPrice,
    size: signal.positionSize,
    status: 'filled',
    paper: true,
  };
}

/**
 * Live order via OKX API.
 * ⚠️ Only executes when TRADING_MODE=live and AUTO_TRADE=true
 */
async function liveOrder(signal: Signal): Promise<OrderResult> {
  logger.warn(`🔴 LIVE ORDER: ${signal.direction} ${signal.symbol} @ ${signal.entryPrice}`);

  const side = signal.direction === 'LONG' ? 'buy' : 'sell';
  const instType = signal.symbol.endsWith('-SWAP') ? 'SWAP' : 'SPOT';

  const orderData: Record<string, unknown> = {
    instId: signal.symbol,
    tdMode: instType === 'SWAP' ? 'cross' : 'cash',
    side,
    ordType: 'limit',
    px: String(signal.entryPrice),
    sz: String(signal.positionSize),
  };

  if (instType === 'SWAP' && signal.leverage > 1) {
    // Set leverage first
    try {
      await okxClient.privatePost('/api/v5/account/set-leverage', {
        instId: signal.symbol,
        lever: String(signal.leverage),
        mgnMode: 'cross',
      });
    } catch (err: any) {
      logger.error(`Failed to set leverage: ${err.message}`);
    }
  }

  const result = await okxClient.privatePost<any[]>('/api/v5/trade/order', orderData);

  if (result[0].sCode !== '0') {
    throw new Error(`OKX order rejected: sCode=${result[0].sCode} msg=${result[0].sMsg}`);
  }

  return {
    orderId: result[0].ordId,
    symbol: signal.symbol,
    side,
    price: signal.entryPrice,
    size: signal.positionSize,
    status: 'placed',
    paper: false,
  };
}

/**
 * Move stop loss to breakeven (live or paper).
 */
export async function moveStopLossToBreakeven(
  symbol: string,
  direction: 'LONG' | 'SHORT',
  size: number,
  stopLoss: number,
): Promise<OrderResult> {
  if (!config.trading.isLive || !config.trading.autoTrade) {
    const orderId = `PAPER-SL-BE-${paperOrderCounter++}`;
    logger.info(`📄 Paper SL moved to breakeven: ${symbol} @ ${stopLoss}`);
    return { orderId, symbol, side: direction === 'LONG' ? 'sell' : 'buy', price: stopLoss, size, status: 'updated', paper: true };
  }

  const side = direction === 'LONG' ? 'sell' : 'buy';
  const result = await okxClient.privatePost<any[]>('/api/v5/trade/order-algo', {
    instId: symbol,
    tdMode: symbol.endsWith('-SWAP') ? 'cross' : 'cash',
    side,
    ordType: 'conditional',
    sz: String(size),
    slTriggerPx: String(stopLoss),
    slOrdPx: '-1',
    reduceOnly: true,
  });

  if (result[0].sCode !== '0') {
    throw new Error(`OKX algo order rejected: sCode=${result[0].sCode} msg=${result[0].sMsg}`);
  }

  return {
    orderId: result[0].algoId ?? result[0].ordId,
    symbol,
    side,
    price: stopLoss,
    size,
    status: 'updated',
    paper: false,
  };
}

/**
 * Close a position (live or paper).
 */
export async function closePosition(
  symbol: string,
  direction: 'LONG' | 'SHORT',
  size: number,
  price: number,
): Promise<OrderResult> {
  if (!config.trading.isLive || !config.trading.autoTrade) {
    const orderId = `PAPER-CLOSE-${paperOrderCounter++}`;
    logger.info(`📄 Paper close: ${symbol} @ ${price}`);
    return { orderId, symbol, side: direction === 'LONG' ? 'sell' : 'buy', price, size, status: 'filled', paper: true };
  }

  const side = direction === 'LONG' ? 'sell' : 'buy';
  const result = await okxClient.privatePost<any[]>('/api/v5/trade/order', {
    instId: symbol,
    tdMode: symbol.endsWith('-SWAP') ? 'cross' : 'cash',
    side,
    ordType: 'market',
    sz: String(size),
  });

  if (result[0].sCode !== '0') {
    throw new Error(`OKX close order rejected: sCode=${result[0].sCode} msg=${result[0].sMsg}`);
  }

  return {
    orderId: result[0].ordId,
    symbol,
    side,
    price,
    size,
    status: 'placed',
    paper: false,
  };
}

/**
 * Cancel an active SL algo order on OKX.
 * No-op in paper/demo mode.
 */
export async function cancelAlgoOrder(symbol: string, algoId: string): Promise<void> {
  if (!config.trading.isLive || !config.trading.autoTrade) return;

  // OKX cancel-algos expects an array body; cast bypasses Record<string, unknown> constraint
  const result = await okxClient.privatePost<any[]>(
    '/api/v5/trade/cancel-algos',
    [{ algoId, instId: symbol }] as unknown as Record<string, unknown>,
  );

  if (result[0]?.sCode !== '0') {
    throw new Error(
      `OKX cancel algo failed: algoId=${algoId} sCode=${result[0]?.sCode} msg=${result[0]?.sMsg}`,
    );
  }
}

async function fetchOkxUsdtBalance(): Promise<number> {
  const data = await okxClient.privateGet<any[]>('/api/v5/account/balance', { ccy: 'USDT' });
  const usdtBal = data[0]?.details?.find((d: any) => d.ccy === 'USDT');
  return parseFloat(usdtBal?.availBal || '0');
}

/**
 * Get real OKX account balance for display/reference purposes.
 */
export async function getOkxAccountBalance(): Promise<number | null> {
  try {
    return await fetchOkxUsdtBalance();
  } catch (err: any) {
    logger.warn(`Failed to fetch OKX balance: ${err.message}`);
    return null;
  }
}

/**
 * Get trading balance used by sizing/risk/execution.
 */
export async function getAccountBalance(): Promise<number> {
  if (!config.trading.isLive) {
    // Internal paper trading always uses the virtual SQLite balance.
    return getPaperTradingBalance();
  }

  const okxBalance = await getOkxAccountBalance();
  if (okxBalance !== null) return okxBalance;

  const state = getBotState();
  return state.totalBalance;
}

/**
 * Update paper balance after trade closes.
 */
export function updatePaperBalance(pnlUsdt: number): void {
  const balance = getPaperTradingBalance();
  updateBotState({ totalBalance: balance + pnlUsdt });
}
