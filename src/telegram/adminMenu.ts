import TelegramBot from 'node-telegram-bot-api';
import { config } from '../config';

export const adminCallbacks: Record<string, string> = {
  stats: '/stats',
  positions: '/positions',
  winrate: '/winrate',
  analyze: '/analyze',
  report: '/report',
  rejects: '/rejects',
  market: '/market',
  pause: '/pause',
  resume: '/resume',
  mode: '/mode',
  risk: '/risk',
  health: '/health',
};

type AdminCommandHandler = (chatId: string, command: string) => Promise<void>;
let adminCommandHandler: AdminCommandHandler | undefined;

function getConfiguredAdminIds(): number[] {
  return config.telegram.adminId
    .split(',')
    .map(id => Number(id.trim()))
    .filter(id => Number.isFinite(id));
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
        { text: '📈 Winrate', callback_data: 'winrate' },
        { text: '🧠 Анализ', callback_data: 'analyze' },
      ],
      [
        { text: '📄 Отчет', callback_data: 'report' },
        { text: '🚫 Rejects', callback_data: 'rejects' },
      ],
      [
        { text: '🌍 Market', callback_data: 'market' },
        { text: '💓 Health', callback_data: 'health' },
      ],
      [
        { text: '⏸ Пауза', callback_data: 'pause' },
        { text: '▶️ Resume', callback_data: 'resume' },
      ],
      [
        { text: '⚙️ Режим', callback_data: 'mode' },
        { text: '🛡 Риски', callback_data: 'risk' },
      ],
    ],
  };
}

export async function sendAdminMenu(bot: TelegramBot, chatId: string): Promise<void> {
  await bot.sendMessage(chatId, '🤖 OKX Bot Control Panel', {
    reply_markup: getAdminKeyboard(),
  });
}

export async function handleAdminCallback(bot: TelegramBot, query: TelegramBot.CallbackQuery): Promise<boolean> {
  if (!query.data) return false;

  const adminIds = getConfiguredAdminIds();
  const userId = query.from.id;
  if (!adminIds.includes(userId)) {
    await bot.answerCallbackQuery(query.id, { text: 'Access denied' });
    return true;
  }

  const key = query.data;
  const command = adminCallbacks[key];
  const targetChatId = query.message?.chat.id.toString() ?? userId.toString();

  if (!command) {
    await bot.answerCallbackQuery(query.id, { text: 'Раздел в разработке' });
    await bot.sendMessage(targetChatId, 'Раздел в разработке');
    return true;
  }

  await bot.answerCallbackQuery(query.id);
  if (adminCommandHandler) {
    await adminCommandHandler(targetChatId, command);
  } else {
    await bot.sendMessage(targetChatId, 'Раздел в разработке');
  }
  return true;
}
