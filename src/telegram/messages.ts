import { config } from '../config';
import type { Signal, Trade, AnalysisReport } from '../database/models';

function decimalsForSymbol(symbol: string): number {
  if (symbol.startsWith('BTC-') || symbol.startsWith('ETH-')) return 2;
  if (symbol.startsWith('SOL-') || symbol.startsWith('XRP-') || symbol.startsWith('DOGE-') || symbol.startsWith('TON-')) return 4;
  return 4;
}

function fmtPrice(symbol: string, value: number): string {
  return value.toFixed(decimalsForSymbol(symbol));
}

function fmtPct(value: number): string {
  return `${value.toFixed(2)}%`;
}

function fmtDirection(direction: 'LONG' | 'SHORT'): string {
  return direction === 'LONG' ? '🟢 ЛОНГ' : '🔴 ШОРТ';
}


function normalizeBullets(text?: string): string[] {
  if (!text) return [];
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => line.replace(/^[-•]\s*/, ''));
}


function buildHumanComment(signal: Signal): string | null {
  const rsi = Number(signal.indicatorSummary?.rsiState ?? 0);
  const atrPct = signal.indicatorSummary?.atrPercent ?? 0;
  const hasWeakVolume = (signal.warnings ?? []).some(w => w.toLowerCase().includes('объем'));

  if (signal.direction === 'SHORT' && rsi <= 40 && atrPct >= 0.2) {
    const phrases = [
      '🗣 <i>Похоже на «отскок мёртвой кошки»: импульс вверх выдохся, шорт выглядит обоснованно.</i>',
      '🗣 <i>Сценарий «dead cat bounce»: рынок дал слабый отскок и снова теряет силу.</i>',
    ];
    const idx = Math.abs(Math.round(signal.entryPrice * 1000)) % phrases.length;
    return phrases[idx];
  }

  if (signal.direction === 'LONG' && rsi >= 55 && !hasWeakVolume) {
    return '🗣 <i>Покупатель держит инициативу, но входим по плану и без погони за ценой.</i>';
  }

  if (hasWeakVolume) {
    return '🗣 <i>Объем слабый — сигнал рабочий, но лучше снижать агрессию и соблюдать риск-менеджмент.</i>';
  }

  return null;
}

// ─── New Signal ───────────────────────────────────────────────────────────────
export function formatSignalMessage(signal: Signal): string {
  const signalStatus = config.trading.isLive ? '🔴 <b>LIVE SIGNAL</b>' : '🟡 <b>PAPER SIGNAL</b>';
  const dir = fmtDirection(signal.direction);
  const tvSymbol = `OKX:${signal.symbol.replace('-USDT-SWAP', 'USDT.P').replace('-', '')}`;
  const tvLink = `https://www.tradingview.com/chart/?symbol=${tvSymbol}`;
  const confidence = '⭐'.repeat(Math.min(signal.confidence, 10));

  const vol = signal.indicatorSummary?.volumeRatio ?? 0;
  const volumeBlock = vol > 0 ? `x${vol.toFixed(2)}` : 'нет данных';

  const warnings = [...(signal.warnings ?? [])];
  if (vol > 0 && vol < 0.7 && !warnings.includes('Слабый объем')) warnings.push('Слабый объем');

  return `
${signalStatus}
🚨 <b>Новый сигнал</b>

🪙 <b>${signal.symbol}</b> | ${dir}
⏱ TF: ${signal.timeframeConfirmations.join(' / ')}

💵 Entry: <b>${fmtPrice(signal.symbol, signal.entryPrice)}</b>
🛑 SL: <b>${fmtPrice(signal.symbol, signal.stopLoss)}</b>
🎯 TP1: <b>${fmtPrice(signal.symbol, signal.takeProfit1)}</b> | TP2: <b>${fmtPrice(signal.symbol, signal.takeProfit2)}</b> | TP3: <b>${fmtPrice(signal.symbol, signal.takeProfit3)}</b>

📐 RR: <b>1:${signal.riskReward.toFixed(2)}</b> | Risk: <b>${fmtPct(signal.riskPercent)}</b>
🧠 Уверенность: <b>${signal.confidence}/10</b> ${confidence}

📊 EMA: ${signal.indicatorSummary.emaAlignment}
📈 RSI: ${signal.indicatorSummary.rsiState} | MACD: ${signal.indicatorSummary.macdState}
🌊 ATR: ${signal.indicators?.atr.toFixed(4) ?? 'n/a'} | 🔊 Volume: ${volumeBlock}

✅ <b>Причины входа:</b>
- ${signal.reasons.join('\n- ')}

${warnings.length ? `⚠️ <b>Предупреждения:</b>\n- ${warnings.join('\n- ')}\n\n` : ''}${buildHumanComment(signal) ? `${buildHumanComment(signal)}\n\n` : ''}📉 <a href="${tvLink}">Открыть график TradingView</a>
`.trim();
}

