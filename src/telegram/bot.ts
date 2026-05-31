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
  getTradeById,
} from '../database/db';
import { getAccountBalance } from '../okx/trading';
import { pauseBot, resumeBot } from '../strategy/riskManager';
import { generateDailyReport } from '../reports/dailyReport';
import { generateLearningReport } from '../reports/learningReport';
import { generateMarketSummary } from '../reports/marketSummary';
import { generateErrorAnalysis } from '../reports/errorAnalysis';
import { generateRejectStats } from '../reports/rejectStats';
import { generateHeartbeatReport } from '../reports/heartbeat';
import { getAdminKeyboard, handleAdminCallback, setAdminCommandHandler } from './adminMenu';
import { formatDirection, formatPercent, formatPrice } from '../utils/formatPrice';
import { BUILD_VERSION } from '../version';
import type { Signal, Trade } from '../database/models';

let bot: TelegramBot;
const ADMIN_IDS = config.telegram.adminId
  ? config.telegram.adminId.split(',')
    .map(id => Number(id.trim()))
    .filter(id => Number.isFinite(id))
  : [];

export function initTelegramBot(): TelegramBot {
  console.log('FORCED BUILD 2026-05-31-13-45');
  bot = new TelegramBot(config.telegram.botToken, { polling: true });

  setAdminCommandHandler(handleAdminCommand);
  registerCommands();
  logger.info('🤖 Telegram bot started');
  logger.info("🔥 TELEGRAM BUILD: buttons-v6-2026-05-31-14-45");
  logger.info(`BUILD VERSION: ${BUILD_VERSION}`);

  return bot;
}

export function getBot(): TelegramBot {
  if (!bot) throw new Error('Telegram bot not initialized');
  return bot;
}

function isAdmin(id: string | number | undefined): boolean {
  if (id === undefined || ADMIN_IDS.length === 0) return false;
  const numericId = Number(id);
  return Number.isFinite(numericId) && ADMIN_IDS.includes(numericId);
}

