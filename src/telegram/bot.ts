import TelegramBot from 'node-telegram-bot-api';
import { config } from '../config';
import { logger } from '../utils/logger';
import {
  formatSignalMessage,
  formatTradeClosedMessage,
  formatTpUpdateMessage,
  formatStatusMessage,
  formatErrorAlert,
  formatLearningReport,
  formatPositionsMessage,
  formatSignalsListMessage,
  formatLearningInProgressMessage,
  formatLearningDashboard,
  formatHeartbeatMessage,
} from './messages';
import {
  getBotState,
  getOpenTrades,
  getRecentSignals,
  getLastNTrades,
} from '../database/db';
import { getDisplayBalance, getOkxReferenceBalance } from '../utils/balance';
import { getDailyRiskSnapshot, pauseBot, resetDailyRiskLock, resumeBot } from '../strategy/riskManager';
import { generateDailyReport } from '../reports/dailyReport';
import { generateLearningDashboard, generateLearningReport } from '../reports/learningReport';
import type { Signal, Trade } from '../database/models';

let bot: TelegramBot;
const ADMIN_IDS = config.telegram.adminId ? [config.telegram.adminId] : [];

const scannerTelemetry = {
  checkedSymbols: config.trading.symbols.length,
  signalsFound: 0,
  openPositions: 0,
  lastScan: undefined as string | undefined,
};

function formatClock(date = new Date()): string {
  return date.toISOString().slice(11, 16);
}

export function recordScannerRun(checkedSymbols: number, signalsFound: number, openPositions: number): void {
  scannerTelemetry.checkedSymbols = checkedSymbols;
  scannerTelemetry.signalsFound = signalsFound;
  scannerTelemetry.openPositions = openPositions;
  scannerTelemetry.lastScan = formatClock();
}

export function initTelegramBot(): TelegramBot {
  bot = new TelegramBot(config.telegram.botToken, { polling: true });

  registerCommands();
  logger.info('🤖 Telegram bot started');

  return bot;
}

export function getBot(): TelegramBot {
  if (!bot) throw new Error('Telegram bot not initialized');
  return bot;
}

function isAdmin(chatId: string): boolean {
  if (ADMIN_IDS.length === 0) return true; // No admin list = any user
  return ADMIN_IDS.includes(chatId);
}

function formatBalance(balance: number | null): string {
  return balance === null ? 'unavailable' : `${balance.toFixed(2)} USDT`;
}

const MAIN_MENU_KEYBOARD: TelegramBot.ReplyKeyboardMarkup = {
  keyboard: [
    [{ text: '📊 Статус' }, { text: '⏸ Пауза' }],
    [{ text: '▶️ Возобновить' }, { text: '📦 Позиции' }],
    [{ text: '📈 Сигналы' }, { text: '📋 Отчет' }],
    [{ text: '⚙️ Риск' }, { text: '🧠 Анализ' }],
    [{ text: '🧠 Learning' }],
  ],
  resize_keyboard: true,
  is_persistent: true,
};

