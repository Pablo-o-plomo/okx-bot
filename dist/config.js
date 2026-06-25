"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
function requireEnv(key) {
    const val = process.env[key];
    if (!val)
        throw new Error(`❌ Missing required env variable: ${key}`);
    return val;
}
function optionalEnv(key, fallback) {
    return process.env[key] || fallback;
}
function optionalBool(keys, fallback) {
    for (const key of keys) {
        const value = process.env[key];
        if (value !== undefined && value !== '') {
            return value.toLowerCase() === 'true';
        }
    }
    return fallback;
}
const legacyLiveTrading = optionalBool(['LIVE_TRADING'], false);
const tradingMode = optionalEnv('TRADING_MODE', legacyLiveTrading ? 'live' : 'paper').toLowerCase();
if (!['paper', 'live'].includes(tradingMode)) {
    throw new Error('❌ TRADING_MODE must be either paper or live');
}
exports.config = {
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
        isDemo: optionalBool(['OKX_DEMO'], false) || optionalBool(['OKX_SIMULATED'], false),
    },
    trading: {
        mode: tradingMode,
        isLive: tradingMode === 'live',
        autoTrade: optionalBool(['AUTO_TRADE'], false),
        riskGuardEnabled: optionalBool(['RISK_GUARD_ENABLED'], true),
        autoPauseOnLimit: optionalBool(['AUTO_PAUSE_ON_LIMIT'], false),
        paperStartBalance: parseFloat(optionalEnv('PAPER_START_BALANCE', '1000')),
        symbols: optionalEnv('SYMBOLS', 'BTC-USDT-SWAP,ETH-USDT-SWAP,SOL-USDT-SWAP')
            .split(',')
            .map(s => s.trim()),
        timeframes: optionalEnv('TIMEFRAMES', '15m,1H,4H')
            .split(',')
            .map(s => s.trim()),
        riskPerTrade: parseFloat(optionalEnv('RISK_PER_TRADE', '1')),
        maxDailyLoss: parseFloat(optionalEnv('MAX_DAILY_LOSS', '3')),
        maxOpenPositions: parseInt(optionalEnv('MAX_OPEN_POSITIONS', '3')),
        maxLossesInRow: parseInt(optionalEnv('MAX_LOSS_STREAK', optionalEnv('MAX_LOSSES_IN_ROW', '3'))),
        minSignalConfidence: parseInt(optionalEnv('MIN_SIGNAL_CONFIDENCE', '6')),
        autoOptimize: optionalEnv('AUTO_OPTIMIZE', 'false') === 'true',
    },
    database: {
        url: optionalEnv('DATABASE_URL', './trading.db'),
    },
    server: {
        port: parseInt(optionalEnv('PORT', '3000')),
    },
};
//# sourceMappingURL=config.js.map