import { config } from '../../config';

export function volatilityFilter(atrPercent: number, spreadPercent?: number): { pass: boolean; reason?: string } {
  if (atrPercent < config.trading.minAtrPercent) return { pass: false, reason: `ATR слишком низкий (${atrPercent.toFixed(2)}%)` };
  if (atrPercent > config.trading.maxAtrPercent) return { pass: false, reason: `ATR слишком высокий (${atrPercent.toFixed(2)}%)` };
  if (spreadPercent !== undefined && spreadPercent > atrPercent * 0.5) return { pass: false, reason: `Аномальный спред (${spreadPercent.toFixed(2)}%)` };
  return { pass: true };
}
