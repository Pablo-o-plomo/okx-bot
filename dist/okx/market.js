"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCandles = getCandles;
exports.getTicker = getTicker;
exports.getInstrumentInfo = getInstrumentInfo;
exports.getInstrumentTradeParams = getInstrumentTradeParams;
exports.getFundingRate = getFundingRate;
const client_1 = require("./client");
const logger_1 = require("../utils/logger");
// OKX timeframe mapping
const TF_MAP = {
    '1m': '1m', '3m': '3m', '5m': '5m', '15m': '15m', '30m': '30m',
    '1H': '1H', '2H': '2H', '4H': '4H', '6H': '6H', '12H': '12H',
    '1D': '1D', '1W': '1W',
};
/**
 * Fetch OHLCV candles from OKX.
 * Returns candles sorted oldest newest.
 */
async function getCandles(symbol, timeframe, limit = 200) {
    const bar = TF_MAP[timeframe] || timeframe;
    try {
        // OKX returns: [ts, open, high, low, close, vol, volCcy, volCcyQuote, confirm]
        const raw = await client_1.okxClient.publicGet('/api/v5/market/candles', {
            instId: symbol,
            bar,
            limit: String(limit),
        });
        const candles = raw.map(c => ({
            timestamp: parseInt(c[0]),
            open: parseFloat(c[1]),
            high: parseFloat(c[2]),
            low: parseFloat(c[3]),
            close: parseFloat(c[4]),
            volume: parseFloat(c[5]),
        }));
        // OKX returns newest first - reverse to oldest first
        return candles.reverse();
    }
    catch (err) {
        logger_1.logger.error(`Failed to fetch candles for ${symbol} ${timeframe}: ${err.message}`);
        return [];
    }
}
/**
 * Fetch current ticker price.
 */
async function getTicker(symbol) {
    try {
        const data = await client_1.okxClient.publicGet('/api/v5/market/ticker', { instId: symbol });
        return parseFloat(data[0].last);
    }
    catch (err) {
        logger_1.logger.error(`Failed to fetch ticker for ${symbol}: ${err.message}`);
        return 0;
    }
}
/**
 * Fetch instrument info (tick size, lot size, etc.)
 */
async function getInstrumentInfo(symbol) {
    try {
        const instType = symbol.endsWith('-SWAP') ? 'SWAP' : 'SPOT';
        const data = await client_1.okxClient.publicGet('/api/v5/public/instruments', {
            instType,
            instId: symbol,
        });
        if (!data || !data[0])
            return null;
        const inst = data[0];
        return {
            tickSz: parseFloat(inst.tickSz),
            lotSz: parseFloat(inst.lotSz),
            minSz: parseFloat(inst.minSz),
            ctVal: parseFloat(inst.ctVal || '1'),
            instType,
        };
    }
    catch (err) {
        logger_1.logger.error(`Failed to fetch instrument info for ${symbol}: ${err.message}`);
        return null;
    }
}
// Returns ctVal, lotSz, minSz for a symbol.
// Falls back to safe defaults if OKX is unreachable.
async function getInstrumentTradeParams(symbol) {
    const FALLBACK = { ctVal: 1, lotSz: 1, minSz: 1 };
    try {
        const info = await getInstrumentInfo(symbol);
        if (!info) {
            logger_1.logger.warn('getInstrumentTradeParams: no data for ' + symbol + ', using fallback');
            return FALLBACK;
        }
        return { ctVal: info.ctVal, lotSz: info.lotSz, minSz: info.minSz };
    }
    catch (err) {
        logger_1.logger.warn('getInstrumentTradeParams: error for ' + symbol + ': ' + err.message);
        return FALLBACK;
    }
}
/**
 * Get funding rate for swaps (used for risk awareness).
 */
async function getFundingRate(symbol) {
    if (!symbol.endsWith('-SWAP'))
        return 0;
    try {
        const data = await client_1.okxClient.publicGet('/api/v5/public/funding-rate', { instId: symbol });
        return parseFloat(data[0]?.fundingRate || '0');
    }
    catch {
        return 0;
    }
}
//# sourceMappingURL=market.js.map