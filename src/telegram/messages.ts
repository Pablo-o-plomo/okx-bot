import { config } from '../config';
import type { Signal, Trade, AnalysisReport, TradeProgress } from '../database/models';
import { formatDirection, formatPercent, formatPrice, formatTradingViewLink, formatUnsignedPercent } from '../utils/formatPrice';
import { getBreakevenComment, getCloseComment, getOpenComment, getStopComment, getTpComment, getWeakSignalComment } from '../utils/wittyComments';

function normalizeBullets(text?: string): string[] {
  if (!text) return [];
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => line.replace(/^[-•]\s*/, ''));
}

function bullets(items: string[]): string {
  return items.length ? items.map(item => `• ${item}`).join('\n') : '• нет данных';
}

function progressLines(progress?: TradeProgress): string {
  const p = progress ?? { tp1: false, tp2: false, tp3: false, breakeven: false, partiallyClosed: false };
  return [
    `TP1 ${p.tp1 ? '✅' : '⏳'}`,
    `TP2 ${p.tp2 ? '✅' : '⏳'}`,
    `TP3 ${p.tp3 ? '✅' : '⏳'}`,
    ...(p.breakeven ? ['BE ✅'] : []),
  ].join('\n');
}

function volumeLabel(ratio: number, state?: string): string {
  if (!ratio) return 'нет данных';
  if (state === 'high' || ratio >= 1.5) return `high (x${ratio.toFixed(1)})`;
  if (state === 'weak' || ratio < 0.7) return `weak (x${ratio.toFixed(1)})`;
  return `normal (x${ratio.toFixed(1)})`;
}

function signalTone(signal: Signal): string {
  if (signal.warnings.length > 0) return '🟡 Осторожный сигнал';
  if (signal.confidence >= 8) return '🟢 Сильный сигнал';
  return '🟡 Нормальный сигнал';
}

export function formatSignalMessage(signal: Signal): string {
  const signalStatus = config.trading.isLive ? '🔴 LIVE SIGNAL' : '🟡 PAPER SIGNAL';
  const tvLink = formatTradingViewLink(signal.symbol);
  const summary = signal.indicatorSummary;
  const warnings = [...(signal.warnings ?? [])];
  const humanComment = warnings.some(w => w.toLowerCase().includes('объем'))
    ? getWeakSignalComment(signal.entryPrice)
    : getOpenComment(signal.entryPrice);

  return `
<b>${signalStatus}</b>

🚨 <b>${signal.symbol}</b> | ${formatDirection(signal.direction)}
⏱ ${signal.timeframeConfirmations.join(' / ')}

💵 Entry: <b>${formatPrice(signal.symbol, signal.entryPrice)}</b>
🛑 SL: <b>${formatPrice(signal.symbol, signal.stopLoss)}</b>

🎯 TP1: <b>${formatPrice(signal.symbol, signal.takeProfit1)}</b>
🎯 TP2: <b>${formatPrice(signal.symbol, signal.takeProfit2)}</b>
🎯 TP3: <b>${formatPrice(signal.symbol, signal.takeProfit3)}</b>

📐 RR: <b>1:${signal.riskReward.toFixed(1)}</b>
🧠 Confidence: <b>${signal.confidence}/10</b>

📊 <b>EMA:</b>
20 → ${formatPrice(signal.symbol, summary.ema20)}
50 → ${formatPrice(signal.symbol, summary.ema50)}
200 → ${formatPrice(signal.symbol, summary.ema200)}

📈 RSI: <b>${summary.rsi.toFixed(1)}</b>
📉 MACD: <b>${summary.macd}</b>
🌊 ATR: <b>${formatUnsignedPercent(summary.atrPercent)}</b>
🔊 Volume: <b>${volumeLabel(summary.volumeRatio, summary.volumeState)}</b>

✅ <b>Причины:</b>
${bullets(signal.reasons)}

${warnings.length ? `⚠️ <b>Предупреждения:</b>\n${bullets(warnings)}\n\n` : ''}${signalTone(signal)}

🗣 <i>${humanComment}</i>

📉 <a href="${tvLink}">TradingView</a>

⚠️ <i>Не является финансовой рекомендацией.</i>
`.trim();
}

