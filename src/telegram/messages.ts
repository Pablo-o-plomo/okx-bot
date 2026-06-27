import type { Signal, Trade, AnalysisReport, Direction, LearningDashboard } from '../database/models';

interface StatusMessageInput {
  okxApiMode: 'LIVE' | 'DEMO';
  mode: 'PAPER' | 'LIVE';
  autoTrade?: boolean;
  isPaused: boolean;
  openPositions: number;
  balance: number | null;
  okxBalance?: number | null;
  consecutiveLosses: number;
  pauseReason?: string;
  symbolsCount: number;
  timeframes: readonly string[];
  lastScan?: string;
}

interface HeartbeatInput {
  checkedSymbols: number;
  signalsFound: number;
  openPositions: number;
  lastScan?: string;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function compactSymbol(symbol: string): string {
  return escapeHtml(symbol.replace(/-USDT-SWAP$/, '').replace(/-USDT$/, ''));
}

function directionStyle(direction: Direction): string {
  return direction === 'LONG' ? '🟢🟢🟢 LONG' : '🔴🔴🔴 SHORT';
}

function formatDisplayBalance(balance: number | null): string {
  return balance === null ? 'unavailable' : `${balance.toFixed(2)} USDT`;
}

function statusModeLines(input: StatusMessageInput): string {
  const lines = [
    `OKX API: <b>${input.okxApiMode}</b>`,
    `Trade mode: <b>${input.mode}</b>`,
  ];

  if (input.mode === 'LIVE') {
    lines.push(`Auto trade: <b>${input.autoTrade ? 'ON' : 'OFF'}</b>`);
  }

  return lines.join('\n');
}

function statusBalanceLines(input: StatusMessageInput): string {
  if (input.mode === 'PAPER') {
    return [
      `Paper balance: <b>${formatDisplayBalance(input.balance)}</b>`,
      `OKX balance: <b>${formatDisplayBalance(input.okxBalance ?? null)}</b>`,
    ].join('\n');
  }

  return `Balance: <b>${formatDisplayBalance(input.balance)}</b>`;
}

function signed(value: number | undefined, digits = 2): string {
  const num = value ?? 0;
  return `${num >= 0 ? '+' : ''}${num.toFixed(digits)}`;
}

function signalStatus(status: string): string {
  switch (status) {
    case 'pending':
      return '🟡 WAITING ENTRY';
    case 'active':
      return '🟢 Signal active';
    case 'cancelled':
      return '⚫ Cancelled';
    case 'expired':
      return '⚪ Expired';
    default:
      return escapeHtml(status);
  }
}


function priceDigits(symbol: string): number {
  const base = symbol.split('-')[0];
  if (base === 'BTC') return 0;
  if (['ETH', 'SOL'].includes(base)) return 2;
  if (['XRP', 'DOGE', 'TON'].includes(base)) return 4;
  return 4;
}

function formatPrice(symbol: string, price: number): string {
  return escapeHtml(price.toFixed(priceDigits(symbol)).replace(/\.?0+$/, ''));
}

function tpStatus(hit?: boolean): string {
  return hit ? '✅' : '⏳';
}

function isStopMovedToBreakeven(trade: Trade): boolean {
  return trade.stopLoss === trade.entryPrice || !!trade.tp2Hit;
}

function tradeTpHits(trade: Trade): { tp1: boolean; tp2: boolean; tp3: boolean } {
  const tp3 = !!trade.tp3Hit;
  const tp2 = !!trade.tp2Hit || tp3 || isStopMovedToBreakeven(trade);
  const tp1 = !!trade.tp1Hit || tp2;
  return { tp1, tp2, tp3 };
}

function tpProgress(hits: { tp1: boolean; tp2: boolean; tp3: boolean }): number {
  return [hits.tp1, hits.tp2, hits.tp3].filter(Boolean).length;
}

function riskLabel(trade: Trade): 'LOW' | 'MEDIUM' | 'HIGH' {
  const distance = Math.abs(trade.entryPrice - trade.stopLoss) / trade.entryPrice;
  if (distance <= 0.01) return 'LOW';
  if (distance <= 0.03) return 'MEDIUM';
  return 'HIGH';
}

function unique(items: Array<string | undefined>): string[] {
  return Array.from(new Set(items.filter((item): item is string => !!item && item.trim().length > 0)));
}

function cleanReason(reason: string): string {
  return escapeHtml(reason.replace(/^[-•\s]+/, '').replace(/_/g, ' ').trim());
}

function tradePnlPercent(trade: Trade, currentPrice: number): number {
  const raw = trade.direction === 'LONG'
    ? ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100
    : ((trade.entryPrice - currentPrice) / trade.entryPrice) * 100;
  return raw * trade.leverage;
}

// ─── BOT STATUS ───────────────────────────────────────────────────────────────
export function formatStatusMessage(input: StatusMessageInput): string {
  const scannerState = input.isPaused ? 'OFF' : 'ON';
  const lastScan = input.lastScan ?? '—';

  if (input.isPaused) {
    return `
🔴 <b>BOT PAUSED</b>

${statusModeLines(input)}
Scanner: <b>${scannerState}</b>
Positions: <b>${input.openPositions}</b>
${statusBalanceLines(input)}
Loss streak: <b>${input.consecutiveLosses}</b>

Reason:
${input.pauseReason ? escapeHtml(input.pauseReason) : 'Manual pause'}

Last scan: <b>${lastScan}</b>
`.trim();
  }

  return `
🟢 <b>BOT ACTIVE</b>

${statusModeLines(input)}
Scanner: <b>${scannerState}</b>
Positions: <b>${input.openPositions}</b>
${statusBalanceLines(input)}
Loss streak: <b>${input.consecutiveLosses}</b>

🪙 Symbols: <b>${input.symbolsCount}</b>
⏱ TF: <b>${input.timeframes.map(escapeHtml).join(' / ')}</b>

Last scan: <b>${lastScan}</b>
`.trim();
}

// ─── NEW SIGNAL ───────────────────────────────────────────────────────────────
export function formatSignalMessage(signal: Signal): string {
  const reasons = signal.reasons.slice(0, 2).map(cleanReason);

  return `
🚨 <b>NEW SIGNAL</b>

${directionStyle(signal.direction)} ${compactSymbol(signal.symbol)}

Entry: <b>${signal.entryPrice}</b>
SL: <b>${signal.stopLoss}</b>

🎯 TP1: <b>${signal.takeProfit1}</b>
🎯 TP2: <b>${signal.takeProfit2}</b>
🎯 TP3: <b>${signal.takeProfit3}</b>

Risk: <b>${signal.riskPercent}%</b>
R/R: <b>1:${signal.riskReward.toFixed(2)}</b>
Confidence: <b>${signal.confidence}/10</b>
Status: <b>${signalStatus(signal.status)}</b>
${reasons.length > 0 ? `\nSetup:\n${reasons.map(reason => `• ${reason}`).join('\n')}` : ''}
`.trim();
}

// ─── POSITIONS ────────────────────────────────────────────────────────────────
export function formatPositionsMessage(trades: Trade[]): string {
  if (trades.length === 0) return '📈 <b>No open positions</b>';

  return trades
    .map(trade => {
      const hits = tradeTpHits(trade);

      // SL label: BE if sl == entry, TP1 if sl == takeProfit1
      let slLabel: string;
      if (trade.stopLoss === trade.entryPrice) {
        slLabel = `${formatPrice(trade.symbol, trade.stopLoss)} <b>BE</b>`;
      } else if (trade.takeProfit1 && trade.stopLoss === trade.takeProfit1) {
        slLabel = `${formatPrice(trade.symbol, trade.stopLoss)} <b>TP1</b>`;
      } else {
        slLabel = `<b>${formatPrice(trade.symbol, trade.stopLoss)}</b>`;
      }

      // Fixed PnL from partial closes
      const fixedPnl = (trade.tp1PnlUsdt ?? 0) + (trade.tp2PnlUsdt ?? 0);
      const hasFixed = fixedPnl !== 0;

      // Remaining position %
      const remainingSize = trade.remainingSize ?? trade.positionSize;
      const remainingPct = Math.round((remainingSize / trade.positionSize) * 100);
      const hasPartial = !!(trade.tp1ClosedSize || trade.tp2ClosedSize);

      const parts: string[] = [
        `${directionTag(trade.direction)} ${compactSymbol(trade.symbol)}`,
        '',
        `Entry: <b>${formatPrice(trade.symbol, trade.entryPrice)}</b>`,
        `SL: ${slLabel}`,
        '',
        `${tpStatus(hits.tp1)} TP1: <b>${formatPrice(trade.symbol, trade.takeProfit1)}</b>`,
        `${tpStatus(hits.tp2)} TP2: <b>${formatPrice(trade.symbol, trade.takeProfit2)}</b>`,
        `${tpStatus(hits.tp3)} TP3: <b>${formatPrice(trade.symbol, trade.takeProfit3)}</b>`,
      ];

      if (hasFixed) {
        parts.push('');
        parts.push('Fixed PnL:');
        parts.push(`<b>${signed(fixedPnl)} USDT</b>`);
      }

      if (hasPartial) {
        parts.push('');
        parts.push('Remaining:');
        parts.push(`<b>${remainingPct}%</b>`);
      }

      return parts.join('\n');
    })
    .join('\n\n─────────────────\n\n');
}

export function formatSignalsListMessage(signals: Signal[]): string {
  return signals.map(signal => `
${directionStyle(signal.direction)} ${compactSymbol(signal.symbol)}
Entry: <b>${signal.entryPrice}</b>
Confidence: <b>${signal.confidence}/10</b>
Status: <b>${signalStatus(signal.status)}</b>
`.trim()).join('\n\n');
}

// ─── TP UPDATE ────────────────────────────────────────────────────────────────
function directionTag(direction: Direction): string {
  return direction === 'LONG' ? '🟢 LONG' : '🔴 SHORT';
}

function formatPct(value: number): string {
  return Math.round(value) + '%';
}

export function formatTpUpdateMessage(
  trade: Trade,
  tpLevel: number,
  currentPrice: number,
  slNote?: 'breakeven' | 'TP1',
): string {
  const tpPrice = tpLevel === 1 ? trade.takeProfit1 : trade.takeProfit2;
  const partialPnl = tpLevel === 1 ? (trade.tp1PnlUsdt ?? null) : (trade.tp2PnlUsdt ?? null);
  const closedSize = tpLevel === 1 ? (trade.tp1ClosedSize ?? null) : (trade.tp2ClosedSize ?? null);
  const remainingSize = trade.remainingSize ?? trade.positionSize;

  const fixedPct = closedSize !== null
    ? formatPct((closedSize / trade.positionSize) * 100)
    : '33%';
  const remainingPct = formatPct((remainingSize / trade.positionSize) * 100);

  const pnlLine = partialPnl !== null
    ? `PnL: <b>${signed(partialPnl)} USDT</b>`
    : '';

  const slLine = slNote === 'TP1'
    ? 'SL: <b>TP1</b>'
    : slNote === 'breakeven'
    ? 'SL: <b>Breakeven</b>'
    : '';

  const parts = [
    `🎯 <b>TP${tpLevel} HIT</b>`,
    '',
    `${directionTag(trade.direction)} ${compactSymbol(trade.symbol)}`,
    '',
    `Entry: <b>${formatPrice(trade.symbol, trade.entryPrice)}</b>`,
    `TP${tpLevel}: <b>${formatPrice(trade.symbol, tpPrice)}</b>`,
    '',
    `Fixed: <b>${fixedPct}</b>`,
    pnlLine,
    '',
    slLine,
    `Remaining: <b>${remainingPct}</b>`,
  ].filter(line => line !== null && (line !== '' || true));

  // collapse consecutive blank lines
  const result: string[] = [];
  let prevBlank = false;
  for (const line of parts) {
    if (line === '') {
      if (!prevBlank) result.push(line);
      prevBlank = true;
    } else {
      result.push(line);
      prevBlank = false;
    }
  }

  return result.join('\n').trim();
}

// ─── TRADE CLOSED ─────────────────────────────────────────────────────────────
export function formatTradeClosedMessage(trade: Trade, improvements?: string[]): string {
  const isWin = trade.result === 'win';
  const isBreakeven = trade.result === 'breakeven';
  const icon = isWin ? '✅' : isBreakeven ? '⚖️' : '❌';
  const reasons = unique([
    ...(trade.errorTags ?? []).filter(tag => tag !== 'correct_execution').map(tag => tag.replace(/_/g, ' ')),
    ...(trade.exitReason ?? '').split('\n'),
  ]).slice(0, 2).map(cleanReason);
  const aiFix = improvements?.[0] ? cleanReason(improvements[0]) : undefined;

  const tp1Pnl = trade.tp1PnlUsdt ?? 0;
  const tp2Pnl = trade.tp2PnlUsdt ?? 0;
  const hasPartialClose = tp1Pnl !== 0 || tp2Pnl !== 0;
  const totalPnlUsdt = trade.pnlUsdt ?? 0;

  // reason for close
  let closeReason = '';
  if (isBreakeven) {
    closeReason = tp1Pnl !== 0 ? 'Breakeven after TP1' : 'Breakeven';
  } else if (!isWin) {
    closeReason = 'Stop Loss';
  } else if (trade.status === 'closed_tp3') {
    closeReason = 'TP3';
  } else if (trade.status === 'closed_tp2') {
    closeReason = 'TP2';
  } else if (trade.status === 'closed_tp1') {
    closeReason = 'TP1';
  }

  let body = `${icon} <b>TRADE CLOSED</b>

${directionTag(trade.direction)} ${compactSymbol(trade.symbol)}

Reason: <b>${closeReason || (reasons[0] ?? '—')}</b>

`;

  if (hasPartialClose) {
    // Show total + breakdown
    body += `Total PnL:
<b>${signed(totalPnlUsdt)} USDT</b>

Breakdown:`;
    if (tp1Pnl !== 0) body += `\nTP1: <b>${signed(tp1Pnl)} USDT</b>`;
    if (tp2Pnl !== 0) body += `\nTP2: <b>${signed(tp2Pnl)} USDT</b>`;
    const finalPnl = totalPnlUsdt - tp1Pnl - tp2Pnl;
    body += `\nFinal: <b>${signed(finalPnl)} USDT</b>`;
  } else {
    // Simple close — show PnL%  + USDT
    body += `PnL:
<b>${signed(trade.pnlPercent)}% / ${signed(totalPnlUsdt)} USDT</b>`;
    if (!isWin && !isBreakeven && aiFix) {
      body += `\n\nAI fix:\n${aiFix}`;
    }
  }

  return body.trim();
}

// ─── Daily Report ─────────────────────────────────────────────────────────────
export function formatDailyReport(
  date: string,
  trades: Trade[],
  balance: number | null,
  startBalance: number | null,
  options: { mode?: 'PAPER' | 'LIVE'; okxBalance?: number | null } = {},
): string {
  const closed = trades.filter(t => t.status !== 'open');
  const wins = closed.filter(t => t.result === 'win');
  const losses = closed.filter(t => t.result === 'loss');
  const breakevens = closed.filter(t => t.result === 'breakeven');
  const totalTradePnlPercent = closed.reduce((a, t) => a + (t.pnlPercent ?? 0), 0);
  const averageTradePercent = closed.length > 0 ? totalTradePnlPercent / closed.length : 0;
  const winRate = closed.length > 0 ? (wins.length / closed.length) * 100 : 0;
  const resultUsdt = balance === null || startBalance === null ? null : balance - startBalance;
  const equityPercent = startBalance && balance !== null
    ? ((balance - startBalance) / startBalance) * 100
    : 0;
  const accountTitle = options.mode === 'PAPER' ? '💼 <b>PAPER ACCOUNT</b>' : '💼 <b>LIVE ACCOUNT</b>';
  const okxReferenceLine = options.mode === 'PAPER'
    ? `
OKX reference balance:
<b>${formatDisplayBalance(options.okxBalance ?? null)}</b>`
    : '';

  return `
📋 <b>DAILY DESK REPORT</b>

Date: <b>${escapeHtml(date)}</b>

${accountTitle}

Start:
<b>${formatDisplayBalance(startBalance)}</b>

Current:
<b>${formatDisplayBalance(balance)}</b>

Result:
<b>${resultUsdt === null ? 'unavailable' : `${signed(resultUsdt)} USDT (${signed(equityPercent)}%)`}</b>

━━━━━━━━━━━━━━

Trades:
<b>${closed.length}</b>

Wins / Losses / BE:
<b>${wins.length} / ${losses.length} / ${breakevens.length}</b>

Winrate:
<b>${winRate.toFixed(1)}%</b>

━━━━━━━━━━━━━━

Average trade:
<b>${signed(averageTradePercent)}%</b>${okxReferenceLine}
`.trim();
}

// ─── Learning Report ──────────────────────────────────────────────────────────
export function formatLearningReport(report: AnalysisReport): string {
  const learning = report.learning;
  if (!learning) {
    const topError = report.frequentErrors[0] ? cleanReason(report.frequentErrors[0]) : 'No recurring error';
    const topRecommendation = report.recommendations[0] ? cleanReason(report.recommendations[0]) : 'Keep current rules';
    return `
🧠 <b>AI LEARNING</b>

Trades: <b>${report.totalTrades}</b>
Winrate: <b>${report.winRate.toFixed(1)}%</b>
Profit factor: <b>${report.profitFactor.toFixed(2)}</b>

Main issue:
${topError}

AI fix:
${topRecommendation}
`.trim();
  }

  const bestSetupLines = learning.bestSetups.length > 0
    ? learning.bestSetups.slice(0, 2).map(setup => `${escapeHtml(setup.name)}\nWinrate: <b>${setup.winRate.toFixed(0)}%</b>`).join('\n\n')
    : 'not enough data';
  const worstSetupLines = learning.worstSetups.length > 0
    ? learning.worstSetups.slice(0, 2).map(setup => `${escapeHtml(setup.name)}\nWinrate: <b>${setup.winRate.toFixed(0)}%</b>`).join('\n\n')
    : 'not enough data';
  const bestPhaseLines = learning.bestMarketPhases.length > 0
    ? learning.bestMarketPhases.slice(0, 2).map(phase => `${escapeHtml(phase.phase)} — <b>${phase.winRate.toFixed(0)}%</b>`).join('\n')
    : 'not enough data';
  const worstPhaseLines = learning.worstMarketPhases.length > 0
    ? learning.worstMarketPhases.slice(0, 2).map(phase => `${escapeHtml(phase.phase)} — <b>${phase.winRate.toFixed(0)}%</b>`).join('\n')
    : 'not enough data';
  const errors = learning.commonErrors.length > 0
    ? learning.commonErrors.slice(0, 3).map((error, idx) => `${idx + 1}. ${escapeHtml(error.name)} (${error.count})`).join('\n')
    : 'not enough data';
  const recommendations = learning.recommendations.items.slice(0, 6).map(item => `• ${cleanReason(item)}`).join('\n');
  const quality = learning.quality;

  return `
🧠 <b>LEARNING ENGINE</b>

Closed trades: <b>${learning.closedTrades}</b>
WIN: <b>${learning.wins}</b>
LOSS: <b>${learning.losses}</b>
Winrate: <b>${learning.winRate.toFixed(1)}%</b>

🎯 <b>TP Statistics</b>
TP1 reached: <b>${learning.tpStats.tp1ReachPercent.toFixed(0)}%</b>
TP2 reached: <b>${learning.tpStats.tp2ReachPercent.toFixed(0)}%</b>
TP3 reached: <b>${learning.tpStats.tp3ReachPercent.toFixed(0)}%</b>

🏆 <b>Best Setups</b>
${bestSetupLines}

💀 <b>Worst Setups</b>
${worstSetupLines}

📈 <b>Best Market Phase</b>
${bestPhaseLines}

📉 <b>Worst Market Phase</b>
${worstPhaseLines}

⚠ <b>Most Common Errors</b>
${errors}

📊 <b>TRADE QUALITY</b>
Average confidence: <b>${formatOptional(quality.averageConfidence, 1)} / 10</b>
Winning confidence: <b>${formatOptional(quality.winningConfidence, 1)} / 10</b>
Losing confidence: <b>${formatOptional(quality.losingConfidence, 1)} / 10</b>
Average holding time: <b>${formatDuration(quality.averageHoldingMinutes)}</b>
Average drawdown: <b>${formatOptional(quality.averageDrawdownPercent, 1)}%</b>
Average max profit before exit: <b>${formatOptional(quality.averageMaxProfitPercent, 1)}%</b>
${learning.missingFields.length > 0 ? `\nMissing data:\n${learning.missingFields.map(escapeHtml).join(', ')}` : ''}

🧠 <b>Recommendations</b>
${recommendations}

🤖 <b>Self Learning</b>
Status: <b>${learning.selfLearning.status}</b>
Reason: <b>${escapeHtml(learning.selfLearning.reason)}</b>
Collected trades: <b>${learning.selfLearning.collectedTrades}</b>
Required: <b>${learning.selfLearning.requiredTrades}</b>
`.trim();
}

export function formatLearningDashboard(dashboard: LearningDashboard): string {
  return `
🧠 <b>AI Learning Engine</b>

Closed trades: <b>${dashboard.closedTrades}</b>
Winrate: <b>${dashboard.winRate.toFixed(1)}%</b>

Best setup:
<b>${escapeHtml(dashboard.bestSetup)}</b>

Worst setup:
<b>${escapeHtml(dashboard.worstSetup)}</b>

TP reach:
TP1: <b>${dashboard.tp1ReachPercent.toFixed(0)}%</b>
TP2: <b>${dashboard.tp2ReachPercent.toFixed(0)}%</b>
TP3: <b>${dashboard.tp3ReachPercent.toFixed(0)}%</b>

Top error:
<b>${escapeHtml(dashboard.topError)}</b>

Self-learning:
❌ <b>OFF</b>

Collected trades:
<b>${dashboard.selfLearning.collectedTrades} / ${dashboard.selfLearning.requiredTrades}</b>
`.trim();
}

function formatOptional(value: number | null, digits: number): string {
  return value === null ? 'not enough data' : value.toFixed(digits);
}

function formatDuration(minutes: number | null): string {
  if (minutes === null) return 'not enough data';
  const rounded = Math.round(minutes);
  const hours = Math.floor(rounded / 60);
  const mins = rounded % 60;
  return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
}

export function formatLearningInProgressMessage(completedTrades: number, requiredTrades = 10): string {
  return `
🧠 <b>AI learning in progress</b>

Completed trades:
<b>${completedTrades} / ${requiredTrades}</b>
`.trim();
}

// ─── HEARTBEAT ────────────────────────────────────────────────────────────────
export function formatHeartbeatMessage(input: HeartbeatInput): string {
  return `
🟢 <b>Scanner active</b>

Checked: <b>${input.checkedSymbols}</b> symbols
Signals found: <b>${input.signalsFound}</b>
Open positions: <b>${input.openPositions}</b>
Last scan: <b>${input.lastScan ?? '—'}</b>
`.trim();
}

// ─── Error Alert ──────────────────────────────────────────────────────────────
export function formatErrorAlert(error: string, context?: string): string {
  return `
⚠️ <b>Bot alert</b>

${context ? `Context: <code>${escapeHtml(context)}</code>\n` : ''}Error: <code>${escapeHtml(error)}</code>
`.trim();
}
