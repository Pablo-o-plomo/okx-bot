import type { Direction, IndicatorSnapshot } from '../database/models';

interface Inputs { direction: Direction; primary: IndicatorSnapshot; confirm: IndicatorSnapshot; trend: IndicatorSnapshot; volumeRatio: number; atrPercent: number; breakoutConfirmed: boolean; riskReward: number; }

export function scoreSignalConfidence(input: Inputs): { score: number; reasons: string[] } {
  const reasons: string[] = []; let score = 0; let max = 0;
  const add = (met: boolean, w: number, reason: string) => { max += w; if (met) { score += w; reasons.push(reason);} };
  const isLong = input.direction === 'LONG';
  add(isLong ? input.primary.ema20 > input.primary.ema50 && input.primary.ema50 > input.primary.ema200 : input.primary.ema20 < input.primary.ema50 && input.primary.ema50 < input.primary.ema200, 2, 'EMA 20/50/200 выстроены по тренду');
  add(isLong ? input.primary.rsi >= 45 && input.primary.rsi <= 68 : input.primary.rsi >= 32 && input.primary.rsi <= 55, 1, 'RSI в рабочей зоне');
  add(isLong ? input.primary.macdHistogram > 0 && input.confirm.macdHistogram > 0 : input.primary.macdHistogram < 0 && input.confirm.macdHistogram < 0, 1.5, 'MACD подтверждает импульс');
  add(input.volumeRatio > 1.15, 1, 'Объем подтверждает движение');
  add(input.atrPercent >= 0.2 && input.atrPercent <= 3, 1, 'Волатильность ATR в норме');
  add(input.breakoutConfirmed, 1.5, 'Есть подтверждение пробоя/уровня');
  add(input.primary.trend === input.confirm.trend && input.confirm.trend === input.trend.trend, 1, 'Тренд подтвержден на нескольких ТФ');
  add(input.riskReward >= 2, 1, 'Соотношение риск/прибыль не ниже 1:2');
  return { score: Math.max(1, Math.min(10, Math.round((score / max) * 10))), reasons };
}
