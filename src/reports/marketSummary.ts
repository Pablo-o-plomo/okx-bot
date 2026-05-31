import { getRecentSignals, getLastNTrades, getRejectCountSince } from '../database/db';
import { getMarketComment } from '../utils/wittyComments';

export function generateMarketSummary(): string {
  const signals = getRecentSignals(30);
  const closed = getLastNTrades(30);
  const rejected = getRejectCountSince(24);
  const longCount = signals.filter(s => s.direction === 'LONG').length;
  const avgConfidence = signals.length ? signals.reduce((a, s) => a + s.confidence, 0) / signals.length : 0;
  const strongest = signals.filter(s => s.confidence >= avgConfidence).slice(0, 5).map(s => s.symbol.replace('-USDT-SWAP', ''));
  const weakest = closed.filter(t => (t.pnlPercent ?? 0) < 0).slice(0, 5).map(t => t.symbol.replace('-USDT-SWAP', ''));
  const highVol = signals.filter(s => s.indicatorSummary?.atrPercent >= 1.5).map(s => s.symbol.replace('-USDT-SWAP', ''));
  const mode = avgConfidence >= 8 && rejected < 20 ? 'агрессивный' : avgConfidence >= 6 ? 'нормальный' : 'защитный';

  return `
🌍 <b>Сводка рынка</b>

Тренд рынка: <b>${longCount >= signals.length / 2 ? 'бычий' : 'медвежий'}</b>
Сильнее выглядят: ${strongest.join(', ') || 'нет данных'}
Слабее выглядят: ${weakest.join(', ') || 'нет данных'}
Волатильность: ${highVol.length ? `высокая (${highVol.join(', ')})` : 'нормальная'}
Отклонено фильтрами за 24ч: <b>${rejected}</b>
Рекомендация: <b>${mode}</b>

🗣 <i>${getMarketComment(signals.length + rejected)}</i>
`.trim();
}
