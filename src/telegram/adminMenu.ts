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
        { text: '📊 Статистика', callback_data: 'stats' },
        { text: '📂 Позиции', callback_data: 'positions' },
      ],
      [
        { text: '📈 Винрейт', callback_data: 'winrate' },
        { text: '🧠 Анализ', callback_data: 'analyze' },
      ],
      [
        { text: '📄 Отчет', callback_data: 'report' },
        { text: '🚫 Отклонения', callback_data: 'rejects' },
      ],
      [
        { text: '🌍 Рынок', callback_data: 'market' },
        { text: '💓 Здоровье', callback_data: 'health' },
      ],
      [
        { text: '⚙️ Режим', callback_data: 'mode' },
        { text: '🛡 Риски', callback_data: 'risk' },
      ],
      [
        { text: '⏸ Пауза', callback_data: 'pause' },
        { text: '▶️ Возобновить', callback_data: 'resume' },
      ],
      [
        { text: '📜 Последние сделки', callback_data: 'closed' },
        { text: '📡 Сканировать', callback_data: 'scan' },
      ],
      [
        { text: '🧾 Логи', callback_data: 'logs' },
        { text: '🧠 Версия', callback_data: 'version' },
      ],
    ],
  };
}

export async function sendAdminMenu(bot: TelegramBot, chatId: string): Promise<void> {
  await bot.sendMessage(chatId, `🤖 Панель управления OKX Bot\n\nСборка:\n${BUILD_VERSION}`, {
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