function isAdminMessage(chatId: string | number, fromId?: string | number): boolean {
  return isAdmin(chatId) || isAdmin(fromId);
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
  bot.onText(/^\/start(?:@\w+)?(?:\s|$)/, async (msg) => {
    await handleStart(msg.chat.id.toString(), msg.from?.id.toString());
  });

  bot.onText(/\/menu/, async (msg) => {
    await handleStart(msg.chat.id.toString(), msg.from?.id.toString());
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
      `• ${s.symbol} ${s.direction} @ ${formatPrice(s.symbol, s.entryPrice)} | SL ${formatPrice(s.symbol, s.stopLoss)} | TP1 ${formatPrice(s.symbol, s.takeProfit1)} | Уверенность: ${s.confidence}/10 | ${s.status} | ${s.createdAt?.split('T')[0]}`
    ).join('\n');
    await send(chatId, `📋 <b>Последние сигналы:</b>\n${text}`);
  });

  bot.onText(/\/trade(?:\s+(\d+))?/, async (msg, match) => {
    const chatId = msg.chat.id.toString();
    if (await denyIfNotAdmin(chatId)) return;
    const tradeId = match?.[1] ? Number(match[1]) : undefined;
    if (!tradeId) {
      await send(chatId, 'Укажите ID сделки: /trade 123');
      return;
    }
    await handleTrade(chatId, tradeId);
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
  registerAdminTextCommand(/\/closed/, '/closed');
  registerAdminTextCommand(/\/scan/, '/scan');
  registerAdminTextCommand(/\/logs/, '/logs');
  registerAdminTextCommand(/\/version/, '/version');

  bot.on('callback_query', async (query) => {
    logger.info(`CALLBACK: ${query.data ?? 'empty'} from=${query.from.id}`);
    try {
      await handleAdminCallback(bot, query);
    } catch (err: any) {
      logger.error(`Callback handler error: ${err.message}`);
      await bot.answerCallbackQuery(query.id, { text: 'Callback handler error' }).catch(() => undefined);
      const adminTarget = config.telegram.adminId;
      if (adminTarget) {
        await bot.sendMessage(adminTarget, 'Callback handler error').catch(() => undefined);
      }
    }
  });

  bot.on('polling_error', (err) => {
    logger.error(`Telegram polling error: ${err.message}`);
  });
}


function qualityModeLabel(mode: string): string {
  if (mode === 'high') return 'строгий';
  if (mode === 'normal') return 'обычный';
  if (mode === 'low') return 'мягкий';
  return mode;
}

function tradeStatusLabel(status?: string): string {
  const labels: Record<string, string> = {
    open: 'открыта',
    tp1_hit: 'TP1 достигнут',
    tp2_hit: 'TP2 достигнут',
    tp3_hit: 'TP3 достигнут',
    breakeven: 'безубыток',
    partially_closed: 'частично закрыта',
    closed_win: 'закрыта в плюс',
    closed_loss: 'закрыта в минус',
    closed_breakeven: 'закрыта в безубыток',
    cancelled: 'отменена',
    closed_tp1: 'закрыта на TP1',
    closed_tp2: 'закрыта на TP2',
    closed_tp3: 'закрыта на TP3',
    closed_sl: 'закрыта по стопу',
    closed_manual: 'закрыта вручную',
  };
  return status ? labels[status] ?? status : 'нет данных';
}

async function handleStart(chatId: string, fromId?: string): Promise<void> {
  logger.info(`START: chat=${chatId}, from=${fromId ?? 'unknown'}, admin=${config.telegram.adminId}`);

  if (isAdminMessage(chatId, fromId)) {
    await bot.sendMessage(chatId, `🤖 Панель управления OKX Bot
Сборка: ${BUILD_VERSION}`, {
      reply_markup: getAdminKeyboard(),
    });
    return;
  }

  await bot.sendMessage(chatId, 'Бот работает. Панель управления доступна только администратору.');
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
  if (command === '/closed') return handleClosed(chatId);
  if (command === '/scan') return handleScan(chatId);
  if (command === '/logs') return handleLogs(chatId);
  if (command === '/version') return handleVersion(chatId);
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
  pauseBot('Ручная остановка через панель администратора');
  await send(chatId, '⛔ Торговля остановлена вручную.');
}

async function handleResume(chatId: string): Promise<void> {
  resumeBot();
  await send(chatId, '▶️ Торговля возобновлена.');
}

async function handleMode(chatId: string): Promise<void> {
  const state = getBotState();
  await send(chatId, `⚙️ <b>Текущий режим:</b> ${state.mode.toUpperCase()}
Реальная торговля: ${config.trading.isLive ? '🟢 включена' : '🔴 выключена'}
Режим качества: ${qualityModeLabel(config.trading.qualityMode)}`);
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
  await send(chatId, `🟢 Бот онлайн\nСборка: ${BUILD_VERSION}\n\n${generateHeartbeatReport()}`);
}

async function handleFilters(chatId: string): Promise<void> {
  await send(chatId, `🧰 <b>Фильтры</b>
Мин. ATR % = ${config.trading.minAtrPercent}
Макс. ATR % = ${config.trading.maxAtrPercent}
Мин. уверенность = ${config.trading.minSignalConfidence}
Мин. объем = ${config.trading.minVolumeMultiplier}
Режим качества = ${qualityModeLabel(config.trading.qualityMode)}`);
}

async function handleClosed(chatId: string): Promise<void> {
  const trades = getLastNTrades(10);
  if (!trades.length) {
    await send(chatId, '📭 Закрытых сделок пока нет.');
    return;
  }
  const text = trades.map(t => {
    const pnl = resolveTradePnlPercent(t);
    return `• #${t.id} ${t.symbol} ${formatDirection(t.direction)} ${formatPercent(pnl)} | ${tradeStatusLabel(t.status)}`;
  }).join('\n');
  await send(chatId, `📜 <b>Последние сделки</b>
${text}`);
}

async function handleScan(chatId: string): Promise<void> {
  await send(chatId, '📡 Сканирование: раздел в разработке. Планировщик продолжает сканировать рынок автоматически.');
}

async function handleLogs(chatId: string): Promise<void> {
  await send(chatId, '🧾 Логи: раздел в разработке. Смотрите логи Railway для диагностики запуска.');
}

async function handleVersion(chatId: string): Promise<void> {
  await send(chatId, 'buttons-v6-2026-05-31-14-45');
}

async function handleTrade(chatId: string, tradeId: number): Promise<void> {
  const trade = getTradeById(tradeId);
  if (!trade) {
    await send(chatId, `Сделка #${tradeId} не найдена.`);
    return;
  }
  await send(chatId, buildTradeMessage(trade));
}

function resolveTradePnlPercent(trade: Trade): number {
  if (trade.pnlPercent !== undefined && Number.isFinite(trade.pnlPercent)) return trade.pnlPercent;
  if (trade.finalPnl !== undefined && Number.isFinite(trade.finalPnl)) return trade.finalPnl;
  if (trade.currentPnl !== undefined && Number.isFinite(trade.currentPnl)) return trade.currentPnl;
  if (trade.exitPrice && trade.entryPrice) {
    const raw = trade.direction === 'LONG'
      ? ((trade.exitPrice - trade.entryPrice) / trade.entryPrice) * 100
      : ((trade.entryPrice - trade.exitPrice) / trade.entryPrice) * 100;
    return raw * trade.leverage;
  }
  return 0;
}

function resolveTradePnlUsdt(trade: Trade, pnlPercent: number): number {
  if (trade.pnlUsdt !== undefined && Number.isFinite(trade.pnlUsdt)) return trade.pnlUsdt;
  if (trade.positionSize && trade.entryPrice && trade.exitPrice) {
    const rawMove = trade.direction === 'LONG'
      ? trade.exitPrice - trade.entryPrice
      : trade.entryPrice - trade.exitPrice;
    return rawMove * trade.positionSize * trade.leverage;
  }
  if (trade.positionSize && trade.entryPrice) return (pnlPercent / 100) * trade.positionSize * trade.entryPrice;
  return (1000 * pnlPercent) / 100;
}

function buildTradeMessage(trade: Trade): string {
  const pnl = resolveTradePnlPercent(trade);
  const pnlUsdt = resolveTradePnlUsdt(trade, pnl);
  return `🧾 <b>Сделка #${trade.id}</b>

${trade.symbol} ${formatDirection(trade.direction)}
Статус: <b>${tradeStatusLabel(trade.status)}</b>

Вход: <b>${formatPrice(trade.symbol, trade.entryPrice)}</b>
Стоп: <b>${formatPrice(trade.symbol, trade.stopLoss)}</b>
TP1: <b>${formatPrice(trade.symbol, trade.takeProfit1)}</b>
TP2: <b>${formatPrice(trade.symbol, trade.takeProfit2)}</b>
TP3: <b>${formatPrice(trade.symbol, trade.takeProfit3)}</b>
${trade.exitPrice ? `Выход: <b>${formatPrice(trade.symbol, trade.exitPrice)}</b>\n` : ''}
Результат: <b>${formatPercent(pnl)} | ${pnlUsdt >= 0 ? '+' : ''}${pnlUsdt.toFixed(2)} USDT</b>`;
}

function buildStatsMessage(): string {
  const trades = getLastNTrades(50);
  const wins = trades.filter(t => t.result === 'win');
  const losses = trades.filter(t => t.result === 'loss');
  const winRate = trades.length ? (wins.length / trades.length) * 100 : 0;
  const totalPnl = trades.reduce((a, t) => a + (t.pnlPercent ?? 0), 0);
  return `📊 <b>Статистика</b>
Сделок: ${trades.length} | ✅ ${wins.length} | ❌ ${losses.length}
Винрейт: <b>${winRate.toFixed(1)}%</b>
Результат: <b>${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}%</b>`;
}

function buildPositionsMessage(): string {
  const trades = getOpenTrades();
  if (!trades.length) return '📭 Нет открытых позиций.';
  return `📂 <b>Открытые позиции</b>
${trades.map(t => `• #${t.id} ${t.symbol} ${formatDirection(t.direction)} @ ${formatPrice(t.symbol, t.entryPrice)} | Стоп: ${formatPrice(t.symbol, t.stopLoss)} | TP1: ${formatPrice(t.symbol, t.takeProfit1)} | TP2: ${formatPrice(t.symbol, t.takeProfit2)} | TP3: ${formatPrice(t.symbol, t.takeProfit3)}`).join('\n')}`;
}

function buildWinrateMessage(): string {
  const rows = getWinrateBySymbol();
  if (!rows.length) return 'Недостаточно данных для расчета винрейта.';

  const text = rows
    .map(row => `${row.symbol.replace('-USDT-SWAP', '')} — ${row.winrate.toFixed(0)}% | ${row.trades} сделок | ${row.pnlPercent >= 0 ? '+' : ''}${row.pnlPercent.toFixed(1)}%`)
    .join('\n');

  return `📊 <b>Винрейт по монетам</b>

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
