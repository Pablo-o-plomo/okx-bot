import TelegramBot from 'node-telegram-bot-api';
import { config } from '../config';
import { logger } from '../utils/logger';
import {
  formatSignalMessage,
  formatTradeClosedMessage,
  formatTradeOpenedMessage,
  sendTradeUpdate as buildTpMessage,
  formatDailyReport,
  formatStatusMessage,
  formatErrorAlert,
  formatLearningReport,
} from './messages';
import {
  getBotState,
  getOpenTrades,
  getRecentSignals,
  getLastNTrades,
  getTodayTrades,
  getWinrateBySymbol,
} from '../database/db';
import { getAccountBalance } from '../okx/trading';
import { pauseBot, resumeBot } from '../strategy/riskManager';
import { generateDailyReport } from '../reports/dailyReport';
import { generateLearningReport } from '../reports/learningReport';
import { generateMarketSummary } from '../reports/marketSummary';
import { generateErrorAnalysis } from '../reports/errorAnalysis';
import { generateRejectStats } from '../reports/rejectStats';
import { generateHeartbeatReport } from '../reports/heartbeat';
import { adminCallbacks, adminMenuMarkup, adminPanelText } from './adminMenu';
import type { Signal, Trade } from '../database/models';

let bot: TelegramBot;
const ADMIN_IDS = config.telegram.adminId ? [config.telegram.adminId] : [];

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
  if (ADMIN_IDS.length === 0) return false;
  return ADMIN_IDS.includes(chatId);
}

async function denyIfNotAdmin(chatId: string): Promise<boolean> {
  if (isAdmin(chatId)) return false;
  await send(chatId, '⛔ Access denied');
  return true;
}