export function sendTradeUpdate(trade: Trade, tpLevel: number, currentPrice: number): string {
  const dir = fmtDirection(trade.direction);
  const nextTargets = tpLevel === 1
    ? `TP2: <b>${fmtPrice(trade.symbol, trade.takeProfit2)}</b>\nTP3: <b>${fmtPrice(trade.symbol, trade.takeProfit3)}</b>`
    : tpLevel === 2
      ? `TP3: <b>${fmtPrice(trade.symbol, trade.takeProfit3)}</b>\n💡 SL перенесен в безубыток`
      : '🎯 <b>Финальная цель достигнута!</b>';

  return `
📈 <b>TP${tpLevel} достигнут!</b>

🪙 Монета: <b>${trade.symbol}</b>
📍 Направление: <b>${dir}</b>
💵 Вход: <b>${fmtPrice(trade.symbol, trade.entryPrice)}</b>
💹 Текущая цена: <b>${fmtPrice(trade.symbol, currentPrice)}</b>
${nextTargets}

<i>Позиция продолжает удерживаться до следующей цели.</i>
`.trim();
}

export function formatTradeClosedMessage(trade: Trade, improvements?: string[]): string { const isWin = trade.result === 'win'; const icon = isWin ? '✅' : '❌'; const pnlSign = (trade.pnlPercent ?? 0) >= 0 ? '+' : ''; if (isWin) { return `
${icon} <b>Сделка закрыта</b>

Монета: <b>${trade.symbol}</b>
Результат: <b>${pnlSign}${trade.pnlPercent?.toFixed(2)}%</b> (${pnlSign}${trade.pnlUsdt?.toFixed(2)} USDT)

<b>Причина выхода:</b>
${normalizeBullets(trade.exitReason).length ? `- ${normalizeBullets(trade.exitReason).join('\n- ')}` : '—'}

<b>Вывод:</b>
${trade.exitAnalysis}
`.trim(); } return `
${icon} <b>Сделка закрыта в минус</b>

Монета: <b>${trade.symbol}</b>
Результат: <b>${pnlSign}${trade.pnlPercent?.toFixed(2)}%</b> (${pnlSign}${trade.pnlUsdt?.toFixed(2)} USDT)

<b>Причина убытка:</b>
${normalizeBullets(trade.exitReason).length ? `- ${normalizeBullets(trade.exitReason).join('\n- ')}` : '—'}

<b>Что улучшить:</b>
${improvements && improvements.length > 0 ? `- ${improvements.join('\n- ')}` : '— Сделка выполнена по плану, стоп сработал штатно'}

<b>Теги ошибок:</b>
${trade.errorTags?.length ? trade.errorTags.map(t => `#${t}`).join(' ') : '#correct_execution'}
`.trim(); }

export function formatDailyReport(date: string, trades: Trade[], balance: number, startBalance: number): string { const closed = trades.filter(t => t.status !== 'open'); const wins = closed.filter(t => t.result === 'win'); const losses = closed.filter(t => t.result === 'loss'); const totalPnl = closed.reduce((a, t) => a + (t.pnlPercent ?? 0), 0); const winRate = closed.length > 0 ? (wins.length / closed.length) * 100 : 0; return `
📋 <b>Дневной отчет — ${date}</b>

💰 Баланс: <b>${balance.toFixed(2)} USDT</b> (${totalPnl >= 0 ? '+' : ''}${(balance - startBalance).toFixed(2)})

📊 <b>Статистика:</b>
Сделок: ${closed.length} | ✅ ${wins.length} | ❌ ${losses.length}
Winrate: <b>${winRate.toFixed(1)}%</b>
P&L: <b>${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}%</b>

${closed.length > 0 ? `<b>Детали:</b>\n${closed.map(t => `• ${t.symbol} ${t.direction}: ${t.pnlPercent && t.pnlPercent >= 0 ? '+' : ''}${t.pnlPercent?.toFixed(2)}%`).join('\n')}` : 'Сделок за день нет.'}
`.trim(); }

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