export function formatTradeOpenedMessage(trade: Trade, signal: Signal): string {
  const status = config.trading.isLive ? '🔴 LIVE TRADE OPENED' : '🟡 PAPER TRADE OPENED';
  return `
<b>${status}</b>
🆔 #${trade.id ?? signal.id ?? 'new'}

🚨 <b>${trade.symbol}</b> | ${formatDirection(trade.direction)}

💵 Entry: <b>${formatPrice(trade.symbol, trade.entryPrice)}</b>
🛑 SL: <b>${formatPrice(trade.symbol, trade.stopLoss)}</b>

🎯 TP1: <b>${formatPrice(trade.symbol, trade.takeProfit1)}</b>
🎯 TP2: <b>${formatPrice(trade.symbol, trade.takeProfit2)}</b>
🎯 TP3: <b>${formatPrice(trade.symbol, trade.takeProfit3)}</b>

📌 Status: <b>OPEN</b>

📊 <b>Progress:</b>
${progressLines(trade.progress)}

📐 RR: <b>1:${signal.riskReward.toFixed(1)}</b>
🧠 Confidence: <b>${signal.confidence}/10</b>

🗣 <i>${getOpenComment(trade.id ?? signal.entryPrice)}</i>
`.trim();
}

export function sendTradeUpdate(trade: Trade, tpLevel: number, currentPrice: number): string {
  const pnl = calculatePnlPercent(trade, currentPrice);
  const progress = trade.progress ?? { tp1: false, tp2: false, tp3: false, breakeven: false, partiallyClosed: false };
  const updatedProgress = {
    ...progress,
    tp1: progress.tp1 || tpLevel >= 1,
    tp2: progress.tp2 || tpLevel >= 2,
    tp3: progress.tp3 || tpLevel >= 3,
    breakeven: true,
    partiallyClosed: tpLevel < 3,
  };

  return `
🎯 <b>TP${tpLevel} HIT</b>
🆔 #${trade.id ?? 'n/a'}

✅ TP${tpLevel} reached
${tpLevel === 1 ? '🛡 SL moved to breakeven\n' : ''}📌 Status: <b>${tpLevel >= 3 ? 'CLOSING' : 'PARTIALLY CLOSED'}</b>

📊 <b>Progress:</b>
${progressLines(updatedProgress)}

💰 Current PnL: <b>${formatPercent(pnl)}</b>

🗣 <i>${getTpComment(tpLevel, trade.id ?? currentPrice)}</i>
`.trim();
}

