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

export function setAdminCommandHandler(handler: AdminCommandHandler): void {
  adminCommandHandler = handler;
}

export function getAdminKeyboard(): TelegramBot.SendMessageOptions['reply_markup'] {
  return {
    inline_keyboard: [
      [
        { text: '📊 Статистика', callback_data: 'admin:stats' },
        { text: '📂 Позиции', callback_data: 'admin:positions' },
      ],
      [
        { text: '📈 Winrate', callback_data: 'admin:winrate' },
        { text: '🧠 Анализ', callback_data: 'admin:analyze' },
      ],
      [
        { text: '📄 Отчет', callback_data: 'admin:report' },
        { text: '🚫 Rejects', callback_data: 'admin:rejects' },
      ],
      [
        { text: '🌍 Market', callback_data: 'admin:market' },
        { text: '💓 Health', callback_data: 'admin:health' },
      ],
      [
        { text: '⏸ Пауза', callback_data: 'admin:pause' },
        { text: '▶️ Resume', callback_data: 'admin:resume' },
      ],
      [
        { text: '⚙️ Режим', callback_data: 'admin:mode' },
        { text: '🛡 Риски', callback_data: 'admin:risk' },
      ],
    ],
  };
}

export async function sendAdminMenu(bot: TelegramBot, chatId: string): Promise<void> {
  await bot.sendMessage(chatId, '🤖 <b>OKX Bot Control Panel</b>\n\nВыберите действие кнопкой ниже:', {
    parse_mode: 'HTML',
    reply_markup: getAdminKeyboard(),
    disable_web_page_preview: true,
  });
}

export async function handleAdminCallback(bot: TelegramBot, query: TelegramBot.CallbackQuery): Promise<boolean> {
  if (!query.data?.startsWith('admin:')) return false;

  const adminId = config.telegram.adminId.trim();
  const userId = query.from.id.toString();
  if (!adminId || userId !== adminId) {
    await bot.answerCallbackQuery(query.id, { text: 'Access denied', show_alert: true });
    return true;
  }

  const key = query.data.replace('admin:', '');
  const command = adminCallbacks[key];
  if (!command) {
    await bot.answerCallbackQuery(query.id, { text: 'Раздел в разработке', show_alert: true });
    return true;
  }

  await bot.answerCallbackQuery(query.id);
  if (adminCommandHandler) {
    await adminCommandHandler(adminId, command);
  } else {
    await bot.sendMessage(adminId, 'Раздел в разработке');
  }
  return true;
}
