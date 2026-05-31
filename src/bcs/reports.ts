import { config } from '../config';
import type { BcsTrade } from './db';
import { formatRub, formatTradeLine } from './risk';

function winrate(trades: BcsTrade[]): number {
  const closed = trades.filter(t => t.status === 'closed');
  if (closed.length === 0) return 0;
  return (closed.filter(t => t.pnlRub > 0).length / closed.length) * 100;
}

function totalPnl(trades: BcsTrade[]): number {
  return trades.filter(t => t.status === 'closed').reduce((sum, trade) => sum + trade.pnlRub, 0);
}

function totalFees(trades: BcsTrade[]): number {
  return trades.reduce((sum, trade) => sum + trade.commissionRub, 0);
}

export function formatPortfolio(openTrades: BcsTrade[], closedTrades: BcsTrade[], depositRub = config.bcs.defaultDepositRub): string {
  const pnl = totalPnl(closedTrades);
  return `📊 <b>Портфель</b>

Депозит: ${depositRub.toFixed(2)} ₽
Открытые позиции: ${openTrades.length}
Закрытые сделки: ${closedTrades.length}
P&L: ${formatRub(pnl)}
Winrate: ${winrate(closedTrades).toFixed(1)}%

${openTrades.length ? `<b>Открытые:</b>\n${openTrades.map(t => `#${t.id} ${t.ticker} ${t.direction} @ ${t.entryPrice}`).join('\n')}` : 'Открытых позиций нет.'}`;
}

export function formatDailyBcsReport(trades: BcsTrade[], depositRub = config.bcs.defaultDepositRub): string {
  const open = trades.filter(t => t.status === 'open');
  const closed = trades.filter(t => t.status === 'closed');
  const pnl = totalPnl(trades);
  const best = [...closed].sort((a, b) => b.pnlRub - a.pnlRub)[0];
  const worst = [...closed].sort((a, b) => a.pnlRub - b.pnlRub)[0];
  return `📅 <b>Отчет за день</b>

Депозит: ${depositRub.toFixed(2)} ₽
Открытые позиции: ${open.length}
Закрытые сделки: ${closed.length}
Прибыль/убыток: ${formatRub(pnl)}
Комиссии: ${formatRub(totalFees(trades))}
Winrate: ${winrate(trades).toFixed(1)}%

Лучшая сделка: ${best ? formatTradeLine(best) : 'нет данных'}
Худшая сделка: ${worst ? formatTradeLine(worst) : 'нет данных'}

${closed.length ? closed.map(formatTradeLine).join('\n') : 'Закрытых сделок сегодня нет.'}`;
}

export function formatMonthlyBcsReport(trades: BcsTrade[]): string {
  const closed = trades.filter(t => t.status === 'closed');
  const byTicker = new Map<string, number>();
  for (const trade of closed) byTicker.set(trade.ticker, (byTicker.get(trade.ticker) ?? 0) + trade.pnlRub);
  const sorted = [...byTicker.entries()].sort((a, b) => b[1] - a[1]);
  return `📆 <b>Отчет за месяц</b>

P&L: ${formatRub(totalPnl(trades))}
Комиссии: ${formatRub(totalFees(trades))}
Средний риск: считается по журналу сделок
Winrate: ${winrate(trades).toFixed(1)}%

Лучшие инструменты: ${sorted.slice(0, 3).map(([ticker, pnl]) => `${ticker} ${formatRub(pnl)}`).join(', ') || 'нет данных'}
Худшие инструменты: ${sorted.slice(-3).map(([ticker, pnl]) => `${ticker} ${formatRub(pnl)}`).join(', ') || 'нет данных'}

Рекомендации: не превышать риск на сделку и не входить без понятного стопа.`;
}

export function formatDiary(openTrades: BcsTrade[], closedTrades: BcsTrade[]): string {
  return `📋 <b>Дневник сделок</b>

<b>Открытые:</b>
${openTrades.length ? openTrades.map(t => `#${t.id} ${t.ticker} ${t.direction} вход ${t.entryPrice}, стоп ${t.stopLoss}, тейк ${t.takeProfit}`).join('\n') : 'нет'}

<b>Закрытые:</b>
${closedTrades.length ? closedTrades.slice(0, 10).map(formatTradeLine).join('\n') : 'нет'}

⚠️ Это не инвестиционная рекомендация.`;
}
