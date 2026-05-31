import { getRejectStats, getRejectStatsBySymbol, getRejectStatsByTimeframe, getRejectCountSince } from '../database/db';

function lines<T>(items: T[], render: (item: T) => string): string {
  return items.length ? items.map(render).join('\n') : '• нет данных';
}

export function generateRejectStats(): string {
  const reasons = getRejectStats(8);
  const symbols = getRejectStatsBySymbol(5);
  const timeframes = getRejectStatsByTimeframe(5);
  const dayCount = getRejectCountSince(24);

  return `
🚫 <b>Reject Analytics</b>

Отклонено за 24ч: <b>${dayCount}</b>

<b>Top reject reasons:</b>
${lines(reasons, r => `• ${r.reason}: ${r.count}`)}

<b>Weakest symbols:</b>
${lines(symbols, s => `• ${s.symbol}: ${s.count}`)}

<b>Weakest timeframes:</b>
${lines(timeframes, t => `• ${t.timeframe}: ${t.count}`)}
`.trim();
}
