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
| `SEND_STARTUP_TO_CHANNEL` | `false` | Отправлять startup/restart уведомления в канал; по умолчанию только admin |
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
| `/start` | Admin control panel с inline-кнопками |
| `/menu` | Повторно показать admin keyboard |
| `/balance` | Текущий баланс |
| `/version` | Показать build version для диагностики Railway deploy |
| `/signals` | Последние 5 сигналов |
| `/positions` | Открытые позиции |
| `/stats` | Статистика сделок |
| `/winrate` | Winrate по монетам |
| `/market` | Rule-based market summary |
| `/rejects` | Статистика reject-фильтров |
| `/health` | Health/heartbeat и build version |
| `/filters` | Текущие filter settings |
| `/closed` | Последние закрытые сделки |
| `/scan` | Safe stub для ручного scan now |
| `/logs` | Safe stub для логов |
| `/pause` | Остановить торговлю |
| `/resume` | Возобновить |
| `/mode` | Текущий режим |
| `/risk` | Настройки риска |
| `/report` | Дневной отчет |
| `/errors` | Частые ошибки |
| `/analyze` | Анализ последних 20 сделок |

> Чтобы кнопки admin panel и текущий build version появились, напишите `/start` в личном чате с ботом. В канале сигналы публикуются через `TELEGRAM_CHAT_ID`, но панель управления показывается только личному `TELEGRAM_ADMIN_ID`.

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

## 🤖 AI Signal Engine Upgrade

Бот работает как paper-first crypto signal engine: анализирует EMA/RSI/MACD/ATR/volume, фильтрует FOMO/волатильность/слабый объем и публикует только сигналы, прошедшие quality threshold.

### Paper trading warning

- `LIVE_TRADING=false` по умолчанию.
- Если OKX ключи пустые или неполные, бот принудительно остается в paper mode.
- Live trading не включается автоматически.
- Telegram token и OKX API keys не логируются.

### Lifecycle сделок

Канал получает события:

- `PAPER TRADE OPENED` / `LIVE TRADE OPENED`
- `TP1 HIT`, `TP2 HIT`, `TP3 HIT`
- перенос SL в breakeven
- partial close / progress по целям
- `TRADE CLOSED BY PLAN`
- `TRADE CLOSED BY STOP`
- `TRADE CLOSED AT BREAKEVEN`

SQLite хранит progress сделки: `tp1_hit_at`, `tp2_hit_at`, `tp3_hit_at`, `breakeven_moved_at`, `close_reason`, `final_pnl`, `current_pnl`, `progress_json`.

### Quality filters

- Confidence score учитывает EMA trend, RSI, MACD, volume, ATR, breakout, multi-timeframe agreement и RR.
- Anti-FOMO filter отклоняет late entry, extended move, fomo entry и плохой RR.
- Volume filter отклоняет слабый объем по quality mode.
- Volatility filter отклоняет слишком низкий/высокий ATR.

### Market personality

Стиль канала: «Отскок мёртвой кошки» — мрачноватый, ироничный, трейдерский, без мем-помойки. Комментарии находятся в `src/utils/wittyComments.ts`.

### Admin panel

`/start` в личном чате admin открывает inline keyboard:

- 📊 Статистика
- 📂 Позиции
- 📈 Winrate
- 🧠 Анализ
- 📄 Отчет
- 🚫 Rejects
- 🌍 Market
- ⏸ Пауза
- ▶️ Resume
- ⚙️ Режим
- 🛡 Риски
- 💓 Health
- 📜 Последние сделки
- 📡 Scan now
- 🧾 Логи
- 🧠 Версия

Канал получает только сигналы/lifecycle/summary. Admin actions отвечают в личный чат admin.

### Дополнительные команды

- `/winrate` — winrate и PnL по монетам.
- `/market` — rule-based AI market summary.
- `/rejects` — статистика отклоненных сигналов.
- `/filters` — активные thresholds.
- `/health` — heartbeat/status.
- `/analyze` — ML/error analysis.

### Дополнительные ENV

| Переменная | По умолчанию | Описание |
|---|---:|---|
| `MIN_ATR_PERCENT` | `0.2` | Минимальный ATR%, ниже рынок считается мертвым |
| `MAX_ATR_PERCENT` | `3` | Максимальный ATR%, выше риск выноса |
| `MIN_SIGNAL_CONFIDENCE` | `7` | Минимальный confidence score |
| `MIN_VOLUME_MULTIPLIER` | `1.2` | Volume threshold для high-quality режима |
| `QUALITY_MODE` | `high` | `low`, `normal`, `high` |
| `AUTO_OPTIMIZE` | `false` | Флаг для будущей авто-оптимизации |
| `DEFENSIVE_MODE_DRAWDOWN` | `5` | Пауза/defensive mode при просадке хуже -5% |
| `SEND_STARTUP_TO_CHANNEL` | `false` | Если `true`, startup/restart уведомление дополнительно уйдет в канал; по умолчанию канал не засоряется |
