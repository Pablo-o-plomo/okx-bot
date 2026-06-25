import type { Candle, IndicatorSnapshot } from '../database/models';
export declare function ema(values: number[], period: number): number[];
export declare function lastEma(values: number[], period: number): number;
export declare function rsi(closes: number[], period?: number): number;
export interface MACDResult {
    macdLine: number;
    signalLine: number;
    histogram: number;
}
export declare function macd(closes: number[], fastPeriod?: number, slowPeriod?: number, signalPeriod?: number): MACDResult;
export declare function atr(candles: Candle[], period?: number): number;
export declare function volumeAnalysis(candles: Candle[], period?: number): {
    avg: number;
    current: number;
    ratio: number;
};
export interface Level {
    price: number;
    strength: number;
    type: 'support' | 'resistance';
}
export declare function findLevels(candles: Candle[], lookback?: number, tolerance?: number): Level[];
export declare function detectBreakout(candles: Candle[], levels: Level[], direction: 'LONG' | 'SHORT'): {
    isBreakout: boolean;
    level: number;
    isFalse: boolean;
};
export declare function detectTrend(price: number, ema20: number, ema50: number, ema200: number | null): 'bullish' | 'bearish' | 'neutral';
export declare function computeIndicators(candles: Candle[], timeframe: string): IndicatorSnapshot | null;
//# sourceMappingURL=indicators.d.ts.map