export function formatTradeClosedMessage(trade: Trade, improvements?: string[]): string {
  const pnl = trade.finalPnl ?? trade.pnlPercent ?? 0;
  const isBreakeven = trade.result === 'breakeven' || Math.abs(pnl) < 0.01;
  const isWin = trade.result === 'win' || pnl > 0;
  const title = isBreakeven
    ? '⚪ TRADE CLOSED AT BREAKEVEN'
    : isWin
      ? '✅ TRADE CLOSED BY PLAN'
      : '🔴 TRADE CLOSED BY STOP';
  const finalStatus = isBreakeven ? 'CLOSED BREAKEVEN' : isWin ? 'CLOSED WIN' : 'CLOSED LOSS';
  const comment = isBreakeven ? getBreakevenComment(trade.id) : isWin ? getCloseComment(trade.id) : getStopComment(trade.id);

  return `
<b>${title}</b>
🆔 #${trade.id ?? 'n/a'}

${!isWin && !isBreakeven ? '🛑 Stop Loss hit\n' : ''}🎯 TP1 ${trade.progress?.tp1 ? '✅' : '—'}
🎯 TP2 ${trade.progress?.tp2 ? '✅' : '—'}
🎯 TP3 ${trade.progress?.tp3 ? '✅' : '—'}

📌 Final status: <b>${finalStatus}</b>
💰 Final PnL: <b>${formatPercent(pnl)}</b>

<b>${isWin ? 'Причина выхода' : 'Причина'}:</b>
${bullets(normalizeBullets(trade.exitReason))}

${!isWin && improvements && improvements.length > 0 ? `<b>Что улучшить:</b>\n${bullets(improvements)}\n\n` : ''}<b>Теги ошибок:</b>
${trade.errorTags?.length ? trade.errorTags.map(t => `#${t}`).join(' ') : '#correct_execution'}

🗣 <i>${comment}</i>
`.trim();
}

function calculatePnlPercent(trade: Trade, price: number): number {
  const raw = trade.direction === 'LONG'
    ? ((price - trade.entryPrice) / trade.entryPrice) * 100
    : ((trade.entryPrice - price) / trade.entryPrice) * 100;
  return raw * trade.leverage;
}

function resolveTradePnlPercent(trade: Trade): number {
  if (trade.pnlPercent !== undefined && Number.isFinite(trade.pnlPercent)) return trade.pnlPercent;
  if (trade.finalPnl !== undefined && Number.isFinite(trade.finalPnl)) return trade.finalPnl;
  if (trade.currentPnl !== undefined && Number.isFinite(trade.currentPnl)) return trade.currentPnl;
  if (trade.exitPrice && trade.entryPrice) return calculatePnlPercent(trade, trade.exitPrice);
  return 0;
}

function tradePnlUsdt(trade: Trade, fallbackBalance: number): number {
  if (trade.pnlUsdt !== undefined && Number.isFinite(trade.pnlUsdt)) return trade.pnlUsdt;
  const pnlPercent = resolveTradePnlPercent(trade);
  if (trade.positionSize && trade.entryPrice && trade.exitPrice) {
    const rawMove = trade.direction === 'LONG'
      ? trade.exitPrice - trade.entryPrice
      : trade.entryPrice - trade.exitPrice;
    return rawMove * trade.positionSize * trade.leverage;
  }
  if (trade.positionSize && trade.entryPrice) {
    return (pnlPercent / 100) * trade.positionSize * trade.entryPrice;
  }
  return (fallbackBalance * pnlPercent) / 100;
}

export function formatDailyReport(
  date: string,
  trades: Trade[],
  balance: number,
  startBalance: number,
): string {
  const closed = trades.filter(t => t.status !== 'open');
  const wins = closed.filter(t => t.result === 'win');
  const losses = closed.filter(t => t.result === 'loss');
  const fallbackBalance = startBalance || 1000;
  const totalPnlPercent = closed.reduce((a, t) => a + resolveTradePnlPercent(t), 0);
  const totalPnlUsdt = closed.reduce((a, t) => a + tradePnlUsdt(t, fallbackBalance), 0);
  const winRate = closed.length > 0 ? (wins.length / closed.length) * 100 : 0;
  const detailLines = closed.map(t => {
    const pnlPercent = resolveTradePnlPercent(t);
    const pnlUsdt = tradePnlUsdt(t, fallbackBalance);
    return `• ${t.symbol} ${t.direction}: ${formatPercent(pnlPercent)} | ${pnlUsdt >= 0 ? '+' : ''}${pnlUsdt.toFixed(2)} USDT`;
  }).join('\n');

  return `
📋 <b>Дневной отчет — ${date}</b>

💰 Баланс: <b>${balance.toFixed(2)} USDT</b> (${totalPnlUsdt >= 0 ? '+' : ''}${totalPnlUsdt.toFixed(2)} USDT)

📊 <b>Статистика:</b>
Сделок: ${closed.length} | ✅ ${wins.length} | ❌ ${losses.length}
Winrate: <b>${winRate.toFixed(1)}%</b>
P&L: <b>${formatPercent(totalPnlPercent)} | ${totalPnlUsdt >= 0 ? '+' : ''}${totalPnlUsdt.toFixed(2)} USDT</b>

${closed.length > 0 ? `<b>Детали:</b>
${detailLines}` : 'Сделок за день нет.'}
`.trim();
}


export function formatLearningReport(report: AnalysisReport): string { return `
🧠 <b>Анализ последних ${report.totalTrades} сделок</b>

📅 Период: ${report.periodStart} — ${report.periodEnd}

<b>📊 Результаты:</b>
Сделок: ${report.totalTrades} | ✅ ${report.wins} | ❌ ${report.losses}
Winrate: <b>${report.winRate.toFixed(1)}%</b>
Средняя прибыль: <b>+${report.avgProfit.toFixed(2)}%</b>
Средний убыток: <b>-${Math.abs(report.avgLoss).toFixed(2)}%</b>
Profit Factor: <b>${report.profitFactor.toFixed(2)}</b>

<b>✅ Лучшие сетапы:</b>
${report.bestSetups.map(s => `• ${s}`).join('\n')}

<b>❌ Худшие сетапы:</b>
${report.worstSetups.map(s => `• ${s}`).join('\n')}

<b>⚠️ Частые ошибки:</b>
${report.frequentErrors.map(e => `• ${e}`).join('\n')}

<b>💡 Рекомендации:</b>
${report.recommendations.map(r => `• ${r}`).join('\n')}
`.trim(); }

export function formatStatusMessage(mode: string, isPaused: boolean, openPositions: number, balance: number, consecutiveLosses: number): string { const statusIcon = isPaused ? '⛔ ОСТАНОВЛЕН' : '✅ АКТИВЕН'; return `
🤖 <b>Статус бота OKX</b>

Состояние: <b>${statusIcon}</b>
Режим: <b>${mode.toUpperCase()}</b>
Открытых позиций: <b>${openPositions}</b>
Баланс: <b>${balance.toFixed(2)} USDT</b>
Убыточных подряд: <b>${consecutiveLosses}</b>
`.trim(); }

export function formatErrorAlert(error: string, context?: string): string { return `
⚠️ <b>Ошибка бота</b>

${context ? `Контекст: <code>${context}</code>\n` : ''}Ошибка: <code>${error}</code>
`.trim(); }
