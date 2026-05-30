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
import { handleAdminCallback, sendAdminMenu, setAdminCommandHandler } from './adminMenu';
import type { Signal, Trade } from '../database/models';

let bot: TelegramBot;
const ADMIN_IDS = config.telegram.adminId
  ? config.telegram.adminId.split(',').map(id => id.trim()).filter(Boolean)
  : [];

export function initTelegramBot(): TelegramBot {
  bot = new TelegramBot(config.telegram.botToken, { polling: true });

  setAdminCommandHandler(handleAdminCommand);
  registerCommands();
  logger.info('🤖 Telegram bot started');

  return bot;
}

export function getBot(): TelegramBot {
  if (!bot) throw new Error('Telegram bot not initialized');
  return bot;
}

function isAdmin(chatId: string | number): boolean {
  if (ADMIN_IDS.length === 0) return false;
  return ADMIN_IDS.includes(String(chatId).trim());
}

async function denyIfNotAdmin(chatId: string): Promise<boolean> {
  if (isAdmin(chatId)) return false;
  await send(chatId, '⛔ Access denied');
  return true;
}

function registerAdminTextCommand(command: RegExp, action: string): void {
  bot.onText(command, async (msg) => {
    const chatId = msg.chat.id.toString();
    if (await denyIfNotAdmin(chatId)) return;
    await handleAdminCommand(chatId, action);
  });
}

function registerCommands(): void {
  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id.toString();
    if (await denyIfNotAdmin(chatId)) return;
    await sendAdminMenu(bot, chatId);
  });

  bot.onText(/\/balance/, async (msg) => {
    const chatId = msg.chat.id.toString();
    if (await denyIfNotAdmin(chatId)) return;
    const balance = await getAccountBalance();
    const state = getBotState();
    await send(chatId, `💰 <b>Баланс:</b> ${balance.toFixed(2)} USDT\nРежим: ${state.mode.toUpperCase()}`);
  });

  bot.onText(/\/signals/, async (msg) => {
    const chatId = msg.chat.id.toString();
    if (await denyIfNotAdmin(chatId)) return;
    const signals = getRecentSignals(5);
    if (signals.length === 0) {
      await send(chatId, '📭 Нет сигналов в базе.');
      return;
    }
    const text = signals.map(s =>
      `• ${s.symbol} ${s.direction} @ ${s.entryPrice} | Уверенность: ${s.confidence}/10 | ${s.status} | ${s.createdAt?.split('T')[0]}`
    ).join('\n');
    await send(chatId, `📋 <b>Последние сигналы:</b>\n${text}`);
  });

  bot.onText(/\/errors/, async (msg) => {
    const chatId = msg.chat.id.toString();
    if (await denyIfNotAdmin(chatId)) return;
    const trades = getLastNTrades(20).filter(t => t.result === 'loss');
    if (trades.length === 0) {
      await send(chatId, '✅ Убыточных сделок нет.');
      return;
    }
    const tagCounts: Record<string, number> = {};
    for (const t of trades) {
      for (const tag of t.errorTags ?? []) tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;
    }
    const text = Object.entries(tagCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([tag, count]) => `• #${tag}: ${count}x`)
      .join('\n');
    await send(chatId, `⚠️ <b>Частые ошибки (последние 20 сделок):</b>\n${text}`);
  });

  registerAdminTextCommand(/\/stats/, '/stats');
  registerAdminTextCommand(/\/positions/, '/positions');
  registerAdminTextCommand(/\/winrate/, '/winrate');
  registerAdminTextCommand(/\/analyze/, '/analyze');
  registerAdminTextCommand(/\/report/, '/report');
  registerAdminTextCommand(/\/rejects/, '/rejects');
  registerAdminTextCommand(/\/market/, '/market');
  registerAdminTextCommand(/\/pause/, '/pause');
  registerAdminTextCommand(/\/resume/, '/resume');
  registerAdminTextCommand(/\/mode/, '/mode');
  registerAdminTextCommand(/\/risk/, '/risk');
  registerAdminTextCommand(/\/health/, '/health');
  registerAdminTextCommand(/\/filters/, '/filters');

  bot.on('callback_query', async (query) => {
    await handleAdminCallback(bot, query);
  });

  bot.on('polling_error', (err) => {
    logger.error(`Telegram polling error: ${err.message}`);
  });
}