function registerCommands(): void {
  // /start
  bot.onText(/\/start/, async (msg) => {
    await sendStatus(msg.chat.id.toString());
  });

  // /balance
  bot.onText(/\/balance/, async (msg) => {
    if (!isAdmin(msg.chat.id.toString())) return;
    await sendBalance(msg.chat.id.toString());
  });

  // /signals
  bot.onText(/\/signals/, async (msg) => {
    await sendSignals(msg.chat.id.toString());
  });

  // /positions
  bot.onText(/\/positions/, async (msg) => {
    if (!isAdmin(msg.chat.id.toString())) return;
    await sendPositions(msg.chat.id.toString());
  });

  // /stats
  bot.onText(/\/stats/, async (msg) => {
    await sendStats(msg.chat.id.toString());
  });

  // /pause
  bot.onText(/\/pause/, (msg) => {
    if (!isAdmin(msg.chat.id.toString())) return;
    sendPause(msg.chat.id.toString());
  });

  // /resume
  bot.onText(/\/resume/, (msg) => {
    if (!isAdmin(msg.chat.id.toString())) return;
    sendResume(msg.chat.id.toString());
  });

  // /mode
  bot.onText(/\/mode/, async (msg) => {
    if (!isAdmin(msg.chat.id.toString())) return;
    await sendMode(msg.chat.id.toString());
  });

  // /risk
  bot.onText(/\/risk/, async (msg) => {
    if (!isAdmin(msg.chat.id.toString())) return;
    await sendRisk(msg.chat.id.toString());
  });

  // /reset-risk
  bot.onText(/\/reset-risk/, async (msg) => {
    if (!isAdmin(msg.chat.id.toString())) return;
    await sendResetRisk(msg.chat.id.toString());
  });

  // /report
  bot.onText(/\/report/, async (msg) => {
    if (!isAdmin(msg.chat.id.toString())) return;
    await sendReport(msg.chat.id.toString());
  });

  // /errors
  bot.onText(/\/errors/, async (msg) => {
    if (!isAdmin(msg.chat.id.toString())) return;
    await sendErrors(msg.chat.id.toString());
  });

  // /analyze (trigger learning report manually)
  bot.onText(/\/analyze/, async (msg) => {
    if (!isAdmin(msg.chat.id.toString())) return;
    await sendAnalyze(msg.chat.id.toString());
  });

  // /learning
  bot.onText(/\/learning/, async (msg) => {
    if (!isAdmin(msg.chat.id.toString())) return;
    await sendLearning(msg.chat.id.toString());
  });

  // Reply keyboard buttons
  bot.onText(/^📊 Статус$/, async (msg) => {
    await sendStatus(msg.chat.id.toString());
  });

  bot.onText(/^⏸ Пауза$/, (msg) => {
    if (!isAdmin(msg.chat.id.toString())) return;
    sendPause(msg.chat.id.toString());
  });

  bot.onText(/^▶️ Возобновить$/, (msg) => {
    if (!isAdmin(msg.chat.id.toString())) return;
    sendResume(msg.chat.id.toString());
  });

  bot.onText(/^📦 Позиции$/, async (msg) => {
    if (!isAdmin(msg.chat.id.toString())) return;
    await sendPositions(msg.chat.id.toString());
  });

  bot.onText(/^📈 Сигналы$/, async (msg) => {
    await sendSignals(msg.chat.id.toString());
  });

  bot.onText(/^📋 Отчет$/, async (msg) => {
    if (!isAdmin(msg.chat.id.toString())) return;
    await sendReport(msg.chat.id.toString());
  });

  bot.onText(/^⚙️ Риск$/, async (msg) => {
    if (!isAdmin(msg.chat.id.toString())) return;
    await sendRisk(msg.chat.id.toString());
  });

  bot.onText(/^🧠 Анализ$/, async (msg) => {
    if (!isAdmin(msg.chat.id.toString())) return;
    await sendAnalyze(msg.chat.id.toString());
  });

  bot.onText(/^🧠 Learning$/, async (msg) => {
    if (!isAdmin(msg.chat.id.toString())) return;
    await sendLearning(msg.chat.id.toString());
  });

  // Handle polling errors gracefully
  bot.on('polling_error', (err) => {
    logger.error(`Telegram polling error: ${err.message}`);
  });
}

async function sendStatus(chatId: string): Promise<void> {
  const state = getBotState();
  const openTrades = getOpenTrades();
  const balance = await getDisplayBalance();
  const okxBalance = config.trading.isLive ? undefined : await getOkxReferenceBalance();
  await send(chatId, formatStatusMessage({
    okxApiMode: config.okx.isDemo ? 'DEMO' : 'LIVE',
    mode: config.trading.isLive ? 'LIVE' : 'PAPER',
    isPaused: state.isPaused,
    openPositions: openTrades.length,
    balance,
    okxBalance,
    consecutiveLosses: state.consecutiveLosses,
    pauseReason: state.pauseReason,
    symbolsCount: config.trading.symbols.length,
    timeframes: config.trading.timeframes,
    lastScan: scannerTelemetry.lastScan,
  }), true);
}

async function sendBalance(chatId: string): Promise<void> {
  const balance = await getDisplayBalance();
  const okxBalance = config.trading.isLive ? undefined : await getOkxReferenceBalance();
  const okxLine = config.trading.isLive ? '' : `\nOKX balance: <b>${formatBalance(okxBalance ?? null)}</b>`;

  await send(chatId, `
💰 <b>BALANCE</b>

${config.trading.isLive ? 'Balance' : 'Paper balance'}: <b>${formatBalance(balance)}</b>${okxLine}
Mode: <b>${config.trading.isLive ? 'LIVE' : 'PAPER'}</b>
`.trim(), true);
}