function registerCommands(): void {
  // /start
  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id.toString();
    if (!isAdmin(chatId)) {
      await send(chatId, '⛔ Access denied');
      return;
    }
    await bot.sendMessage(chatId, adminPanelText(), {
      parse_mode: 'HTML',
      reply_markup: adminMenuMarkup(),
      disable_web_page_preview: true,
    });
  });

  // /balance
  bot.onText(/\/balance/, async (msg) => {
    if (!isAdmin(msg.chat.id.toString())) return;
    const balance = await getAccountBalance();
    const state = getBotState();
    await send(msg.chat.id.toString(), `💰 <b>Баланс:</b> ${balance.toFixed(2)} USDT\nРежим: ${state.mode.toUpperCase()}`);
  });

  // /signals
  bot.onText(/\/signals/, async (msg) => {
    if (await denyIfNotAdmin(msg.chat.id.toString())) return;
    const signals = getRecentSignals(5);
    if (signals.length === 0) {
      await send(msg.chat.id.toString(), '📭 Нет сигналов в базе.');
      return;
    }
    const text = signals.map(s =>
      `• ${s.symbol} ${s.direction} @ ${s.entryPrice} | Уверенность: ${s.confidence}/10 | ${s.status} | ${s.createdAt?.split('T')[0]}`
    ).join('\n');
    await send(msg.chat.id.toString(), `📋 <b>Последние сигналы:</b>\n${text}`);
  });

  // /positions
  bot.onText(/\/positions/, async (msg) => {
    if (!isAdmin(msg.chat.id.toString())) return;
    const trades = getOpenTrades();
    if (trades.length === 0) {
      await send(msg.chat.id.toString(), '📭 Нет открытых позиций.');
      return;
    }
    const text = trades.map(t =>
      `• ${t.symbol} ${t.direction} @ ${t.entryPrice} | SL: ${t.stopLoss} | TP1: ${t.takeProfit1}`
    ).join('\n');
    await send(msg.chat.id.toString(), `📊 <b>Открытые позиции (${trades.length}):</b>\n${text}`);
  });

  // /stats
  bot.onText(/\/stats/, async (msg) => {
    if (await denyIfNotAdmin(msg.chat.id.toString())) return;
    const trades = getLastNTrades(50);
    const closed = trades.filter(t => t.status !== 'open');
    if (closed.length === 0) {
      await send(msg.chat.id.toString(), '📭 Нет закрытых сделок.');
      return;
    }
    const wins = closed.filter(t => t.result === 'win');
    const winRate = (wins.length / closed.length) * 100;
    const totalPnl = closed.reduce((a, t) => a + (t.pnlPercent ?? 0), 0);
    const avgWin = wins.length > 0 ? wins.reduce((a, t) => a + (t.pnlPercent ?? 0), 0) / wins.length : 0;
    const losses = closed.filter(t => t.result === 'loss');
    const avgLoss = losses.length > 0 ? losses.reduce((a, t) => a + (t.pnlPercent ?? 0), 0) / losses.length : 0;

    await send(msg.chat.id.toString(), `
📊 <b>Статистика (последние ${closed.length} сделок):</b>

✅ Побед: ${wins.length} | ❌ Поражений: ${losses.length}
Winrate: <b>${winRate.toFixed(1)}%</b>
Общий PnL: <b>${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}%</b>
Средняя прибыль: +${avgWin.toFixed(2)}%
Средний убыток: ${avgLoss.toFixed(2)}%
    `.trim());
  });


  bot.onText(/\/winrate/, async (msg) => {
    if (await denyIfNotAdmin(msg.chat.id.toString())) return;
    const rows = getWinrateBySymbol();
    const text = rows.length ? rows.map(r => `${r.symbol} — ${r.winrate.toFixed(0)}% | ${r.trades} сделок | PnL ${r.pnlPercent >= 0 ? '+' : ''}${r.pnlPercent.toFixed(1)}%`).join('\n') : 'нет данных';
    await send(msg.chat.id.toString(), `📊 <b>Winrate по монетам</b>
${text}`);
  });
  bot.onText(/\/market/, async (msg) => { if (await denyIfNotAdmin(msg.chat.id.toString())) return; await send(msg.chat.id.toString(), generateMarketSummary()); });
  bot.onText(/\/filters/, async (msg) => { if (await denyIfNotAdmin(msg.chat.id.toString())) return; await send(msg.chat.id.toString(), `🧰 Filters
MIN_ATR_PERCENT=${config.trading.minAtrPercent}
MAX_ATR_PERCENT=${config.trading.maxAtrPercent}
MIN_SIGNAL_CONFIDENCE=${config.trading.minSignalConfidence}`); });

  // /pause
  bot.onText(/\/pause/, (msg) => {
    if (!isAdmin(msg.chat.id.toString())) return;
    pauseBot('Ручная остановка через Telegram');
    send(msg.chat.id.toString(), '⛔ Торговля остановлена вручную.');
  });

  // /resume
  bot.onText(/\/resume/, (msg) => {
    if (!isAdmin(msg.chat.id.toString())) return;
    resumeBot();
    send(msg.chat.id.toString(), '▶️ Торговля возобновлена.');
  });

  // /mode
  bot.onText(/\/mode/, async (msg) => {
    if (!isAdmin(msg.chat.id.toString())) return;
    const state = getBotState();
    await send(msg.chat.id.toString(), `
⚙️ <b>Текущий режим:</b> ${state.mode.toUpperCase()}
LIVE_TRADING: ${config.trading.isLive ? '🟢 включен' : '🔴 выключен'}
DEMO_TRADING: ${config.okx.isDemo ? '🟢 включен' : '🔴 выключен'}
    `.trim());
  });

  // /risk
  bot.onText(/\/risk/, async (msg) => {
    if (!isAdmin(msg.chat.id.toString())) return;
    const state = getBotState();
    await send(msg.chat.id.toString(), `
⚙️ <b>Настройки риска:</b>

Риск на сделку: ${config.trading.riskPerTrade}%
Макс. дневной убыток: ${config.trading.maxDailyLoss}%
Макс. открытых позиций: ${config.trading.maxOpenPositions}
Макс. убытков подряд: ${config.trading.maxLossesInRow}
Текущий дневной убыток: ${state.dailyLossPercent.toFixed(2)}%
Убытков подряд сейчас: ${state.consecutiveLosses}
    `.trim());
  });

  // /report
  bot.onText(/\/report/, async (msg) => {
    if (!isAdmin(msg.chat.id.toString())) return;
    try {
      const report = await generateDailyReport();
      await send(msg.chat.id.toString(), report);
    } catch (err: any) {
      await send(msg.chat.id.toString(), `Ошибка генерации отчета: ${err.message}`);
    }
  });

  // /errors
  bot.onText(/\/errors/, async (msg) => {
    if (!isAdmin(msg.chat.id.toString())) return;
    const trades = getLastNTrades(20).filter(t => t.result === 'loss');
    if (trades.length === 0) {
      await send(msg.chat.id.toString(), '✅ Убыточных сделок нет.');
      return;
    }
    const tagCounts: Record<string, number> = {};
    for (const t of trades) {
      for (const tag of t.errorTags ?? []) {
        tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;
      }
    }
    const sorted = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]);
    const text = sorted.map(([tag, count]) => `• #${tag}: ${count}x`).join('\n');
    await send(msg.chat.id.toString(), `⚠️ <b>Частые ошибки (последние 20 сделок):</b>\n${text}`);
  });

  // /analyze (trigger learning report manually)
  bot.onText(/\/analyze/, async (msg) => {
    if (!isAdmin(msg.chat.id.toString())) return;
    try {
      const ml = generateErrorAnalysis();
      if (ml) await send(msg.chat.id.toString(), ml);
      const report = generateLearningReport(20);
      if (report) await send(msg.chat.id.toString(), formatLearningReport(report));
    } catch (err: any) {
      await send(msg.chat.id.toString(), `Ошибка: ${err.message}`);
    }
  });


  bot.onText(/\/rejects/, async (msg) => {
    if (!isAdmin(msg.chat.id.toString())) return;
    await send(msg.chat.id.toString(), generateRejectStats());
  });

  bot.onText(/\/health/, async (msg) => {
    if (!isAdmin(msg.chat.id.toString())) return;
    await send(msg.chat.id.toString(), generateHeartbeatReport());
  });

  bot.on('callback_query', async (query) => {
    const chatId = query.message?.chat.id.toString();
    const userId = query.from.id.toString();
    if (!chatId || !query.data?.startsWith('admin:')) return;
    if (!isAdmin(userId) && !isAdmin(chatId)) {
      await bot.answerCallbackQuery(query.id, { text: 'Access denied', show_alert: true });
      return;
    }
    const key = query.data.replace('admin:', '');
    const command = adminCallbacks[key];
    if (!command) return;
    await bot.answerCallbackQuery(query.id);
    await handleAdminCommand(chatId, command);
  });

  // Handle polling errors gracefully
  bot.on('polling_error', (err) => {
    logger.error(`Telegram polling error: ${err.message}`);
  });
}


