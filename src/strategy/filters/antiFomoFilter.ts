import type { Direction } from '../../database/models';

interface AntiFomoInput {
  direction: Direction;
  price: number;
  ema20: number;
  atrPercent: number;
  candleBodyPercent: number; // actually candle body measured in ATR multiples
  movedAfterBreakoutPercent: number;
  riskReward: number;
}

export function antiFomoFilter(i: AntiFomoInput): { pass: boolean; reason?: 'late_entry' | 'fomo_entry' | 'extended_move' | 'bad_risk_reward' | string } {
  const awayFromEma = Math.abs(i.price - i.ema20) / i.ema20 * 100;
  if (i.candleBodyPercent > 1.5) return { pass: false, reason: 'late_entry' };
  if (awayFromEma > 1.8) return { pass: false, reason: 'fomo_entry' };
  if (i.atrPercent > 2.8) return { pass: false, reason: 'extended_move' };
  if (i.riskReward < 2) return { pass: false, reason: 'bad_risk_reward' };
  if (i.movedAfterBreakoutPercent > 1.5) return { pass: false, reason: 'extended_move' };
  return { pass: true };
}