async function sendSignals(chatId: string): Promise<void> {
  const signals = getRecentSignals(5);
  if (signals.length === 0) {
    await send(chatId, '📈 <b>No recent signals</b>', true);
    return;
  }
  await send(chatId, formatSignalsListMessage(signals), true);
}

async function sendPositions(chatId: string): Promise<void> {
  const trades = getOpenTrades();
  if (trades.length === 0) {
    await send(chatId, '📦 <b>No open positions</b>', true);
    return;
  }
  await send(chatId, formatPositionsMessage(trades), true);
}

async function sendStats(chatId: string): Promise<void> {
  const trades = getLastNTrades(50);
  const closed = trades.filter(t => t.status !== 'open');
  if (closed.length === 0) {
    await send(chatId, '📊 <b>No closed trades</b>', true);
    return;
  }
  const wins = closed.filter(t => t.result === 'win');
  const winRate = (wins.length / closed.length) * 100;
  const totalPnl = closed.reduce((a, t) => a + (t.pnlPercent ?? 0), 0);
  const avgWin = wins.length > 0 ? wins.reduce((a, t) => a + (t.pnlPercent ?? 0), 0) / wins.length : 0;
  const losses = closed.filter(t => t.result === 'loss');
  const avgLoss = losses.length > 0 ? losses.reduce((a, t) => a + (t.pnlPercent ?? 0), 0) / losses.length : 0;

  await send(chatId, `
📊 <b>PERFORMANCE</b>

Trades: <b>${closed.length}</b>
Wins / Losses: <b>${wins.length} / ${losses.length}</b>
Winrate: <b>${winRate.toFixed(1)}%</b>
PNL: <b>${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}%</b>
Avg win/loss: <b>+${avgWin.toFixed(2)}% / ${avgLoss.toFixed(2)}%</b>
`.trim(), true);
}

function sendPause(chatId: string): void {
  pauseBot('Ручная остановка через Telegram');
  send(chatId, '⏸ Торговля поставлена на паузу. Новые сделки открываться не будут.', true);
}

function sendResume(chatId: string): void {
  resumeBot();
  send(chatId, '▶️ Торговля возобновлена. Сканер снова проверяет рынок каждые 5 минут.', true);
}

async function sendMode(chatId: string): Promise<void> {
  await send(chatId, `
⚙️ <b>MODE</b>

OKX API mode: <b>${config.okx.isDemo ? 'DEMO' : 'LIVE'}</b>
Trade execution: <b>${config.trading.isLive ? 'LIVE' : 'PAPER'}</b>
Auto trade: <b>${config.trading.autoTrade ? 'ON' : 'OFF'}</b>
`.trim(), true);
}

async function sendRisk(chatId: string): Promise<void> {
  const state = getBotState();
  const dailyRisk = getDailyRiskSnapshot();
  const riskLockOn = config.trading.isLive && dailyRisk.isLimitReached && state.isPaused;
  const tradeLines = dailyRisk.trades.length > 0
    ? dailyRisk.trades.slice(0, 4).map(trade =>
        `• #${trade.id} ${trade.symbol} ${trade.direction} ${trade.pnlPercent && trade.pnlPercent >= 0 ? '+' : ''}${(trade.pnlPercent ?? 0).toFixed(2)}%`
      ).join('\n')
    : '—';

  await send(chatId, `
📊 <b>Risk Status</b>

Mode: <b>${dailyRisk.mode}</b>
Daily Net PnL: <b>${dailyRisk.dailyPnlPercent >= 0 ? '+' : ''}${dailyRisk.dailyPnlPercent.toFixed(2)}%</b>
Closed Trades Today: <b>${dailyRisk.closedTradesCount}</b>
Risk Lock: <b>${riskLockOn ? 'ON' : 'OFF'}</b>
Paused Until: <b>${state.pausedUntil ?? '—'}</b>
Daily Limit: <b>${config.trading.maxDailyLoss}%</b>
Daily limit behavior: <b>${dailyRisk.behavior}</b>
Reason: <b>${riskLockOn ? (state.pauseReason ?? '—') : '—'}</b>

Trades:
${tradeLines}
`.trim(), true);
}

