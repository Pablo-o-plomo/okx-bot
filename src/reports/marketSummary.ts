import { getRecentSignals, getLastNTrades } from '../database/db';

export function generateMarketSummary(): string {
  const signals = getRecentSignals(30);
  const closed = getLastNTrades(30);
  const longCount = signals.filter(s => s.direction === 'LONG').length;
  const avgConfidence = signals.length ? signals.reduce((a, s) => a + s.confidence, 0) / signals.length : 0;
  const highVol = signals.filter(s => s.indicatorSummary?.atrPercent >= 1.5).map(s => s.symbol);
  const rejectedApprox = Math.max(0, 30 - signals.length);
  const mode = avgConfidence >= 8 ? 'aggressive' : avgConfidence >= 6 ? 'normal' : 'defensive';
  return `📈 <b>Market Summary</b>\nТренд: ${longCount >= signals.length / 2 ? 'бычий' : 'медвежий'}\nСильнее выглядят: ${signals.slice(0,3).map(s=>s.symbol).join(', ') || 'n/a'}\nВысокая волатильность: ${highVol.join(', ') || 'нет'}\nОтклонено фильтрами: ~${rejectedApprox}\nРекомендация: <b>${mode}</b>`;
}
