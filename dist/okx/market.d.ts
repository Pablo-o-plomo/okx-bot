import type { Candle } from '../database/models';
/**
 * Fetch OHLCV candles from OKX.
 * Returns candles sorted oldest newest.
 */
export declare function getCandles(symbol: string, timeframe: string, limit?: number): Promise<Candle[]>;
/**
 * Fetch current ticker price.
 */
export declare function getTicker(symbol: string): Promise<number>;
/**
 * Fetch instrument info (tick size, lot size, etc.)
 */
export declare function getInstrumentInfo(symbol: string): Promise<{
    tickSz: number;
    lotSz: number;
    minSz: number;
    ctVal: number;
    instType: string;
} | null>;
export interface InstrumentTradeParams {
    ctVal: number;
    lotSz: number;
    minSz: number;
}
export declare function getInstrumentTradeParams(symbol: string): Promise<InstrumentTradeParams>;
/**
 * Get funding rate for swaps (used for risk awareness).
 */
export declare function getFundingRate(symbol: string): Promise<number>;
//# sourceMappingURL=market.d.ts.map