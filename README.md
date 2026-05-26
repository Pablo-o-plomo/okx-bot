# 🤖 OKX Trading Bot

Торговый Telegram-бот для биржи OKX с техническим анализом, риск-менеджментом и журналом сделок.

## ✅ Функциональность

- **Анализ рынка**: EMA 20/50/200, RSI, MACD, ATR, объемы, уровни поддержки/сопротивления, пробои
- **Multi-timeframe**: анализ на 3 тайм-фреймах одновременно
- **Paper trading**: по умолчанию, без реальных ордеров
- **Live trading**: включается через `LIVE_TRADING=true`
- **Риск-менеджмент**: 1% на сделку, лимит дневного убытка, пауза после серии потерь
- **Telegram-уведомления**: сигналы, TP/SL, дневной отчет
- **Журнал сделок**: SQLite, теги ошибок, анализ каждые 20 сделок
- **Admin-команды**: /start, /balance, /positions, /stats, /pause, /resume и др.

## 🚀 Быстрый старт

### 1. Установка

```bash
git clone <repo>
cd okx-bot
npm install
# или: pnpm install
```

### 2. Настройка `.env`

```bash
cp .env.example .env
```

Заполните обязательные переменные:

```env
TELEGRAM_BOT_TOKEN=<токен от @BotFather>
TELEGRAM_CHAT_ID=<ID канала/группы, например -100123456789>
TELEGRAM_ADMIN_ID=<ваш личный chat ID>

# Для paper trading — OKX API не обязателен
# Для live trading — нужны ключи OKX
OKX_API_KEY=
OKX_API_SECRET=
OKX_API_PASSPHRASE=
```

### 3. Запуск (Paper Trading)

```bash
npm run dev
```

### 4. Сборка и запуск в production

```bash
npm run build
npm start
```

## ⚙️ Переменные окружения

| Переменная | По умолчанию | Описание |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | — | Токен бота |
| `TELEGRAM_CHAT_ID` | — | ID канала для публикации сигналов |
| `TELEGRAM_ADMIN_ID` | — | Ваш ID для алертов об ошибках |
| `OKX_API_KEY` | — | Ключ OKX API |
| `OKX_API_SECRET` | — | Секрет OKX API |
| `OKX_API_PASSPHRASE` | — | Пароль OKX API |
| `LIVE_TRADING` | `false` | Включить реальную торговлю |
| `DEMO_TRADING` | `true` | Использовать OKX simulated trading |
| `SYMBOLS` | `BTC-USDT-SWAP,...` | Инструменты через запятую |
| `TIMEFRAMES` | `15m,1H,4H` | Тайм-фреймы (первый — основной) |
| `RISK_PER_TRADE` | `1` | Риск на сделку, % |
| `MAX_DAILY_LOSS` | `3` | Макс. дневной убыток, % |
| `MAX_OPEN_POSITIONS` | `3` | Макс. одновременных позиций |
| `MAX_LOSSES_IN_ROW` | `3` | Пауза после N убытков подряд |
| `MIN_SIGNAL_CONFIDENCE` | `6` | Мин. уверенность сигнала (1-10) |
| `AUTO_OPTIMIZE` | `false` | Авто-применение рекомендаций |
| `DATABASE_URL` | `./trading.db` | Путь к SQLite |

## 📊 Архитектура

```
src/
  index.ts              — точка входа, планировщик
  config.ts             — конфигурация из .env
  okx/
    client.ts           — HTTP-клиент OKX с подписью HMAC
    market.ts           — свечи, тикеры, инструменты
    trading.ts          — paper/live ордера
  telegram/
    bot.ts              — бот, команды, рассылка
    messages.ts         — форматирование сообщений
  strategy/
    indicators.ts       — EMA, RSI, MACD, ATR, уровни
    signalEngine.ts     — генерация сигналов
    riskManager.ts      — правила риска
    tradeManager.ts     — мониторинг сделок
  database/
    db.ts               — SQLite запросы
    models.ts           — TypeScript типы
  reports/
    dailyReport.ts      — дневной P&L отчет
    learningReport.ts   — анализ 20 сделок
  utils/
    logger.ts           — Winston логгер
```

## 📱 Команды Telegram

| Команда | Описание |
|---|---|
| `/start` | Статус бота |
| `/balance` | Текущий баланс |
| `/signals` | Последние 5 сигналов |
| `/positions` | Открытые позиции |
| `/stats` | Статистика сделок |
| `/pause` | Остановить торговлю |
| `/resume` | Возобновить |
| `/mode` | Текущий режим |
| `/risk` | Настройки риска |
| `/report` | Дневной отчет |
| `/errors` | Частые ошибки |
| `/analyze` | Анализ последних 20 сделок |

## 🔒 Безопасность

- API Secret никогда не логируется
- Реальная торговля отключена по умолчанию (`LIVE_TRADING=false`)
- Retry при ошибках API (3 попытки с экспоненциальной задержкой)
- Все непойманные ошибки отправляются в Telegram admin
- Защита от дублирования позиций по одному инструменту

## 📈 Правила риск-менеджмента

1. Риск на сделку ≤ 1% от депозита
2. Максимум 3 открытые сделки
3. После 3 убытков подряд — пауза 24 часа
4. Дневной убыток > 3% — стоп до следующего дня
5. Минимальный Risk/Reward = 1:2
6. Стоп не дальше 3% от входа
7. Нет усреднения убыточных позиций
8. Нет двух позиций по одному инструменту

## ⚠️ Дисклеймер

Бот не гарантирует прибыль. Торговля криптовалютами сопряжена с высоким риском. Используйте только те средства, потерю которых вы можете себе позволить. Это инструмент для обучения и тестирования стратегий.

## New Telegram Commands
- `/winrate` — winrate and PnL by symbol.
- `/market` — daily rule-based market summary.
- `/mode` — current mode + live/paper flags.
- `/filters` — active filter thresholds.
- `/analyze` — error/learning analysis.
- `/pause` `/resume` — manual control.

## New ENV Variables
- `MIN_ATR_PERCENT=0.2`
- `MAX_ATR_PERCENT=3`
- `MIN_SIGNAL_CONFIDENCE=6`
- `AUTO_OPTIMIZE=false`
- `DEFENSIVE_MODE_DRAWDOWN=-5`
