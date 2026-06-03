import TelegramBot from 'node-telegram-bot-api';
import { config } from '../config';
import { BUILD_VERSION } from '../version';

export const adminCallbacks: Record<string, string> = {
  stats: '/stats',
  positions: '/positions',
  winrate: '/winrate',
  analyze: '/analyze',
  report: '/report',
  rejects: '/rejects',
  market: '/market',
  health: '/health',
  mode: '/mode',
  risk: '/risk',
  pause: '/pause',
  resume: '/resume',
  closed: '/closed',
  scan: '/scan',
  logs: '/logs',
  version: '/version',
};

type AdminCommandHandler = (chatId: string, command: string) => Promise<void>;
let adminCommandHandler: AdminCommandHandler | undefined;

function getConfiguredAdminId(): number {
  return Number(config.telegram.adminId);
}

export function setAdminCommandHandler(handler: AdminCommandHandler): void {
  adminCommandHandler = handler;
}

export function getAdminKeyboard(): TelegramBot.SendMessageOptions['reply_markup'] {
  return {
    inline_keyboard: [
      [
        { text: '📊 Анализ рынка', callback_data: 'market' },
        { text: '🤖 Статус бота', callback_data: 'health' },
      ],
      [
        { text: '▶️ Возобновить торговлю', callback_data: 'resume' },
        { text: '⏸ Пауза', callback_data: 'pause' },
      ],
      [
        { text: '⚠️ Риск', callback_data: 'risk' },
        { text: '📋 Отчеты', callback_data: 'report' },
      ],
      [
        { text: '⚙️ Настройки', callback_data: 'mode' },
      ],
    ],
  };
}


export async function sendAdminMenu(bot: TelegramBot, chatId: string): Promise<void> {
  await bot.sendMessage(chatId, `🤖 CRYPTO TRADING BOT

Build:
${BUILD_VERSION}`, {
    reply_markup: getAdminKeyboard(),
  });
}


export async function handleAdminCallback(bot: TelegramBot, query: TelegramBot.CallbackQuery): Promise<boolean> {
  if (!query.data) return false;

  const adminId = getConfiguredAdminId();
  const userId = query.from.id;
  const messageChatId = query.message?.chat.id;
  if (userId !== adminId || messageChatId !== adminId) {
    await bot.answerCallbackQuery(query.id, { text: 'Доступ запрещен' });
    return true;
  }

  const key = query.data;
  const command = adminCallbacks[key];
  const targetChatId = messageChatId.toString();

  await bot.answerCallbackQuery(query.id, { text: 'OK' });
  if (!command || !adminCommandHandler) {
    await bot.sendMessage(targetChatId, 'Раздел в разработке');
    return true;
  }

  await adminCommandHandler(targetChatId, command);
  return true;
}
