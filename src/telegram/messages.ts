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
  if (state === 'high' || ratio >= 1.5) return `высокий (x${ratio.toFixed(1)})`;
  if (state === 'weak' || ratio < 0.7) return `слабый (x${ratio.toFixed(1)})`;
  return `нормальный (x${ratio.toFixed(1)})`;
}

function formatUsdt(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)} USDT`;
}

function signalTone(signal: Signal): string {
  if (signal.warnings.length > 0) return '🟡 Осторожный сигнал';
  if (signal.confidence >= 8) return '🟢 Сильный сигнал';
  return '🟡 Нормальный сигнал';
}

export function formatSignalMessage(signal: Signal): string {
  const signalStatus = config.trading.isLive ? '🔴 РЕАЛЬНЫЙ СИГНАЛ' : '🟡 БУМАЖНЫЙ СИГНАЛ';
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

💵 Вход: <b>${formatPrice(signal.symbol, signal.entryPrice)}</b>
🛑 Стоп: <b>${formatPrice(signal.symbol, signal.stopLoss)}</b>

🎯 TP1: <b>${formatPrice(signal.symbol, signal.takeProfit1)}</b>
🎯 TP2: <b>${formatPrice(signal.symbol, signal.takeProfit2)}</b>
🎯 TP3: <b>${formatPrice(signal.symbol, signal.takeProfit3)}</b>

📐 Риск/прибыль: <b>1:${signal.riskReward.toFixed(1)}</b>
🧠 Уверенность: <b>${signal.confidence}/10</b>

📊 <b>EMA:</b>
20 → ${formatPrice(signal.symbol, summary.ema20)}
50 → ${formatPrice(signal.symbol, summary.ema50)}
200 → ${formatPrice(signal.symbol, summary.ema200)}

📈 RSI: <b>${summary.rsi.toFixed(1)}</b>
📉 MACD: <b>${summary.macd === 'bullish' ? 'бычий' : summary.macd === 'bearish' ? 'медвежий' : 'нейтральный'}</b>
🌊 ATR: <b>${formatUnsignedPercent(summary.atrPercent)}</b>
🔊 Объем: <b>${volumeLabel(summary.volumeRatio, summary.volumeState)}</b>

✅ <b>Причины:</b>
${bullets(signal.reasons)}

${warnings.length ? `⚠️ <b>Предупреждения:</b>\n${bullets(warnings)}\n\n` : ''}${signalTone(signal)}

🗣 <i>${humanComment}</i>

📉 <a href="${tvLink}">Открыть график TradingView</a>

⚠️ <i>Не является финансовой рекомендацией.</i>
`.trim();
}

export function formatTradeOpenedMessage(trade: Trade, signal: Signal): string {
  const status = config.trading.isLive ? '🔴 РЕАЛЬНАЯ СДЕЛКА ОТКРЫТА' : '🟡 БУМАЖНАЯ СДЕЛКА ОТКРЫТА';
  return `
<b>${status}</b>
🆔 #${trade.id ?? signal.id ?? 'новая'}

🚨 <b>${trade.symbol}</b> | ${formatDirection(trade.direction)}

💵 Вход: <b>${formatPrice(trade.symbol, trade.entryPrice)}</b>
🛑 Стоп: <b>${formatPrice(trade.symbol, trade.stopLoss)}</b>

🎯 TP1: <b>${formatPrice(trade.symbol, trade.takeProfit1)}</b>
🎯 TP2: <b>${formatPrice(trade.symbol, trade.takeProfit2)}</b>
🎯 TP3: <b>${formatPrice(trade.symbol, trade.takeProfit3)}</b>

📌 Статус: <b>ОТКРЫТА</b>

📊 <b>Прогресс:</b>
${progressLines(trade.progress)}

📐 Риск/прибыль: <b>1:${signal.riskReward.toFixed(1)}</b>
🧠 Уверенность: <b>${signal.confidence}/10</b>

🗣 <i>${getOpenComment(trade.id ?? signal.entryPrice)}</i>
`.trim();
}