async function sendResetRisk(chatId: string): Promise<void> {
  if (config.trading.isLive) {
    await send(chatId, '🧯 <b>Reset unavailable</b>\n\nPaper mode only.', true);
    return;
  }

  const snapshot = resetDailyRiskLock();
  await send(chatId, `
🧯 <b>RISK RESET</b>

Mode: <b>PAPER</b>
Daily lock: <b>cleared</b>
Closed today: <b>${snapshot.closedTradesCount}</b>
Realized PnL: <b>${snapshot.dailyPnlPercent >= 0 ? '+' : ''}${snapshot.dailyPnlPercent.toFixed(2)}%</b>
`.trim(), true);
}

async function sendReport(chatId: string): Promise<void> {
  try {
    const report = await generateDailyReport();
    await send(chatId, report, true);
  } catch (err: any) {
    logger.error(`Report error: ${err.message}`);
    await send(chatId, '📋 <b>Report unavailable</b>\n\nTry again later.', true);
  }
}

async function sendErrors(chatId: string): Promise<void> {
  const trades = getLastNTrades(20).filter(t => t.result === 'loss');
  if (trades.length === 0) {
    await send(chatId, '✅ <b>No loss patterns</b>', true);
    return;
  }
  const tagCounts: Record<string, number> = {};
  for (const t of trades) {
    for (const tag of t.errorTags ?? []) {
      tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;
    }
  }
  const sorted = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const text = sorted.map(([tag, count]) => `• ${tag.replace(/_/g, ' ')}: ${count}x`).join('\n');
  await send(chatId, `⚠️ <b>LOSS PATTERNS</b>\n\n${text}`, true);
}

async function sendAnalyze(chatId: string): Promise<void> {
  try {
    const report = generateLearningReport(20);
    if (report) {
      await send(chatId, formatLearningReport(report), true);
    } else {
      const completedTrades = getLastNTrades(10).filter(t => t.status !== 'open').length;
      await send(chatId, formatLearningInProgressMessage(completedTrades), true);
    }
  } catch (err: any) {
    logger.error(`AI analysis error: ${err.message}`);
    await send(chatId, '🧠 <b>AI unavailable</b>\n\nTry again later.', true);
  }
}

async function sendLearning(chatId: string): Promise<void> {
  try {
    const dashboard = generateLearningDashboard(100);
    await send(chatId, formatLearningDashboard(dashboard), true);
  } catch (err: any) {
    logger.error(`Learning dashboard error: ${err.message}`);
    await send(chatId, '🧠 <b>Learning unavailable</b>\n\nTry again later.', true);
  }
}

// ─── Outbound helpers ─────────────────────────────────────────────────────────

async function send(chatId: string, text: string, withMenu = false): Promise<void> {
  try {
    const options: TelegramBot.SendMessageOptions = {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    };
    if (withMenu) {
      options.reply_markup = MAIN_MENU_KEYBOARD;
    }
    await bot.sendMessage(chatId, text, options);
  } catch (err: any) {
    logger.error(`Failed to send Telegram message: ${err.message}`);
  }
}

export async function broadcastSignal(signal: Signal): Promise<void> {
  await send(config.telegram.chatId, formatSignalMessage(signal));
}

export async function broadcastTradeClosed(trade: Trade, improvements?: string[]): Promise<void> {
  await send(config.telegram.chatId, formatTradeClosedMessage(trade, improvements));
}

export async function broadcastTpHit(trade: Trade, level: number, price: number, stopMovedToBreakeven = false): Promise<void> {
  const text = formatTpUpdateMessage(trade, level, price, stopMovedToBreakeven);
  await send(config.telegram.chatId, text);
}

export async function sendErrorAlert(error: string, context?: string): Promise<void> {
  if (!config.telegram.adminId) {
    logger.error(`Telegram admin alert skipped: ${context ? `${context}: ` : ''}${error}`);
    return;
  }
  await send(config.telegram.adminId, formatErrorAlert(error, context));
}

export async function broadcastScannerHeartbeat(): Promise<void> {
  await send(config.telegram.chatId, formatHeartbeatMessage(scannerTelemetry));
}

export async function broadcastMessage(text: string): Promise<void> {
  await send(config.telegram.chatId, text);
}