async function handleAdminCommand(chatId: string, command: string): Promise<void> {
  if (command === '/stats') return send(chatId, buildStatsMessage());
  if (command === '/positions') return send(chatId, buildPositionsMessage());
  if (command === '/winrate') return send(chatId, buildWinrateMessage());
  if (command === '/market') return send(chatId, generateMarketSummary());
  if (command === '/rejects') return send(chatId, generateRejectStats());
  if (command === '/health') return send(chatId, generateHeartbeatReport());
  if (command === '/pause') { pauseBot('Ручная остановка через admin panel'); return send(chatId, '⛔ Торговля остановлена вручную.'); }
  if (command === '/resume') { resumeBot(); return send(chatId, '▶️ Торговля возобновлена.'); }
  if (command === '/mode') {
    const state = getBotState();
    return send(chatId, `⚙️ <b>Текущий режим:</b> ${state.mode.toUpperCase()}
LIVE_TRADING: ${config.trading.isLive ? '🟢 включен' : '🔴 выключен'}
QUALITY_MODE: ${config.trading.qualityMode}`);
  }
  if (command === '/risk') {
    const state = getBotState();
    return send(chatId, `🛡 <b>Риски</b>
Риск: ${config.trading.riskPerTrade}%
Дневной лимит: ${config.trading.maxDailyLoss}%
Открытых максимум: ${config.trading.maxOpenPositions}
Убытков подряд: ${state.consecutiveLosses}`);
  }
  if (command === '/report') {
    return send(chatId, await generateDailyReport());
  }
  if (command === '/analyze') {
    const ml = generateErrorAnalysis();
    const report = generateLearningReport(20);
    return send(chatId, [ml, report ? formatLearningReport(report) : undefined].filter(Boolean).join('\n\n') || '📭 Недостаточно данных для анализа.');
  }
  return send(chatId, `Команда ${command} пока недоступна.`);
}

