import type { Signal, Trade, AnalysisReport } from '../database/models';

// ─── New Signal ───────────────────────────────────────────────────────────────
export function formatSignalMessage(signal: Signal): string {
  const dir = signal.direction === 'LONG' ? '🟢 LONG' : '🔴 SHORT';
  const confidence = '⭐'.repeat(Math.min(signal.confidence, 10));

  return `
🚨 <b>Новый сигнал</b>

Монета: <b>${signal.symbol}</b>
Направление: <b>${dir}</b>
Вход: <b>${signal.entryPrice}</b>
Stop Loss: <b>${signal.stopLoss}</b>
Take Profit 1: <b>${signal.takeProfit1}</b>
Take Profit 2: <b>${signal.takeProfit2}</b>
Take Profit 3: <b>${signal.takeProfit3}</b>

Риск: <b>${signal.riskPercent}%</b>
Risk/Reward: <b>1:${signal.riskReward}</b>
Размер позиции: <b>${signal.positionSize}</b>
${signal.leverage > 1 ? `Плечо: <b>x${signal.leverage}</b>` : ''}
Уверенность: <b>${signal.confidence}/10</b> ${confidence}

<b>Почему вход:</b>
- ${signal.reasons.join('\n- ')}

<b>Условия отмены:</b>
- ${signal.cancelConditions.join('\n- ')}

${signal.indicators ? `📊 <i>RSI: ${signal.indicators.rsi.toFixed(1)} | ATR: ${signal.indicators.atr.toFixed(4)} | Тренд: ${signal.indicators.trend}</i>` : ''}

⚠️ <i>Бот не гарантирует прибыль. Торговля сопряжена с рисками.</i>
`.trim();
}

// ─── TP Hit Update ────────────────────────────────────────────────────────────
export function sendTradeUpdate(trade: Trade, tpLevel: number, currentPrice: number): string {
  return `
📈 <b>TP${tpLevel} достигнут!</b>

Монета: <b>${trade.symbol}</b>
Направление: <b>${trade.direction}</b>
Вход: <b>${trade.entryPrice}</b>
Текущая цена: <b>${currentPrice}</b>
${tpLevel === 1 ? `TP2: <b>${trade.takeProfit2}</b>\nTP3: <b>${trade.takeProfit3}</b>` : tpLevel === 2 ? `TP3: <b>${trade.takeProfit3}</b>\n💡 SL передвинут в безубыток` : '🎯 <b>Финальная цель достигнута!</b>'}

<i>Позиция продолжает удерживаться до следующей цели.</i>
`.trim();
}

// ─── Trade Closed ─────────────────────────────────────────────────────────────
export function formatTradeClosedMessage(trade: Trade, improvements?: string[]): string {
  const isWin = trade.result === 'win';
  const icon = isWin ? '✅' : '❌';
  const pnlSign = (trade.pnlPercent ?? 0) >= 0 ? '+' : '';

  if (isWin) {
    return `
${icon} <b>Сделка закрыта</b>

Монета: <b>${trade.symbol}</b>
Результат: <b>${pnlSign}${trade.pnlPercent?.toFixed(2)}%</b> (${pnlSign}${trade.pnlUsdt?.toFixed(2)} USDT)

<b>Причина выхода:</b>
- ${trade.exitReason?.split('\n').join('\n- ')}

<b>Вывод:</b>
${trade.exitAnalysis}
`.trim();
  } else {
    return `
${icon} <b>Сделка закрыта в минус</b>

Монета: <b>${trade.symbol}</b>
Результат: <b>${pnlSign}${trade.pnlPercent?.toFixed(2)}%</b> (${pnlSign}${trade.pnlUsdt?.toFixed(2)} USDT)

<b>Причина убытка:</b>
- ${trade.exitReason?.split('\n').join('\n- ')}

<b>Что улучшить:</b>
${improvements && improvements.length > 0 ? `- ${improvements.join('\n- ')}` : '— Сделка выполнена по плану, стоп сработал штатно'}

<b>Теги ошибок:</b>
${trade.errorTags?.length ? trade.errorTags.map(t => `#${t}`).join(' ') : '#correct_execution'}
`.trim();
  }
}

// ─── Daily Report ─────────────────────────────────────────────────────────────
export function formatDailyReport(
  date: string,
  trades: Trade[],
  balance: number,
  startBalance: number,
): string {
  const closed = trades.filter(t => t.status !== 'open');
  const wins = closed.filter(t => t.result === 'win');
  const losses = closed.filter(t => t.result === 'loss');
  const totalPnl = closed.reduce((a, t) => a + (t.pnlPercent ?? 0), 0);
  const winRate = closed.length > 0 ? (wins.length / closed.length) * 100 : 0;

  return `
📋 <b>Дневной отчет — ${date}</b>

💰 Баланс: <b>${balance.toFixed(2)} USDT</b> (${totalPnl >= 0 ? '+' : ''}${(balance - startBalance).toFixed(2)})

📊 <b>Статистика:</b>
Сделок: ${closed.length} | ✅ ${wins.length} | ❌ ${losses.length}
Winrate: <b>${winRate.toFixed(1)}%</b>
P&L: <b>${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}%</b>

${closed.length > 0 ? `<b>Детали:</b>\n${closed.map(t => `• ${t.symbol} ${t.direction}: ${t.pnlPercent && t.pnlPercent >= 0 ? '+' : ''}${t.pnlPercent?.toFixed(2)}%`).join('\n')}` : 'Сделок за день нет.'}
`.trim();
}

// ─── Learning Report ──────────────────────────────────────────────────────────
export function formatLearningReport(report: AnalysisReport): string {
  return `
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
`.trim();
}

// ─── Status Message ───────────────────────────────────────────────────────────
export function formatStatusMessage(
  mode: string,
  isPaused: boolean,
  openPositions: number,
  balance: number,
  consecutiveLosses: number,
): string {
  const statusIcon = isPaused ? '⛔ ОСТАНОВЛЕН' : '✅ АКТИВЕН';
  return `
🤖 <b>Статус бота OKX</b>

Состояние: <b>${statusIcon}</b>
Режим: <b>${mode.toUpperCase()}</b>
Открытых позиций: <b>${openPositions}</b>
Баланс: <b>${balance.toFixed(2)} USDT</b>
Убыточных подряд: <b>${consecutiveLosses}</b>
`.trim();
}

// ─── Error Alert ──────────────────────────────────────────────────────────────
export function formatErrorAlert(error: string, context?: string): string {
  return `
⚠️ <b>Ошибка бота</b>

${context ? `Контекст: <code>${context}</code>\n` : ''}Ошибка: <code>${error}</code>
`.trim();
}
