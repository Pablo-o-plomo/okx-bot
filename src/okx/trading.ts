import { okxClient } from './client';
import { config } from '../config';
import { logger } from '../utils/logger';
import { getBotState, updateBotState } from '../database/db';
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
  if (!config.trading.isLive || !config.okx.apiKey || !config.okx.apiSecret || !config.okx.passphrase) {
    return paperOrder(signal);
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
 * ⚠️ Only executes when LIVE_TRADING=true
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

  return {
    orderId: result[0].ordId,
    symbol: signal.symbol,
    side,
    price: signal.entryPrice,
    size: signal.positionSize,
    status: result[0].sCode === '0' ? 'placed' : 'failed',
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
  if (!config.trading.isLive || !config.okx.apiKey || !config.okx.apiSecret || !config.okx.passphrase) {
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

  return {
    orderId: result[0].ordId,
    symbol,
    side,
    price,
    size,
    status: result[0].sCode === '0' ? 'placed' : 'failed',
    paper: false,
  };
}

/**
 * Get account balance from OKX.
 */
export async function getAccountBalance(): Promise<number> {
  if (!config.trading.isLive || !config.okx.apiKey || !config.okx.apiSecret || !config.okx.passphrase) {
    // Return stored paper balance
    const state = getBotState();
    return state.totalBalance;
  }

  try {
    const data = await okxClient.privateGet<any[]>('/api/v5/account/balance', { ccy: 'USDT' });
    const usdtBal = data[0]?.details?.find((d: any) => d.ccy === 'USDT');
    return parseFloat(usdtBal?.availBal || '0');
  } catch (err: any) {
    logger.error(`Failed to fetch balance: ${err.message}`);
    const state = getBotState();
    return state.totalBalance;
  }
}

/**
 * Update paper balance after trade closes.
 */
export function updatePaperBalance(pnlUsdt: number): void {
  const state = getBotState();
  updateBotState({ totalBalance: state.totalBalance + pnlUsdt });
}