export function sendTradeUpdate(trade: Trade, tpLevel: number, currentPrice: number): string {
  const pnl = calculatePnlPercent(trade, currentPrice);
  const pnlUsdt = (pnl / 100) * trade.positionSize * trade.entryPrice;
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
🎯 <b>TP${tpLevel} ДОСТИГНУТ</b>
🆔 #${trade.id ?? 'нет данных'}

✅ TP${tpLevel} достигнут
${tpLevel === 1 ? '🛡 Стоп перенесен в безубыток\n' : ''}📌 Статус: <b>${tpLevel >= 3 ? 'ЗАКРЫВАЕТСЯ' : 'ЧАСТИЧНО ЗАКРЫТА'}</b>

📊 <b>Прогресс:</b>
${progressLines(updatedProgress)}

💰 Текущий результат: <b>${formatPercent(pnl)} | ${formatUsdt(pnlUsdt)}</b>

🗣 <i>${getTpComment(tpLevel, trade.id ?? currentPrice)}</i>
`.trim();
}

export function formatTradeClosedMessage(trade: Trade, improvements?: string[]): string {
  const pnl = trade.finalPnl ?? trade.pnlPercent ?? 0;
  const pnlUsdt = tradePnlUsdt(trade, 1000);
  const isBreakeven = trade.result === 'breakeven' || Math.abs(pnl) < 0.01;
  const isWin = trade.result === 'win' || pnl > 0;
  const title = isBreakeven
    ? '⚪ СДЕЛКА ЗАКРЫТА В БЕЗУБЫТОК'
    : isWin
      ? '✅ СДЕЛКА ЗАКРЫТА ПО ПЛАНУ'
      : '🔴 СДЕЛКА ЗАКРЫТА ПО СТОПУ';
  const finalStatus = isBreakeven ? 'ЗАКРЫТА В БЕЗУБЫТОК' : isWin ? 'ЗАКРЫТА В ПЛЮС' : 'ЗАКРЫТА В МИНУС';
  const comment = isBreakeven ? getBreakevenComment(trade.id) : isWin ? getCloseComment(trade.id) : getStopComment(trade.id);

  return `
<b>${title}</b>
🆔 #${trade.id ?? 'нет данных'}

${!isWin && !isBreakeven ? '🛑 Сработал стоп-лосс\n' : ''}🎯 TP1 ${trade.progress?.tp1 ? '✅' : '—'}
🎯 TP2 ${trade.progress?.tp2 ? '✅' : '—'}
🎯 TP3 ${trade.progress?.tp3 ? '✅' : '—'}

📌 Финальный статус: <b>${finalStatus}</b>
💰 Финальный результат: <b>${formatPercent(pnl)} | ${formatUsdt(pnlUsdt)}</b>

<b>${isWin ? 'Причина выхода' : 'Причина'}:</b>
${bullets(normalizeBullets(trade.exitReason))}

${!isWin && improvements && improvements.length > 0 ? `<b>Что улучшить:</b>\n${bullets(improvements)}\n\n` : ''}<b>Теги ошибок:</b>
${trade.errorTags?.length ? trade.errorTags.map(t => `#${t}`).join(' ') : '#корректное_исполнение'}

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

  const totalPnlPercent = closed.reduce((sum, trade) => sum + resolveTradePnlPercent(trade), 0);
  const totalPnlUsdt = closed.reduce((sum, trade) => sum + tradePnlUsdt(trade, fallbackBalance), 0);
  const winRate = closed.length > 0 ? (wins.length / closed.length) * 100 : 0;
  const signedTotalPnlUsdt = formatUsdt(totalPnlUsdt);

  const detailLines = closed.map(trade => {
    const pnlPercent = resolveTradePnlPercent(trade);
    const pnlUsdt = tradePnlUsdt(trade, fallbackBalance);
    const signedPnlUsdt = formatUsdt(pnlUsdt);
    return `• ${trade.symbol} ${trade.direction}: ${formatPercent(pnlPercent)} | ${signedPnlUsdt}`;
  }).join('\n');

  return `
📋 Дневной отчет — ${date}

💰 Баланс: ${balance.toFixed(2)} USDT (${signedTotalPnlUsdt})

📊 Статистика:
Сделок: ${closed.length} | ✅ ${wins.length} | ❌ ${losses.length}
Винрейт: ${winRate.toFixed(1)}%
Результат: ${formatPercent(totalPnlPercent)} | ${signedTotalPnlUsdt}

${closed.length > 0 ? `Детали:
${detailLines}` : 'Сделок за день нет.'}
`.trim();
}


export function formatLearningReport(report: AnalysisReport): string { return `
🧠 <b>Анализ последних ${report.totalTrades} сделок</b>

📅 Период: ${report.periodStart} — ${report.periodEnd}

<b>📊 Результаты:</b>
Сделок: ${report.totalTrades} | ✅ ${report.wins} | ❌ ${report.losses}
Винрейт: <b>${report.winRate.toFixed(1)}%</b>
Средняя прибыль: <b>+${report.avgProfit.toFixed(2)}%</b>
Средний убыток: <b>-${Math.abs(report.avgLoss).toFixed(2)}%</b>
Профит-фактор: <b>${report.profitFactor.toFixed(2)}</b>

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
