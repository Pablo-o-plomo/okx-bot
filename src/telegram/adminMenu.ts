import type TelegramBot from 'node-telegram-bot-api';

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

export function adminMenuMarkup(): TelegramBot.SendMessageOptions['reply_markup'] {
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

export function adminPanelText(): string {
  return '🤖 <b>OKX Bot Control Panel</b>\n\nКанал получает сигналы и lifecycle. Управление — только здесь.';
}
