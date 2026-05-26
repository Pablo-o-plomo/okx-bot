import { okxClient } from './client';
import { logger } from '../utils/logger';
import type { Candle } from '../database/models';

// OKX timeframe mapping
const TF_MAP: Record<string, string> = {
  '1m': '1m', '3m': '3m', '5m': '5m', '15m': '15m', '30m': '30m',
  '1H': '1H', '2H': '2H', '4H': '4H', '6H': '6H', '12H': '12H',
  '1D': '1D', '1W': '1W',
};

/**
 * Fetch OHLCV candles from OKX.
 * Returns candles sorted oldest → newest.
 */
export async function getCandles(
  symbol: string,
  timeframe: string,
  limit = 200,
): Promise<Candle[]> {
  const bar = TF_MAP[timeframe] || timeframe;

  try {
    // OKX returns: [ts, open, high, low, close, vol, volCcy, volCcyQuote, confirm]
    const raw = await okxClient.publicGet<string[][]>('/api/v5/market/candles', {
      instId: symbol,
      bar,
      limit: String(limit),
    });

    const candles: Candle[] = raw.map(c => ({
      timestamp: parseInt(c[0]),
      open: parseFloat(c[1]),
      high: parseFloat(c[2]),
      low: parseFloat(c[3]),
      close: parseFloat(c[4]),
      volume: parseFloat(c[5]),
    }));

    // OKX returns newest first — reverse to oldest first
    return candles.reverse();
  } catch (err: any) {
    logger.error(`Failed to fetch candles for ${symbol} ${timeframe}: ${err.message}`);
    return [];
  }
}

/**
 * Fetch current ticker price.
 */
export async function getTicker(symbol: string): Promise<number> {
  try {
    const data = await okxClient.publicGet<any[]>('/api/v5/market/ticker', { instId: symbol });
    return parseFloat(data[0].last);
  } catch (err: any) {
    logger.error(`Failed to fetch ticker for ${symbol}: ${err.message}`);
    return 0;
  }
}

/**
 * Fetch instrument info (tick size, lot size, etc.)
 */
export async function getInstrumentInfo(symbol: string): Promise<{
  tickSz: number;
  lotSz: number;
  minSz: number;
  ctVal: number; // contract value (for swaps)
  instType: string;
} | null> {
  try {
    const instType = symbol.endsWith('-SWAP') ? 'SWAP' : 'SPOT';
    const data = await okxClient.publicGet<any[]>('/api/v5/public/instruments', {
      instType,
      instId: symbol,
    });
    if (!data || !data[0]) return null;
    const inst = data[0];
    return {
      tickSz: parseFloat(inst.tickSz),
      lotSz: parseFloat(inst.lotSz),
      minSz: parseFloat(inst.minSz),
      ctVal: parseFloat(inst.ctVal || '1'),
      instType,
    };
  } catch (err: any) {
    logger.error(`Failed to fetch instrument info for ${symbol}: ${err.message}`);
    return null;
  }
}

/**
 * Get funding rate for swaps (used for risk awareness).
 */
export async function getFundingRate(symbol: string): Promise<number> {
  if (!symbol.endsWith('-SWAP')) return 0;
  try {
    const data = await okxClient.publicGet<any[]>('/api/v5/public/funding-rate', { instId: symbol });
    return parseFloat(data[0]?.fundingRate || '0');
  } catch {
    return 0;
  }
}
