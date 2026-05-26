import type { Direction } from '../../database/models';

interface AntiFomoInput { direction: Direction; price: number; ema20: number; atrPercent: number; candleBodyPercent: number; movedAfterBreakoutPercent: number; riskReward: number; }

export function antiFomoFilter(i: AntiFomoInput): { pass: boolean; reason?: string } {
  const awayFromEma = Math.abs(i.price - i.ema20) / i.ema20 * 100;
  if (awayFromEma > 1.8) return { pass: false, reason: `Цена ушла от EMA20 на ${awayFromEma.toFixed(2)}%` };
  if (i.candleBodyPercent > 1.2) return { pass: false, reason: `Импульсная свеча (${i.candleBodyPercent.toFixed(2)}%) — поздний вход` };
  if (i.atrPercent > 2.8) return { pass: false, reason: 'ATR слишком высокий для безопасного входа' };
  if (i.riskReward < 2) return { pass: false, reason: `Risk/Reward ${i.riskReward.toFixed(2)} ниже 1:2` };
  if (i.movedAfterBreakoutPercent > 1.5) return { pass: false, reason: `После пробоя движение уже ${i.movedAfterBreakoutPercent.toFixed(2)}%` };
  return { pass: true };
}
