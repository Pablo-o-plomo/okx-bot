import { getOpenTrades, getRejectStats, getRejectCountSince, getWinrateBySymbol } from '../database/db';
import { getRuntimeMetrics } from '../utils/runtimeMetrics';

export function generateHeartbeatReport(): string {
  const runtime = getRuntimeMetrics();
  const rejectsLastHour = getRejectCountSince(1);
  const topRejects = getRejectStats(3);
  const openTrades = getOpenTrades().length;
  const winrates = getWinrateBySymbol();
  const avgWinrate = winrates.length
    ? winrates.reduce((sum, row) => sum + row.winrate, 0) / winrates.length
    : null;

  return `
💓 <b>Бот работает</b>

Просканировано сигналов: <b>${runtime.signalsScanned}</b>
Принято: <b>${runtime.signalsAccepted}</b>
Отклонено за 1ч: <b>${rejectsLastHour}</b>

<b>Топ причин отклонения:</b>
${topRejects.length ? topRejects.map(r => `• ${r.reason}: ${r.count}`).join('\n') : '• нет данных'}

Открытых сделок: <b>${openTrades}</b>
Винрейт: <b>${avgWinrate === null ? 'Недостаточно данных для расчета винрейта.' : `${avgWinrate.toFixed(0)}%`}</b>
`.trim();
}
