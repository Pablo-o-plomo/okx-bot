import TelegramBot from 'node-telegram-bot-api';
import { config } from '../config';
import { initBcsDb, ensureUser, getSettings, saveBcsTrade, getOpenBcsTrades, getClosedBcsTrades, getTodayBcsTrades, getMonthBcsTrades, closeBcsTrade, saveAiReview, type BcsInstrumentType, type BcsTradeDirection, type BcsTradeInput } from '../bcs/db';
import { calculateBcsCommission, formatBcsCommissionSettings } from '../bcs/commission';
import { analyzeInstrument, reviewTrade } from '../bcs/analysis';
import { calculateBcsRisk, formatRub } from '../bcs/risk';
import { formatDailyBcsReport, formatDiary, formatMonthlyBcsReport, formatPortfolio } from '../bcs/reports';
import { formatMarketScanner, formatMarketSentiment, marketSentiment, scanMarket } from '../bcs/marketScanner';
import { aiDashboardCardUrl, equityCurveUrl, marketHeatmapUrl, miniCandlesUrl, pnlChartUrl } from './charts';
import { logger } from '../utils/logger';
import { BUILD_VERSION } from '../version';
import type { Signal, Trade } from '../database/models';
import { formatSignalMessage, formatTradeClosedMessage, formatTradeOpenedMessage, sendTradeUpdate as buildTpMessage, formatErrorAlert } from './messages';

let bot: TelegramBot;
const adminIds = config.telegram.adminId
  ? config.telegram.adminId.split(',').map(id => Number(id.trim())).filter(Number.isFinite)
  : [];

type AddTradeDraft = Partial<BcsTradeInput> & { step: AddTradeStep };
type AddTradeStep = 'ticker' | 'type' | 'direction' | 'entryPrice' | 'quantity' | 'stopLoss' | 'takeProfit' | 'commission' | 'comment';
const addTradeDrafts = new Map<number, AddTradeDraft>();

const instrumentTypeLabels: Record<BcsInstrumentType, string> = {
  stock: 'Акция РФ',
  future: 'Фьючерс MOEX',
  currency: 'Валюта',
  bond: 'Облигация',
  fund: 'Фонд',
  option: 'Опцион',
};

export function initTelegramBot(): TelegramBot {
  initBcsDb();
  bot = new TelegramBot(config.telegram.botToken, { polling: true });
  registerCommands();
  logger.info('🤖 BCS Trading Assistant started');
  logger.info(`BUILD VERSION: ${BUILD_VERSION}`);
  return bot;
}

export function getBot(): TelegramBot {
  if (!bot) throw new Error('Telegram bot not initialized');
  return bot;
}

function isAdmin(id: string | number | undefined): boolean {
  if (id === undefined || adminIds.length === 0) return false;
  return adminIds.includes(Number(id));
}

function isAdminMessage(chatId: string | number, fromId?: string | number): boolean {
  return isAdmin(chatId) || isAdmin(fromId);
}

function mainKeyboard(): TelegramBot.InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: '💼 Портфель', callback_data: 'portfolio' }, { text: '📡 Рынок', callback_data: 'market' }],
      [{ text: '🧠 AI Анализ', callback_data: 'ai_review' }, { text: '⚠️ Риск', callback_data: 'risk' }],
      [{ text: '📋 Отчеты', callback_data: 'reports' }, { text: '⚙️ Настройки', callback_data: 'settings' }],
    ],
  };
}

async function send(chatId: string | number, text: string, options: TelegramBot.SendMessageOptions = {}): Promise<void> {
  try {
    await getBot().sendMessage(chatId, text, { parse_mode: 'HTML', disable_web_page_preview: true, ...options });
  } catch (err: any) {
    logger.error(`Telegram send failed: ${err.message}`);
  }
}

async function sendPhoto(chatId: string | number, photoUrl: string, caption?: string): Promise<void> {
  try {
    await getBot().sendPhoto(chatId, photoUrl, { caption, parse_mode: 'HTML' });
  } catch (err: any) {
    logger.error(`Telegram photo send failed: ${err.message}`);
  }
}