function buildStatsMessage(): string {
  const trades = getLastNTrades(50);
  const wins = trades.filter(t => t.result === 'win');
  const losses = trades.filter(t => t.result === 'loss');
  const winRate = trades.length ? (wins.length / trades.length) * 100 : 0;
  const totalPnl = trades.reduce((a, t) => a + (t.pnlPercent ?? 0), 0);
  return `📊 <b>Статистика</b>
Сделок: ${trades.length} | ✅ ${wins.length} | ❌ ${losses.length}
Winrate: <b>${winRate.toFixed(1)}%</b>
PnL: <b>${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}%</b>`;
}

function buildPositionsMessage(): string {
  const trades = getOpenTrades();
  if (!trades.length) return '📭 Нет открытых позиций.';
  return `📂 <b>Открытые позиции</b>
${trades.map(t => `• #${t.id} ${t.symbol} ${t.direction} @ ${t.entryPrice}`).join('\n')}`;
}

function buildWinrateMessage(): string {
  const rows = getWinrateBySymbol();
  const text = rows.length ? rows.map(r => `${r.symbol.replace('-USDT-SWAP', '')} — ${r.winrate.toFixed(0)}% | ${r.trades} trades | ${r.pnlPercent >= 0 ? '+' : ''}${r.pnlPercent.toFixed(1)}%`).join('\n') : 'нет данных';
  return `📊 <b>Winrate по монетам</b>

${text}`;
}

// ─── Outbound helpers ─────────────────────────────────────────────────────────

async function send(chatId: string, text: string): Promise<void> {
  try {
    await bot.sendMessage(chatId, text, { parse_mode: 'HTML', disable_web_page_preview: true });
  } catch (err: any) {
    logger.error(`Failed to send Telegram message: ${err.message}`);
    if (chatId === config.telegram.chatId && config.telegram.adminId) {
      await bot.sendMessage(config.telegram.adminId, `⚠️ Channel delivery failed: ${err.message}`);
    }
  }
}

export async function broadcastSignal(signal: Signal): Promise<void> {
  await send(config.telegram.chatId, formatSignalMessage(signal));
}

export async function broadcastTradeOpened(trade: Trade, signal: Signal): Promise<void> {
  await send(config.telegram.chatId, formatTradeOpenedMessage(trade, signal));
}

export async function broadcastTradeClosed(trade: Trade, improvements?: string[]): Promise<void> {
  await send(config.telegram.chatId, formatTradeClosedMessage(trade, improvements));
}

export async function broadcastTpHit(trade: Trade, level: number, price: number): Promise<void> {
  const text = await buildTpMessage(trade, level, price);
  await send(config.telegram.chatId, text);
}

export async function sendErrorAlert(error: string, context?: string): Promise<void> {
  const target = config.telegram.adminId || config.telegram.chatId;
  await send(target, formatErrorAlert(error, context));
}

export async function sendAdminMessage(text: string): Promise<void> {
  if (!config.telegram.adminId) return;
  await send(config.telegram.adminId, text);
}

export async function broadcastMessage(text: string): Promise<void> {
  await send(config.telegram.chatId, text);
}
