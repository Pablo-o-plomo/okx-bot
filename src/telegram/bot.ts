import TelegramBot from 'node-telegram-bot-api';
import { config } from '../config';
import { logger } from '../utils/logger';
import {
  formatSignalMessage,
  formatTradeClosedMessage,
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
} from '../database/db';
import { getAccountBalance } from '../okx/trading';
import { pauseBot, resumeBot } from '../strategy/riskManager';
import { generateDailyReport } from '../reports/dailyReport';
import { generateLearningReport } from '../reports/learningReport';
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
  if (ADMIN_IDS.length === 0) return true; // No admin list = any user
  return ADMIN_IDS.includes(chatId);
}

function registerCommands(): void {
  // /start
  bot.onText(/\/start/, async (msg) => {
    const state = getBotState();
    const openTrades = getOpenTrades();
    const balance = await getAccountBalance();
    await send(msg.chat.id.toString(), formatStatusMessage(
      state.mode, state.isPaused, openTrades.length, balance, state.consecutiveLosses,
    ));
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
      const report = generateLearningReport(20);
      if (report) {
        await send(msg.chat.id.toString(), formatLearningReport(report));
      } else {
        await send(msg.chat.id.toString(), '📭 Недостаточно данных для анализа (нужно минимум 10 сделок).');
      }
    } catch (err: any) {
      await send(msg.chat.id.toString(), `Ошибка: ${err.message}`);
    }
  });

  // Handle polling errors gracefully
  bot.on('polling_error', (err) => {
    logger.error(`Telegram polling error: ${err.message}`);
  });
}

// ─── Outbound helpers ─────────────────────────────────────────────────────────

async function send(chatId: string, text: string): Promise<void> {
  try {
    await bot.sendMessage(chatId, text, { parse_mode: 'HTML', disable_web_page_preview: true });
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

export async function broadcastTpHit(trade: Trade, level: number, price: number): Promise<void> {
  const text = await buildTpMessage(trade, level, price);
  await send(config.telegram.chatId, text);
}

export async function sendErrorAlert(error: string, context?: string): Promise<void> {
  const target = config.telegram.adminId || config.telegram.chatId;
  await send(target, formatErrorAlert(error, context));
}

export async function broadcastMessage(text: string): Promise<void> {
  await send(config.telegram.chatId, text);
}
