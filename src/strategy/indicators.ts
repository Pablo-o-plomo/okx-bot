import type { Candle, IndicatorSnapshot } from '../database/models';

// ─── EMA ──────────────────────────────────────────────────────────────────────
export function ema(values: number[], period: number): number[] {
  if (values.length < period) return [];
  const k = 2 / (period + 1);
  const result: number[] = [];
  let emaPrev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result.push(...new Array(period - 1).fill(NaN));
  result.push(emaPrev);
  for (let i = period; i < values.length; i++) {
    emaPrev = values[i] * k + emaPrev * (1 - k);
    result.push(emaPrev);
  }
  return result;
}

export function lastEma(values: number[], period: number): number {
  const arr = ema(values, period);
  return arr[arr.length - 1] ?? NaN;
}

// ─── RSI ──────────────────────────────────────────────────────────────────────
export function rsi(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
}

// ─── MACD ─────────────────────────────────────────────────────────────────────
export interface MACDResult {
  macdLine: number;
  signalLine: number;
  histogram: number;
}

export function macd(
  closes: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9,
): MACDResult {
  const fastEma = ema(closes, fastPeriod);
  const slowEma = ema(closes, slowPeriod);

  // Align arrays (slow EMA is shorter)
  const offset = slowPeriod - fastPeriod;
  const macdLine: number[] = [];
  for (let i = 0; i < slowEma.length; i++) {
    const f = fastEma[i + offset];
    const s = slowEma[i];
    if (!isNaN(f) && !isNaN(s)) macdLine.push(f - s);
  }

  const signalArr = ema(macdLine, signalPeriod);
  const last = macdLine[macdLine.length - 1] ?? 0;
  const sig = signalArr[signalArr.length - 1] ?? 0;
  return {
    macdLine: last,
    signalLine: sig,
    histogram: last - sig,
  };
}

// ─── ATR ──────────────────────────────────────────────────────────────────────
export function atr(candles: Candle[], period = 14): number {
  if (candles.length < period + 1) return 0;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;
    trs.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }
  // Wilder smoothing
  let atrVal = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) {
    atrVal = (atrVal * (period - 1) + trs[i]) / period;
  }
  return atrVal;
}

// ─── Volume Analysis ──────────────────────────────────────────────────────────
export function volumeAnalysis(candles: Candle[], period = 20): { avg: number; current: number; ratio: number } {
  if (candles.length < period) return { avg: 0, current: 0, ratio: 1 };
  const recent = candles.slice(-period);
  const avg = recent.slice(0, -1).reduce((a, c) => a + c.volume, 0) / (period - 1);
  const current = candles[candles.length - 1].volume;
  return { avg, current, ratio: avg > 0 ? current / avg : 1 };
}

// ─── Support / Resistance ─────────────────────────────────────────────────────
export interface Level {
  price: number;
  strength: number; // how many times touched
  type: 'support' | 'resistance';
}

export function findLevels(candles: Candle[], lookback = 50, tolerance = 0.003): Level[] {
  const slice = candles.slice(-lookback);
  const levels: Level[] = [];

  // Find swing highs and lows
  for (let i = 2; i < slice.length - 2; i++) {
    const c = slice[i];
    const isSwingHigh =
      c.high > slice[i - 1].high &&
      c.high > slice[i - 2].high &&
      c.high > slice[i + 1].high &&
      c.high > slice[i + 2].high;

    const isSwingLow =
      c.low < slice[i - 1].low &&
      c.low < slice[i - 2].low &&
      c.low < slice[i + 1].low &&
      c.low < slice[i + 2].low;

    if (isSwingHigh) levels.push({ price: c.high, strength: 1, type: 'resistance' });
    if (isSwingLow) levels.push({ price: c.low, strength: 1, type: 'support' });
  }

  // Merge nearby levels
  const merged: Level[] = [];
  for (const lvl of levels) {
    const existing = merged.find(m => Math.abs(m.price - lvl.price) / lvl.price < tolerance && m.type === lvl.type);
    if (existing) {
      existing.strength++;
      existing.price = (existing.price + lvl.price) / 2;
    } else {
      merged.push({ ...lvl });
    }
  }

  return merged.sort((a, b) => b.strength - a.strength);
}

// ─── Breakout Detection ───────────────────────────────────────────────────────
export function detectBreakout(
  candles: Candle[],
  levels: Level[],
  direction: 'LONG' | 'SHORT',
): { isBreakout: boolean; level: number; isFalse: boolean } {
  if (candles.length < 3 || levels.length === 0) {
    return { isBreakout: false, level: 0, isFalse: false };
  }

  const current = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const twoBack = candles[candles.length - 3];

  if (direction === 'LONG') {
    const resistanceLevels = levels.filter(l => l.type === 'resistance' && l.price > twoBack.close * 0.998 && l.price < current.high * 1.01);
    for (const lvl of resistanceLevels) {
      if (prev.close < lvl.price && current.close > lvl.price) {
        // Check for false breakout: closed back below level
        const isFalse = current.close < lvl.price;
        return { isBreakout: true, level: lvl.price, isFalse };
      }
    }
  } else {
    const supportLevels = levels.filter(l => l.type === 'support' && l.price < twoBack.close * 1.002 && l.price > current.low * 0.99);
    for (const lvl of supportLevels) {
      if (prev.close > lvl.price && current.close < lvl.price) {
        const isFalse = current.close > lvl.price;
        return { isBreakout: true, level: lvl.price, isFalse };
      }
    }
  }

  return { isBreakout: false, level: 0, isFalse: false };
}

// ─── Trend Detection ──────────────────────────────────────────────────────────
export function detectTrend(
  price: number,
  ema20: number,
  ema50: number,
  ema200: number,
): 'bullish' | 'bearish' | 'neutral' {
  const bullishPoints = [
    price > ema200 ? 1 : 0,
    price > ema50 ? 1 : 0,
    price > ema20 ? 1 : 0,
    ema20 > ema50 ? 1 : 0,
    ema50 > ema200 ? 1 : 0,
  ].reduce((a, b) => a + b, 0);

  if (bullishPoints >= 4) return 'bullish';
  if (bullishPoints <= 1) return 'bearish';
  return 'neutral';
}

// ─── Full Indicator Snapshot ──────────────────────────────────────────────────
export function computeIndicators(candles: Candle[], timeframe: string): IndicatorSnapshot | null {
  if (candles.length < 50) return null;

  const closes = candles.map(c => c.close);
  const price = closes[closes.length - 1];

  const e20 = lastEma(closes, 20);
  const e50 = lastEma(closes, 50);
  const e200 = lastEma(closes, Math.min(200, closes.length - 1));
  const rsiVal = rsi(closes, 14);
  const macdVal = macd(closes);
  const atrVal = atr(candles, 14);
  const vol = volumeAnalysis(candles, 20);
  const trend = detectTrend(price, e20, e50, e200);

  return {
    price,
    ema20: e20,
    ema50: e50,
    ema200: e200,
    rsi: rsiVal,
    macdLine: macdVal.macdLine,
    macdSignal: macdVal.signalLine,
    macdHistogram: macdVal.histogram,
    atr: atrVal,
    volumeAvg: vol.avg,
    volumeCurrent: vol.current,
    trend,
    timeframe,
    timestamp: candles[candles.length - 1].timestamp,
  };
}
