import type { Signal, Trade, AnalysisReport, Direction } from '../database/models';

interface StatusMessageInput {
  mode: 'PAPER' | 'LIVE';
  isPaused: boolean;
  openPositions: number;
  balance: number;
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

Mode: <b>${input.mode}</b>
Scanner: <b>${scannerState}</b>
Positions: <b>${input.openPositions}</b>
Balance: <b>${input.balance.toFixed(2)} USDT</b>
Loss streak: <b>${input.consecutiveLosses}</b>

Reason:
${input.pauseReason ? escapeHtml(input.pauseReason) : 'Manual pause'}

Last scan: <b>${lastScan}</b>
`.trim();
  }

  return `
🟢 <b>BOT ACTIVE</b>

Mode: <b>${input.mode}</b>
Scanner: <b>${scannerState}</b>
Positions: <b>${input.openPositions}</b>
Balance: <b>${input.balance.toFixed(2)} USDT</b>
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
  return trades.map(trade => `
${directionStyle(trade.direction)} ${compactSymbol(trade.symbol)}

Entry: <b>${trade.entryPrice}</b>
SL: <b>${trade.stopLoss}</b>

🎯 TP1: <b>${trade.takeProfit1}</b>
🎯 TP2: <b>${trade.takeProfit2}</b>
🎯 TP3: <b>${trade.takeProfit3}</b>

Risk: <b>${riskLabel(trade)}</b>
`.trim()).join('\n\n');
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
export function formatTpUpdateMessage(trade: Trade, tpLevel: number, currentPrice: number): string {
  const pnlPercent = tradePnlPercent(trade, currentPrice);
  const pnlUsdt = (pnlPercent / 100) * trade.positionSize * trade.entryPrice;

  return `
🎯 <b>TP${tpLevel} HIT — ${compactSymbol(trade.symbol)}</b>

${directionStyle(trade.direction)}

<b>${signed(pnlPercent, 1)}%</b>
<b>${signed(pnlUsdt, 1)} USDT</b>

Position still active
`.trim();
}

// ─── TRADE CLOSED ─────────────────────────────────────────────────────────────
export function formatTradeClosedMessage(trade: Trade, improvements?: string[]): string {
  const isWin = trade.result === 'win';
  const icon = isWin ? '✅' : '❌';
  const reasons = unique([
    ...(trade.errorTags ?? []).filter(tag => tag !== 'correct_execution').map(tag => tag.replace(/_/g, ' ')),
    ...(trade.exitReason ?? '').split('\n'),
  ]).slice(0, 2).map(cleanReason);
  const aiFix = improvements?.[0] ? cleanReason(improvements[0]) : undefined;

  return `
${icon} <b>${compactSymbol(trade.symbol)} CLOSED</b>

${directionStyle(trade.direction)}

PNL: <b>${signed(trade.pnlPercent)}%</b>
<b>${signed(trade.pnlUsdt)} USDT</b>
${reasons.length > 0 ? `\nReason:\n${reasons.join('\n')}` : ''}
${!isWin && aiFix ? `\nAI fix:\n${aiFix}` : ''}
`.trim();
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
📋 <b>DAILY DESK REPORT</b>

Date: <b>${escapeHtml(date)}</b>
Balance: <b>${balance.toFixed(2)} USDT</b>
Δ Balance: <b>${signed(balance - startBalance)} USDT</b>

Trades: <b>${closed.length}</b>
Wins / Losses: <b>${wins.length} / ${losses.length}</b>
Winrate: <b>${winRate.toFixed(1)}%</b>
P&L: <b>${signed(totalPnl)}%</b>
`.trim();
}

// ─── Learning Report ──────────────────────────────────────────────────────────
export function formatLearningReport(report: AnalysisReport): string {
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