async function handleStart(chatId: number, fromId?: number): Promise<void> {
  logger.info(`START: chat=${chatId}, from=${fromId}, admin=${config.telegram.adminId}`);
  if (!isAdminMessage(chatId, fromId)) {
    await send(chatId, 'Бот работает. Панель управления доступна только администратору.');
    return;
  }
  ensureUser(fromId ?? chatId);
  await send(chatId, `🖥 <b>BCS ASSISTANT TERMINAL</b>

⚡ AI desk online
🧠 Build: <code>${BUILD_VERSION}</code>

Выберите модуль:`, { reply_markup: mainKeyboard() });
}

async function handleMenu(chatId: number, fromId?: number): Promise<void> {
  await handleStart(chatId, fromId ?? chatId);
}

async function handlePortfolio(chatId: number): Promise<void> {
  const settings = getSettings(chatId);
  const openTrades = getOpenBcsTrades(chatId);
  const closedTrades = getClosedBcsTrades(chatId);
  await send(chatId, formatPortfolio(openTrades, closedTrades, settings.depositRub));
  await sendPhoto(chatId, equityCurveUrl(closedTrades, settings.depositRub), '📈 <b>Equity curve</b>');
  await sendPhoto(chatId, pnlChartUrl(closedTrades), '💹 <b>P&L chart</b>');
}

async function handleMarketScanner(chatId: number): Promise<void> {
  const items = scanMarket();
  const sentiment = marketSentiment(items);
  await send(chatId, formatMarketScanner(items, sentiment), {
    reply_markup: { inline_keyboard: [[{ text: '📡 Сканер рынка', callback_data: 'market' }, { text: '📝 Добавить сделку', callback_data: 'add_trade' }]] },
  });
  await sendPhoto(chatId, marketHeatmapUrl(items.map(item => ({ symbol: item.symbol, score: item.confidence, trend: item.trend }))), '🔥 <b>Market heatmap</b>');
  await sendPhoto(chatId, aiDashboardCardUrl({ imoexGrowthProbability: sentiment.imoexGrowthProbability, confidence: sentiment.confidence, risk: sentiment.risk, volatility: sentiment.volatility }), '🧠 <b>AI dashboard card</b>');
  const top = items[0];
  if (top) await sendPhoto(chatId, miniCandlesUrl(top.symbol, top.trend), `🕯 <b>${top.symbol} mini candles</b>`);
}

async function handleDiary(chatId: number): Promise<void> {
  await send(chatId, formatDiary(getOpenBcsTrades(chatId), getClosedBcsTrades(chatId)));
}

async function handleDailyReport(chatId: number): Promise<void> {
  const settings = getSettings(chatId);
  await send(chatId, formatDailyBcsReport(getTodayBcsTrades(chatId), settings.depositRub));
}

async function handleMonthlyReport(chatId: number): Promise<void> {
  await send(chatId, formatMonthlyBcsReport(getMonthBcsTrades(chatId)));
}

async function handleRisk(chatId: number): Promise<void> {
  const settings = getSettings(chatId);
  await send(chatId, `⚠️ <b>RISK DESK</b>

🟢 Deposit: <b>${settings.depositRub.toLocaleString('ru-RU')} ₽</b>
🛡 Risk/trade: <b>${settings.riskPerTrade.toFixed(2)}%</b>
📐 Target R/R: <b>1:2+</b>
💸 Fees: included before entry

🧠 AI: не увеличивать позицию после входа, стоп обязателен, серия убытков → снижение размера.`);
}

async function handleFees(chatId: number): Promise<void> {
  await send(chatId, formatBcsCommissionSettings());
}

async function handleSettings(chatId: number): Promise<void> {
  const settings = getSettings(chatId);
  await send(chatId, `⚙️ <b>SETTINGS</b>

🏦 Broker: <b>${config.app.broker}</b>
💼 Deposit: <b>${settings.depositRub.toLocaleString('ru-RU')} ₽</b>
🛡 Risk/trade: <b>${settings.riskPerTrade.toFixed(2)}%</b>
📡 Symbols: <b>${config.trading.symbols.join(', ')}</b>
🤖 Auto trading: <b>OFF</b>

Manual trading architecture готова: подтверждения доступны в сигналах, реальные ордера не отправляются.`, {
    reply_markup: { inline_keyboard: [[{ text: '📝 Добавить сделку', callback_data: 'add_trade' }, { text: '💸 Комиссии', callback_data: 'fees' }]] },
  });
}

