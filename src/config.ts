import dotenv from 'dotenv';
dotenv.config();

function optionalEnv(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

function requiredToken(): string {
  const token = process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('❌ Missing BOT_TOKEN env variable');
  return token;
}

function qualityModeEnv(): 'low' | 'normal' | 'high' {
  const value = optionalEnv('QUALITY_MODE', 'high').toLowerCase();
  return value === 'low' || value === 'normal' || value === 'high' ? value : 'high';
}

const adminId = optionalEnv('ADMIN_ID', optionalEnv('TELEGRAM_ADMIN_ID', ''));

export const config = {
  app: {
    name: 'BCS Trading Assistant',
    broker: optionalEnv('BROKER', 'BCS'),
  },

  telegram: {
    botToken: requiredToken(),
    adminId,
    chatId: optionalEnv('TELEGRAM_CHAT_ID', adminId),
    sendStartupToChannel: optionalEnv('SEND_STARTUP_TO_CHANNEL', 'false') === 'true',
  },

  bcs: {
    defaultDepositRub: parseFloat(optionalEnv('DEFAULT_DEPOSIT_RUB', '1000000')),
    defaultRiskPerTrade: parseFloat(optionalEnv('DEFAULT_RISK_PER_TRADE', '1')),
    monthlyServiceFee: parseFloat(optionalEnv('BCS_MONTHLY_SERVICE_FEE', '299')),
    securitiesFeePercent: parseFloat(optionalEnv('BCS_SECURITIES_FEE_PERCENT', '0.04')),
    currencyFeePercent: parseFloat(optionalEnv('BCS_CURRENCY_FEE_PERCENT', '0.04')),
    extraFxBuyFeePercent: parseFloat(optionalEnv('BCS_EXTRA_FX_BUY_FEE_PERCENT', '0.1')),
    futuresFeeRub: parseFloat(optionalEnv('BCS_FUTURES_FEE_RUB', '1.2')),
    optionsMaxFeePercent: parseFloat(optionalEnv('BCS_OPTIONS_MAX_FEE_PERCENT', '1')),
  },

  openai: {
    apiKey: optionalEnv('OPENAI_API_KEY', ''),
  },

  database: {
    url: optionalEnv('DATABASE_URL', './bcs-trading.db'),
  },

  server: {
    port: parseInt(optionalEnv('PORT', '3000')),
  },

  // Backward-compatible fields kept only so archived OKX modules still compile.
  okx: {
    apiKey: '',
    apiSecret: '',
    passphrase: '',
    baseUrl: 'https://www.okx.com',
    isDemo: true,
  },

  trading: {
    isLive: false,
    symbols: optionalEnv('ALLOWED_SYMBOLS', optionalEnv('SYMBOLS', 'SBER,GAZP,LKOH,IMOEX,Si,BR,GOLD')).split(',').map(s => s.trim()).filter(Boolean),
    timeframes: optionalEnv('TIMEFRAMES', '1D,1W').split(',').map(s => s.trim()),
    riskPerTrade: parseFloat(optionalEnv('DEFAULT_RISK_PER_TRADE', '1')),
    maxDailyLoss: parseFloat(optionalEnv('MAX_DAILY_LOSS', '3')),
    maxOpenPositions: parseInt(optionalEnv('MAX_OPEN_POSITIONS', '10')),
    maxLossesInRow: parseInt(optionalEnv('MAX_LOSSES_IN_ROW', '3')),
    minSignalConfidence: parseInt(optionalEnv('MIN_SIGNAL_CONFIDENCE', '7')),
    autoOptimize: optionalEnv('AUTO_OPTIMIZE', 'false') === 'true',
    enableTrailingStop: optionalEnv('ENABLE_TRAILING_STOP', 'false') === 'true',
    minAtrPercent: parseFloat(optionalEnv('MIN_ATR_PERCENT', '0.2')),
    maxAtrPercent: parseFloat(optionalEnv('MAX_ATR_PERCENT', '3')),
    defensiveModeDrawdown: parseFloat(optionalEnv('DEFENSIVE_MODE_DRAWDOWN', '5')),
    minVolumeMultiplier: parseFloat(optionalEnv('MIN_VOLUME_MULTIPLIER', '1.2')),
    qualityMode: qualityModeEnv(),
  },
} as const;

export type Config = typeof config;