async function handleAdminCommand(chatId: string, command: string): Promise<void> {
  if (command === '/stats') return handleStats(chatId);
  if (command === '/positions') return handlePositions(chatId);
  if (command === '/winrate') return handleWinrate(chatId);
  if (command === '/analyze') return handleAnalyze(chatId);
  if (command === '/report') return handleReport(chatId);
  if (command === '/rejects') return handleRejects(chatId);
  if (command === '/market') return handleMarket(chatId);
  if (command === '/pause') return handlePause(chatId);
  if (command === '/resume') return handleResume(chatId);
  if (command === '/mode') return handleMode(chatId);
  if (command === '/risk') return handleRisk(chatId);
  if (command === '/health') return handleHealth(chatId);
  if (command === '/filters') return handleFilters(chatId);
  return send(chatId, 'Раздел в разработке');
}

async function handleStats(chatId: string): Promise<void> {
  await send(chatId, buildStatsMessage());
}

async function handlePositions(chatId: string): Promise<void> {
  await send(chatId, buildPositionsMessage());
}

async function handleWinrate(chatId: string): Promise<void> {
  await send(chatId, buildWinrateMessage());
}

async function handleAnalyze(chatId: string): Promise<void> {
  const ml = generateErrorAnalysis();
  const report = generateLearningReport(20);
  await send(chatId, [ml, report ? formatLearningReport(report) : undefined].filter(Boolean).join('\n\n') || '📭 Недостаточно данных для анализа.');
}

async function handleReport(chatId: string): Promise<void> {
  await send(chatId, await generateDailyReport());
}

async function handleRejects(chatId: string): Promise<void> {
  await send(chatId, generateRejectStats());
}

async function handleMarket(chatId: string): Promise<void> {
  await send(chatId, generateMarketSummary());
}

async function handlePause(chatId: string): Promise<void> {
  pauseBot('Ручная остановка через admin panel');
  await send(chatId, '⛔ Торговля остановлена вручную.');
}

async function handleResume(chatId: string): Promise<void> {
  resumeBot();
  await send(chatId, '▶️ Торговля возобновлена.');
}

async function handleMode(chatId: string): Promise<void> {
  const state = getBotState();
  await send(chatId, `⚙️ <b>Текущий режим:</b> ${state.mode.toUpperCase()}
LIVE_TRADING: ${config.trading.isLive ? '🟢 включен' : '🔴 выключен'}
QUALITY_MODE: ${config.trading.qualityMode}`);
}

async function handleRisk(chatId: string): Promise<void> {
  const state = getBotState();
  await send(chatId, `🛡 <b>Риски</b>
Риск: ${config.trading.riskPerTrade}%
Дневной лимит: ${config.trading.maxDailyLoss}%
Открытых максимум: ${config.trading.maxOpenPositions}
Убытков подряд: ${state.consecutiveLosses}`);
}

async function handleHealth(chatId: string): Promise<void> {
  await send(chatId, generateHeartbeatReport());
}

async function handleFilters(chatId: string): Promise<void> {
  await send(chatId, `🧰 <b>Filters</b>
MIN_ATR_PERCENT=${config.trading.minAtrPercent}
MAX_ATR_PERCENT=${config.trading.maxAtrPercent}
MIN_SIGNAL_CONFIDENCE=${config.trading.minSignalConfidence}
MIN_VOLUME_MULTIPLIER=${config.trading.minVolumeMultiplier}
QUALITY_MODE=${config.trading.qualityMode}`);
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