async function handleAnalyzePrompt(chatId: number): Promise<void> {
  await send(chatId, `${formatMarketSentiment()}

🔎 Тикер: <code>/analyze SBER</code>`, {
    reply_markup: { inline_keyboard: [[{ text: '📡 Сканер рынка', callback_data: 'market' }]] },
  });
}

async function handleAiPrompt(chatId: number): Promise<void> {
  await send(chatId, `🧠 <b>AI ANALYSIS HUB</b>

📡 Market scanner: /market
🔎 Инструмент: <code>/analyze SBER</code>
🧾 Сделка: <code>/review SBER stock LONG 250 10 240 275 10 комментарий</code>`, {
    reply_markup: { inline_keyboard: [[{ text: '📡 Сканер рынка', callback_data: 'market' }, { text: '📝 Добавить сделку', callback_data: 'add_trade' }]] },
  });
}

function parseNumber(value: string): number | undefined {
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isInstrumentType(value: string): value is BcsInstrumentType {
  return ['stock', 'future', 'currency', 'bond', 'fund', 'option'].includes(value);
}

function isDirection(value: string): value is BcsTradeDirection {
  return value === 'LONG' || value === 'SHORT';
}

async function startAddTrade(chatId: number): Promise<void> {
  addTradeDrafts.set(chatId, { step: 'ticker', userId: chatId });
  await send(chatId, '📝 <b>Добавление сделки</b>\n\nВведите тикер, например SBER, GAZP, Si, BR:');
}

async function handleAddTradeText(chatId: number, text: string): Promise<boolean> {
  const draft = addTradeDrafts.get(chatId);
  if (!draft) return false;

  if (draft.step === 'ticker') {
    draft.ticker = text.trim().toUpperCase();
    draft.step = 'type';
    await send(chatId, 'Выберите тип инструмента:', {
      reply_markup: { inline_keyboard: [
        [{ text: 'Акция РФ', callback_data: 'type_stock' }, { text: 'Фьючерс MOEX', callback_data: 'type_future' }],
        [{ text: 'Валюта', callback_data: 'type_currency' }, { text: 'Облигация', callback_data: 'type_bond' }],
        [{ text: 'Фонд', callback_data: 'type_fund' }, { text: 'Опцион', callback_data: 'type_option' }],
      ] },
    });
    return true;
  }

  if (draft.step === 'entryPrice' || draft.step === 'quantity' || draft.step === 'stopLoss' || draft.step === 'takeProfit' || draft.step === 'commission') {
    const value = parseNumber(text);
    if (value === undefined) {
      await send(chatId, 'Введите число. Например: 250.50');
      return true;
    }
    if (draft.step === 'entryPrice') {
      draft.entryPrice = value;
      draft.step = 'quantity';
      await send(chatId, 'Введите количество:');
    } else if (draft.step === 'quantity') {
      draft.quantity = value;
      draft.step = 'stopLoss';
      await send(chatId, 'Введите стоп-лосс:');
    } else if (draft.step === 'stopLoss') {
      draft.stopLoss = value;
      draft.step = 'takeProfit';
      await send(chatId, 'Введите тейк-профит:');
    } else if (draft.step === 'takeProfit') {
      draft.takeProfit = value;
      const turnover = (draft.entryPrice ?? 0) * (draft.quantity ?? 0);
      const commission = calculateBcsCommission({ instrumentType: draft.instrumentType ?? 'stock', turnoverRub: turnover, quantity: draft.quantity ?? 1 });
      draft.commissionRub = commission.totalFeeRub;
      draft.step = 'commission';
      await send(chatId, `Расчетная комиссия: ${commission.totalFeeRub.toFixed(2)} ₽.\nВведите комиссию вручную или отправьте 0, чтобы оставить расчетную:`);
    } else {
      if (value > 0) draft.commissionRub = value;
      draft.step = 'comment';
      await send(chatId, 'Комментарий к сделке:');
    }
    return true;
  }

  if (draft.step === 'comment') {
    draft.comment = text.trim();
    const complete = draft as BcsTradeInput;
    const risk = calculateBcsRisk({
      depositRub: getSettings(chatId).depositRub,
      direction: complete.direction,
      instrumentType: complete.instrumentType,
      entryPrice: complete.entryPrice,
      quantity: complete.quantity,
      stopLoss: complete.stopLoss,
      takeProfit: complete.takeProfit,
      commissionRub: complete.commissionRub,
    });
    const tradeId = saveBcsTrade(complete);
    addTradeDrafts.delete(chatId);
    await send(chatId, `✅ <b>TRADE CARD #${tradeId}</b>

${risk.decision === 'allowed' ? '🟢' : '🔴'} <b>${complete.ticker} ${complete.direction}</b>
💼 Size: <b>${risk.positionAmountRub.toFixed(0)} ₽</b>
⚠️ Risk: <b>${risk.riskRub.toFixed(0)} ₽</b> (${risk.riskPercent.toFixed(2)}%)
🎯 Potential: <b>${risk.potentialProfitRub.toFixed(0)} ₽</b>
📐 R/R: <b>1:${risk.riskReward.toFixed(2)}</b>
💸 Fee: <b>${risk.totalCommissionRub.toFixed(0)} ₽</b>

🧠 AI: ${risk.decision === 'allowed' ? 'сделка допустима для ручного подтверждения.' : 'лучше пропустить.'}
${risk.warnings.length ? `
🧯 ${risk.warnings.map(w => `• ${w}`).join('\n')}` : ''}

⚠️ Не является инвестиционной рекомендацией.`, {
      reply_markup: { inline_keyboard: [[{ text: '✅ Подтвердить сделку', callback_data: `manual_confirm_${tradeId}` }, { text: '❌ Отмена', callback_data: `manual_cancel_${tradeId}` }]] },
    });
    return true;
  }

  return true;
}

async function handleTypeSelection(chatId: number, type: BcsInstrumentType): Promise<void> {
  const draft = addTradeDrafts.get(chatId);
  if (!draft) {
    await send(chatId, 'Сначала нажмите “Добавить сделку”.');
    return;
  }
  draft.instrumentType = type;
  draft.step = 'direction';
  await send(chatId, `Тип: ${instrumentTypeLabels[type]}. Выберите направление:`, {
    reply_markup: { inline_keyboard: [[{ text: 'LONG', callback_data: 'dir_LONG' }, { text: 'SHORT', callback_data: 'dir_SHORT' }]] },
  });
}

async function handleDirectionSelection(chatId: number, direction: BcsTradeDirection): Promise<void> {
  const draft = addTradeDrafts.get(chatId);
  if (!draft) {
    await send(chatId, 'Сначала нажмите “Добавить сделку”.');
    return;
  }
  draft.direction = direction;
  draft.step = 'entryPrice';
  await send(chatId, 'Введите цену входа:');
}

async function handleCallback(query: TelegramBot.CallbackQuery): Promise<void> {
  const data = query.data ?? '';
  const fromId = query.from.id;
  logger.info(`CALLBACK: ${data} from=${fromId}`);
  if (!isAdmin(fromId)) {
    await bot.answerCallbackQuery(query.id, { text: 'Access denied' });
    return;
  }
  const chatId = query.message?.chat.id ?? fromId;
  try {
    if (data.startsWith('type_')) {
      const type = data.replace('type_', '');
      if (isInstrumentType(type)) await handleTypeSelection(chatId, type);
    } else if (data.startsWith('dir_')) {
      const direction = data.replace('dir_', '');
      if (isDirection(direction)) await handleDirectionSelection(chatId, direction);
    } else {
      await handleAction(chatId, data);
    }
    await bot.answerCallbackQuery(query.id, { text: 'OK' });
  } catch (err: any) {
    logger.error(`Callback handler error: ${err.message}`);
    await bot.answerCallbackQuery(query.id, { text: 'Callback handler error' });
    await send(chatId, 'Ошибка обработки кнопки. Попробуйте еще раз.');
  }
}

async function handleAction(chatId: number, action: string): Promise<void> {
  if (action.startsWith('manual_confirm_')) return send(chatId, `✅ Сделка #${action.replace('manual_confirm_', '')} подтверждена вручную. Реальные ордера отключены.`);
  if (action.startsWith('manual_cancel_')) return send(chatId, `❌ Сделка #${action.replace('manual_cancel_', '')} отменена. Ордера не отправлялись.`);
  if (action.startsWith('signal_confirm_')) return send(chatId, `✅ Сигнал #${action.replace('signal_confirm_', '')} подтвержден. Модуль реальных ордеров пока отключен.`);
  if (action.startsWith('signal_cancel_')) return send(chatId, `❌ Сигнал #${action.replace('signal_cancel_', '')} отменен.`);

  switch (action) {
    case 'portfolio': return handlePortfolio(chatId);
    case 'add_trade': return startAddTrade(chatId);
    case 'market':
    case 'market_scanner': return handleMarketScanner(chatId);
    case 'reports':
      await handleDailyReport(chatId);
      return handleMonthlyReport(chatId);
    case 'analyze_instrument': return handleAnalyzePrompt(chatId);
    case 'ai_review': return handleAiPrompt(chatId);
    case 'risk': return handleRisk(chatId);
    case 'fees': return handleFees(chatId);
    case 'diary': return handleDiary(chatId);
    case 'daily_report': return handleDailyReport(chatId);
    case 'monthly_report': return handleMonthlyReport(chatId);
    case 'settings': return handleSettings(chatId);
    case 'manual_confirm': return send(chatId, '✅ Сделка подтверждена вручную. Реальные ордера отключены.');
    case 'manual_cancel': return send(chatId, '❌ Сценарий отменен. Ордера не отправлялись.');
    default: return send(chatId, 'Раздел в разработке.');
  }
}

async function handleAnalyzeCommand(chatId: number, text: string): Promise<void> {
  const ticker = text.split(/\s+/)[1];
  if (!ticker) return handleAnalyzePrompt(chatId);
  await send(chatId, analyzeInstrument(ticker));
}

async function handleReviewCommand(chatId: number, text: string): Promise<void> {
  const [, ticker, type, direction, entry, qty, stop, take, commission, ...commentParts] = text.split(/\s+/);
  if (!ticker || !isInstrumentType(type) || !isDirection(direction)) {
    await handleAiPrompt(chatId);
    return;
  }
  const entryPrice = parseNumber(entry);
  const quantity = parseNumber(qty);
  const stopLoss = parseNumber(stop);
  const takeProfit = parseNumber(take);
  const commissionRub = parseNumber(commission) ?? 0;
  if ([entryPrice, quantity, stopLoss, takeProfit].some(v => v === undefined)) {
    await send(chatId, 'Не удалось прочитать числа. Формат: /review SBER stock LONG 250 10 240 275 10 комментарий');
    return;
  }
  const review = reviewTrade({
    ticker,
    instrumentType: type,
    direction,
    entryPrice: entryPrice!,
    quantity: quantity!,
    stopLoss: stopLoss!,
    takeProfit: takeProfit!,
    commissionRub,
    depositRub: getSettings(chatId).depositRub,
    comment: commentParts.join(' '),
  });
  saveAiReview(chatId, review);
  await send(chatId, review);
}

async function handleCloseCommand(chatId: number, text: string): Promise<void> {
  const [, idText, priceText, commissionText] = text.split(/\s+/);
  const tradeId = Number(idText);
  const exitPrice = parseNumber(priceText ?? '');
  const commission = parseNumber(commissionText ?? '0') ?? 0;
  if (!Number.isFinite(tradeId) || exitPrice === undefined) {
    await send(chatId, 'Формат: /close <id> <цена_выхода> <комиссия>');
    return;
  }
  const trade = closeBcsTrade(chatId, tradeId, exitPrice, commission);
  if (!trade) {
    await send(chatId, 'Сделка не найдена.');
    return;
  }
  await send(chatId, `${trade.pnlRub >= 0 ? '🟢' : '🔴'} <b>TRADE CLOSED #${trade.id}</b>

<b>${trade.ticker}</b> ${trade.direction}
💹 P&L: <b>${trade.pnlPercent >= 0 ? '+' : ''}${trade.pnlPercent.toFixed(2)}%</b> · ${formatRub(trade.pnlRub)}
💸 Fees included

⚠️ Не является инвестиционной рекомендацией.`);

}

function registerAdminCommand(regex: RegExp, handler: (chatId: number, text: string, fromId?: number) => Promise<void>): void {
  bot.onText(regex, async (msg) => {
    const chatId = msg.chat.id;
    const fromId = msg.from?.id;
    if (!isAdminMessage(chatId, fromId)) {
      await send(chatId, 'Бот работает. Панель управления доступна только администратору.');
      return;
    }
    ensureUser(fromId ?? chatId);
    await handler(chatId, msg.text ?? '', fromId);
  });
}

function registerCommands(): void {
  bot.onText(/^\/start(?:@\w+)?(?:\s|$)/, async (msg) => handleStart(msg.chat.id, msg.from?.id));
  registerAdminCommand(/^\/menu(?:@\w+)?(?:\s|$)/, async (chatId, _text, fromId) => handleMenu(chatId, fromId));
  registerAdminCommand(/^\/portfolio(?:@\w+)?(?:\s|$)/, async (chatId) => handlePortfolio(chatId));
  registerAdminCommand(/^\/add(?:@\w+)?(?:\s|$)/, async (chatId) => startAddTrade(chatId));
  registerAdminCommand(/^\/diary(?:@\w+)?(?:\s|$)/, async (chatId) => handleDiary(chatId));
  registerAdminCommand(/^\/daily(?:@\w+)?(?:\s|$)/, async (chatId) => handleDailyReport(chatId));
  registerAdminCommand(/^\/month(?:@\w+)?(?:\s|$)/, async (chatId) => handleMonthlyReport(chatId));
  registerAdminCommand(/^\/reports(?:@\w+)?(?:\s|$)/, async (chatId) => { await handleDailyReport(chatId); await handleMonthlyReport(chatId); });
  registerAdminCommand(/^\/fees(?:@\w+)?(?:\s|$)/, async (chatId) => handleFees(chatId));
  registerAdminCommand(/^\/risk(?:@\w+)?(?:\s|$)/, async (chatId) => handleRisk(chatId));
  registerAdminCommand(/^\/settings(?:@\w+)?(?:\s|$)/, async (chatId) => handleSettings(chatId));
  registerAdminCommand(/^\/(?:market|scan|scanner)(?:@\w+)?(?:\s|$)/, async (chatId) => handleMarketScanner(chatId));
  registerAdminCommand(/^\/analyze(?:@\w+)?(?:\s|$)/, async (chatId, text) => handleAnalyzeCommand(chatId, text));
  registerAdminCommand(/^\/review(?:@\w+)?(?:\s|$)/, async (chatId, text) => handleReviewCommand(chatId, text));
  registerAdminCommand(/^\/close(?:@\w+)?(?:\s|$)/, async (chatId, text) => handleCloseCommand(chatId, text));
  registerAdminCommand(/^\/version(?:@\w+)?(?:\s|$)/, async (chatId) => send(chatId, `🧠 Current build:\n${BUILD_VERSION}`));

  bot.on('callback_query', handleCallback);
  bot.on('message', async (msg) => {
    const text = msg.text ?? '';
    if (!text || text.startsWith('/')) return;
    const chatId = msg.chat.id;
    if (!isAdminMessage(chatId, msg.from?.id)) return;
    ensureUser(msg.from?.id ?? chatId);
    await handleAddTradeText(chatId, text);
  });
}

export async function sendAdminMessage(text: string): Promise<void> {
  if (!config.telegram.adminId) return;
  await send(config.telegram.adminId, text);
}

export async function broadcastMessage(text: string): Promise<void> {
  if (config.telegram.sendStartupToChannel && config.telegram.chatId) await send(config.telegram.chatId, text);
}

// Compatibility exports for archived trading modules. BCS version does not auto-trade.
export async function broadcastSignal(signal: Signal): Promise<void> {
  if (!config.telegram.adminId) return;
  await send(config.telegram.adminId, formatSignalMessage(signal), {
    reply_markup: { inline_keyboard: [[{ text: '✅ Подтвердить сделку', callback_data: `signal_confirm_${signal.id ?? signal.symbol}` }, { text: '❌ Отмена', callback_data: `signal_cancel_${signal.id ?? signal.symbol}` }]] },
  });
}

export async function broadcastTradeOpened(trade: Trade, signal: Signal): Promise<void> {
  await sendAdminMessage(formatTradeOpenedMessage(trade, signal));
}

export async function broadcastTradeClosed(trade: Trade, improvements?: string[]): Promise<void> {
  await sendAdminMessage(formatTradeClosedMessage(trade, improvements));
}

export async function broadcastTpHit(trade: Trade, level: number, price: number): Promise<void> {
  await sendAdminMessage(await buildTpMessage(trade, level, price));
}

export async function sendErrorAlert(error: string, context?: string): Promise<void> {
  await sendAdminMessage(formatErrorAlert(error, context));
}
