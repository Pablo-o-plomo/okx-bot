import dotenv from 'dotenv';
dotenv.config();

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`❌ Missing required env variable: ${key}`);
  return val;
}

function optionalEnv(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

export const config = {
  telegram: {
    botToken: requireEnv('TELEGRAM_BOT_TOKEN'),
    chatId: requireEnv('TELEGRAM_CHAT_ID'),
    adminId: optionalEnv('TELEGRAM_ADMIN_ID', ''),
  },

  okx: {
    apiKey: optionalEnv('OKX_API_KEY', ''),
    apiSecret: optionalEnv('OKX_API_SECRET', ''),
    passphrase: optionalEnv('OKX_API_PASSPHRASE', ''),
    baseUrl: 'https://www.okx.com',
    isDemo: optionalEnv('DEMO_TRADING', 'true') === 'true',
  },

  trading: {
    isLive: optionalEnv('LIVE_TRADING', 'false') === 'true',
    symbols: optionalEnv('SYMBOLS', 'BTC-USDT-SWAP,ETH-USDT-SWAP,SOL-USDT-SWAP').split(',').map(s => s.trim()),
    timeframes: optionalEnv('TIMEFRAMES', '15m,1H,4H').split(',').map(s => s.trim()),
    riskPerTrade: parseFloat(optionalEnv('RISK_PER_TRADE', '1')),
    maxDailyLoss: parseFloat(optionalEnv('MAX_DAILY_LOSS', '3')),
    maxOpenPositions: parseInt(optionalEnv('MAX_OPEN_POSITIONS', '3')),
    maxLossesInRow: parseInt(optionalEnv('MAX_LOSSES_IN_ROW', '3')),
    minSignalConfidence: parseInt(optionalEnv('MIN_SIGNAL_CONFIDENCE', '6')),
    autoOptimize: optionalEnv('AUTO_OPTIMIZE', 'false') === 'true',
  },

  database: {
    url: optionalEnv('DATABASE_URL', './trading.db'),
  },

  server: {
    port: parseInt(optionalEnv('PORT', '3000')),
  },
} as const;

export type Config = typeof config;
