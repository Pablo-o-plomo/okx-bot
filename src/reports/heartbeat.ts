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
💓 <b>Bot Alive</b>

Signals scanned: <b>${runtime.signalsScanned}</b>
Accepted: <b>${runtime.signalsAccepted}</b>
Rejected (1h): <b>${rejectsLastHour}</b>

<b>Top rejects:</b>
${topRejects.length ? topRejects.map(r => `• ${r.reason}: ${r.count}`).join('\n') : '• нет данных'}

Open trades: <b>${openTrades}</b>
Winrate: <b>${avgWinrate === null ? 'Недостаточно данных для расчета winrate.' : `${avgWinrate.toFixed(0)}%`}</b>
`.trim();
}
