import TelegramBot from 'node-telegram-bot-api';
import { config } from '../config';
import { initBcsDb, ensureUser, getSettings, saveBcsTrade, getOpenBcsTrades, getClosedBcsTrades, getTodayBcsTrades, getMonthBcsTrades, closeBcsTrade, saveAiReview, type BcsInstrumentType, type BcsTradeDirection, type BcsTradeInput } from '../bcs/db';
import { calculateBcsCommission, formatBcsCommissionSettings } from '../bcs/commission';
import { analyzeInstrument, reviewTrade } from '../bcs/analysis';
import { calculateBcsRisk, formatRub } from '../bcs/risk';
import { formatDailyBcsReport, formatDiary, formatMonthlyBcsReport, formatPortfolio } from '../bcs/reports';
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
      [{ text: '📊 Портфель', callback_data: 'portfolio' }, { text: '📝 Добавить сделку', callback_data: 'add_trade' }],
      [{ text: '📈 Анализ инструмента', callback_data: 'analyze_instrument' }, { text: '🧠 AI-разбор', callback_data: 'ai_review' }],
      [{ text: '⚠️ Риск-менеджмент', callback_data: 'risk' }, { text: '💰 Комиссии БКС', callback_data: 'fees' }],
      [{ text: '📋 Дневник сделок', callback_data: 'diary' }, { text: '📅 Отчет за день', callback_data: 'daily_report' }],
      [{ text: '📆 Отчет за месяц', callback_data: 'monthly_report' }, { text: '⚙️ Настройки', callback_data: 'settings' }],
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

async function handleStart(chatId: number, fromId?: number): Promise<void> {
  logger.info(`START: chat=${chatId}, from=${fromId}, admin=${config.telegram.adminId}`);
  if (!isAdminMessage(chatId, fromId)) {
    await send(chatId, 'Бот работает. Панель управления доступна только администратору.');
    return;
  }
  ensureUser(fromId ?? chatId);
  await send(chatId, `🤖 <b>BCS Trading Assistant</b>\nBuild: ${BUILD_VERSION}\n\nВыберите раздел:`, { reply_markup: mainKeyboard() });
}

async function handleMenu(chatId: number, fromId?: number): Promise<void> {
  await handleStart(chatId, fromId ?? chatId);
}

async function handlePortfolio(chatId: number): Promise<void> {
  const settings = getSettings(chatId);
  await send(chatId, formatPortfolio(getOpenBcsTrades(chatId), getClosedBcsTrades(chatId), settings.depositRub));
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
  await send(chatId, `⚠️ <b>Риск-менеджмент</b>\n\nДепозит: ${settings.depositRub.toFixed(2)} ₽\nРиск на сделку: ${settings.riskPerTrade.toFixed(2)}%\n\nПравила:\n• риск на сделку не выше 1–2% депозита\n• вход только со стопом и тейком\n• risk/reward желательно не хуже 1:2\n• комиссии учитывать до входа\n\n⚠️ Это не инвестиционная рекомендация.`);
}

async function handleFees(chatId: number): Promise<void> {
  await send(chatId, formatBcsCommissionSettings());
}

async function handleSettings(chatId: number): Promise<void> {
  const settings = getSettings(chatId);
  await send(chatId, `⚙️ <b>Настройки</b>\n\nБрокер: ${config.app.broker}\nДепозит по умолчанию: ${settings.depositRub.toFixed(2)} ₽\nРиск на сделку: ${settings.riskPerTrade.toFixed(2)}%\nАвтоторговля: отключена\n\nДля изменения базовых настроек используйте ENV.`);
}

async function handleAnalyzePrompt(chatId: number): Promise<void> {
  await send(chatId, 'Введите тикер для анализа, например: <code>/analyze SBER</code>');
}

async function handleAiPrompt(chatId: number): Promise<void> {
  await send(chatId, 'Для AI-разбора добавьте сделку через меню или отправьте: <code>/review SBER stock LONG 250 10 240 275 10 комментарий</code>');
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
    await send(chatId, `✅ <b>Сделка добавлена</b> #${tradeId}\n\n${complete.ticker} ${complete.direction}\nСумма позиции: ${risk.positionAmountRub.toFixed(2)} ₽\nРиск: ${risk.riskRub.toFixed(2)} ₽ (${risk.riskPercent.toFixed(2)}%)\nПотенциальная прибыль: ${risk.potentialProfitRub.toFixed(2)} ₽\nRisk/Reward: 1:${risk.riskReward.toFixed(2)}\nКомиссия: ${risk.totalCommissionRub.toFixed(2)} ₽\nРешение: ${risk.decision === 'allowed' ? 'сделка допустима' : 'лучше пропустить'}\n${risk.warnings.length ? `\nПредупреждения:\n${risk.warnings.map(w => `• ${w}`).join('\n')}` : ''}\n\n⚠️ Это не инвестиционная рекомендация.`);
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
  switch (action) {
    case 'portfolio': return handlePortfolio(chatId);
    case 'add_trade': return startAddTrade(chatId);
    case 'analyze_instrument': return handleAnalyzePrompt(chatId);
    case 'ai_review': return handleAiPrompt(chatId);
    case 'risk': return handleRisk(chatId);
    case 'fees': return handleFees(chatId);
    case 'diary': return handleDiary(chatId);
    case 'daily_report': return handleDailyReport(chatId);
    case 'monthly_report': return handleMonthlyReport(chatId);
    case 'settings': return handleSettings(chatId);
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
  await send(chatId, `✅ <b>Сделка закрыта</b> #${trade.id}\n${trade.ticker} ${trade.direction}\nP&L: ${trade.pnlPercent >= 0 ? '+' : ''}${trade.pnlPercent.toFixed(2)}% | ${formatRub(trade.pnlRub)}\nКомиссии учтены.\n\n⚠️ Это не инвестиционная рекомендация.`);
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
  registerAdminCommand(/^\/fees(?:@\w+)?(?:\s|$)/, async (chatId) => handleFees(chatId));
  registerAdminCommand(/^\/risk(?:@\w+)?(?:\s|$)/, async (chatId) => handleRisk(chatId));
  registerAdminCommand(/^\/settings(?:@\w+)?(?:\s|$)/, async (chatId) => handleSettings(chatId));
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
  await sendAdminMessage(formatSignalMessage(signal));
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
