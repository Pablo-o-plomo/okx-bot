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

function money(value: number): string {
  return `${value >= 0 ? '+' : ''}${Math.round(value).toLocaleString('ru-RU')} ₽`;
}

function signedPercent(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function pnlIcon(value: number): string {
  if (value > 0) return '🟢';
  if (value < 0) return '🔴';
  return '⚪';
}

function riskLabel(openTrades: BcsTrade[], depositRub: number): { icon: string; label: string } {
  const exposure = openTrades.reduce((sum, trade) => sum + trade.entryPrice * trade.quantity, 0);
  const exposurePercent = depositRub > 0 ? (exposure / depositRub) * 100 : 0;
  if (exposurePercent > 70 || openTrades.length >= 5) return { icon: '🔴', label: 'высокий' };
  if (exposurePercent > 35 || openTrades.length >= 3) return { icon: '🟡', label: 'средний' };
  return { icon: '🟢', label: 'низкий' };
}

function bestAsset(openTrades: BcsTrade[], closedTrades: BcsTrade[]): string {
  const closedBest = [...closedTrades].sort((a, b) => b.pnlPercent - a.pnlPercent)[0];
  if (closedBest) return `${closedBest.ticker} ${signedPercent(closedBest.pnlPercent)}`;
  const firstOpen = openTrades[0];
  return firstOpen ? `${firstOpen.ticker} в фокусе` : 'нет данных';
}

function positionLines(openTrades: BcsTrade[]): string {
  if (!openTrades.length) return '• нет открытых позиций';
  return openTrades.slice(0, 8).map(trade => {
    const directionIcon = trade.direction === 'LONG' ? '📈' : '📉';
    return `• ${directionIcon} <b>${trade.ticker}</b> @ ${trade.entryPrice.toLocaleString('ru-RU')} · SL ${trade.stopLoss} · TP ${trade.takeProfit}`;
  }).join('\n');
}

function aiPortfolioComment(pnl: number, openTrades: BcsTrade[]): string {
  const bias = pnl > 0 ? 'умеренно bullish' : pnl < 0 ? 'осторожный / risk-off' : 'нейтральный';
  const banks = openTrades.some(trade => ['SBER', 'VTBR'].includes(trade.ticker.toUpperCase())) ? 'Банки сильнее рынка.' : 'Банки без явного перевеса.';
  return `Рынок ${bias}.\nНефть поддерживает индекс.\n${banks}`;
}

export function formatPortfolio(openTrades: BcsTrade[], closedTrades: BcsTrade[], depositRub = config.bcs.defaultDepositRub): string {
  const pnl = totalPnl(closedTrades);
  const pnlPercent = depositRub > 0 ? (pnl / depositRub) * 100 : 0;
  const balance = depositRub + pnl;
  const exposure = openTrades.reduce((sum, trade) => sum + trade.entryPrice * trade.quantity, 0);
  const freeCash = Math.max(0, balance - exposure);
  const risk = riskLabel(openTrades, depositRub);

  return `💼 <b>ПОРТФЕЛЬ</b>

🟢 Баланс: <b>${Math.round(balance).toLocaleString('ru-RU')} ₽</b>
${pnlIcon(pnl)} Сегодня: <b>${money(pnl)}</b> (${signedPercent(pnlPercent)})
💰 Свободно: <b>${Math.round(freeCash).toLocaleString('ru-RU')} ₽</b>
🔥 Лучший актив: <b>${bestAsset(openTrades, closedTrades)}</b>
${risk.icon} Риск: <b>${risk.label}</b>

📦 <b>Позиции</b>
${positionLines(openTrades)}

🧠 <b>AI</b>
${aiPortfolioComment(pnl, openTrades)}`;
}

export function formatDailyBcsReport(trades: BcsTrade[], depositRub = config.bcs.defaultDepositRub): string {
  const open = trades.filter(t => t.status === 'open');
  const closed = trades.filter(t => t.status === 'closed');
  const pnl = totalPnl(trades);
  const fees = totalFees(trades);
  const best = [...closed].sort((a, b) => b.pnlRub - a.pnlRub)[0];
  const worst = [...closed].sort((a, b) => a.pnlRub - b.pnlRub)[0];
  const pnlPercent = depositRub > 0 ? (pnl / depositRub) * 100 : 0;

  return `📋 <b>DAILY DESK</b>

${pnlIcon(pnl)} P&L: <b>${money(pnl)}</b> · ${signedPercent(pnlPercent)}
💸 Fees: <b>${money(-Math.abs(fees))}</b>
🎯 Winrate: <b>${winrate(trades).toFixed(1)}%</b>
📦 Open: <b>${open.length}</b> · Closed: <b>${closed.length}</b>

🏆 Best: ${best ? formatTradeLine(best) : 'нет данных'}
🧊 Worst: ${worst ? formatTradeLine(worst) : 'нет данных'}

${closed.length ? closed.slice(0, 8).map(formatTradeLine).join('\n') : '⚪ Закрытых сделок сегодня нет.'}`;
}

export function formatMonthlyBcsReport(trades: BcsTrade[]): string {
  const closed = trades.filter(t => t.status === 'closed');
  const byTicker = new Map<string, number>();
  for (const trade of closed) byTicker.set(trade.ticker, (byTicker.get(trade.ticker) ?? 0) + trade.pnlRub);
  const sorted = [...byTicker.entries()].sort((a, b) => b[1] - a[1]);
  const pnl = totalPnl(trades);

  return `📊 <b>MONTHLY BOARD</b>

${pnlIcon(pnl)} P&L: <b>${money(pnl)}</b>
💸 Комиссии: <b>${money(-Math.abs(totalFees(trades)))}</b>
🎯 Winrate: <b>${winrate(trades).toFixed(1)}%</b>

🚀 Leaders:
${sorted.slice(0, 3).map(([ticker, value]) => `• ${ticker} ${money(value)}`).join('\n') || '• нет данных'}

🧯 Drag:
${sorted.slice(-3).reverse().map(([ticker, value]) => `• ${ticker} ${money(value)}`).join('\n') || '• нет данных'}

🧠 AI: снижать размер позиции после серии убытков, комиссии учитывать до входа.`;
}

export function formatDiary(openTrades: BcsTrade[], closedTrades: BcsTrade[]): string {
  return `📋 <b>TRADE BLOTTER</b>

📦 <b>Open</b>
${openTrades.length ? openTrades.map(t => `• #${t.id} <b>${t.ticker}</b> ${t.direction} · entry ${t.entryPrice} · SL ${t.stopLoss} · TP ${t.takeProfit}`).join('\n') : '• нет'}

✅ <b>Closed</b>
${closedTrades.length ? closedTrades.slice(0, 10).map(formatTradeLine).join('\n') : '• нет'}

⚠️ Не является инвестиционной рекомендацией.`;
}
