"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.placeOrder = placeOrder;
exports.moveStopLossToBreakeven = moveStopLossToBreakeven;
exports.closePosition = closePosition;
exports.cancelAlgoOrder = cancelAlgoOrder;
exports.getOkxAccountBalance = getOkxAccountBalance;
exports.getAccountBalance = getAccountBalance;
exports.updatePaperBalance = updatePaperBalance;
exports.closePartialPosition = closePartialPosition;
const client_1 = require("./client");
const config_1 = require("../config");
const logger_1 = require("../utils/logger");
const db_1 = require("../database/db");
let paperOrderCounter = 1000;
/**
 * Place order — routes to paper or live depending on config.
 */
async function placeOrder(signal) {
    if (!config_1.config.trading.isLive) {
        return paperOrder(signal);
    }
    if (!config_1.config.trading.autoTrade) {
        logger_1.logger.warn('LIVE trade execution requested but AUTO_TRADE=false; order not sent');
        return {
            orderId: `SKIPPED-${paperOrderCounter++}`,
            symbol: signal.symbol,
            side: signal.direction === 'LONG' ? 'buy' : 'sell',
            price: signal.entryPrice,
            size: signal.positionSize,
            status: 'skipped',
            paper: true,
        };
    }
    return liveOrder(signal);
}
/**
 * Paper trading — simulates order fill at entry price.
 */
function paperOrder(signal) {
    const orderId = `PAPER-${paperOrderCounter++}`;
    logger_1.logger.info(`📄 Paper order: ${signal.direction} ${signal.symbol} @ ${signal.entryPrice}`);
    return {
        orderId,
        symbol: signal.symbol,
        side: signal.direction === 'LONG' ? 'buy' : 'sell',
        price: signal.entryPrice,
        size: signal.positionSize,
        status: 'filled',
        paper: true,
    };
}
/**
 * Live order via OKX API.
 * ⚠️ Only executes when TRADING_MODE=live and AUTO_TRADE=true
 */
async function liveOrder(signal) {
    logger_1.logger.warn(`🔴 LIVE ORDER: ${signal.direction} ${signal.symbol} @ ${signal.entryPrice}`);
    const side = signal.direction === 'LONG' ? 'buy' : 'sell';
    const instType = signal.symbol.endsWith('-SWAP') ? 'SWAP' : 'SPOT';
    const orderData = {
        instId: signal.symbol,
        tdMode: instType === 'SWAP' ? 'cross' : 'cash',
        side,
        ordType: 'limit',
        px: String(signal.entryPrice),
        sz: String(signal.positionSize),
    };
    if (instType === 'SWAP' && signal.leverage > 1) {
        // Set leverage first
        try {
            await client_1.okxClient.privatePost('/api/v5/account/set-leverage', {
                instId: signal.symbol,
                lever: String(signal.leverage),
                mgnMode: 'cross',
            });
        }
        catch (err) {
            logger_1.logger.error(`Failed to set leverage: ${err.message}`);
        }
    }
    const result = await client_1.okxClient.privatePost('/api/v5/trade/order', orderData);
    if (result[0].sCode !== '0') {
        throw new Error(`OKX order rejected: sCode=${result[0].sCode} msg=${result[0].sMsg}`);
    }
    return {
        orderId: result[0].ordId,
        symbol: signal.symbol,
        side,
        price: signal.entryPrice,
        size: signal.positionSize,
        status: 'placed',
        paper: false,
    };
}
/**
 * Move stop loss to breakeven (live or paper).
 */
async function moveStopLossToBreakeven(symbol, direction, size, stopLoss) {
    if (!config_1.config.trading.isLive || !config_1.config.trading.autoTrade) {
        const orderId = `PAPER-SL-BE-${paperOrderCounter++}`;
        logger_1.logger.info(`📄 Paper SL moved to breakeven: ${symbol} @ ${stopLoss}`);
        return { orderId, symbol, side: direction === 'LONG' ? 'sell' : 'buy', price: stopLoss, size, status: 'updated', paper: true };
    }
    const side = direction === 'LONG' ? 'sell' : 'buy';
    const result = await client_1.okxClient.privatePost('/api/v5/trade/order-algo', {
        instId: symbol,
        tdMode: symbol.endsWith('-SWAP') ? 'cross' : 'cash',
        side,
        ordType: 'conditional',
        sz: String(size),
        slTriggerPx: String(stopLoss),
        slOrdPx: '-1',
        reduceOnly: true,
    });
    if (result[0].sCode !== '0') {
        throw new Error(`OKX algo order rejected: sCode=${result[0].sCode} msg=${result[0].sMsg}`);
    }
    return {
        orderId: result[0].algoId ?? result[0].ordId,
        symbol,
        side,
        price: stopLoss,
        size,
        status: 'updated',
        paper: false,
    };
}
/**
 * Close a position (live or paper).
 */
async function closePosition(symbol, direction, size, price) {
    if (!config_1.config.trading.isLive || !config_1.config.trading.autoTrade) {
        const orderId = `PAPER-CLOSE-${paperOrderCounter++}`;
        logger_1.logger.info(`📄 Paper close: ${symbol} @ ${price}`);
        return { orderId, symbol, side: direction === 'LONG' ? 'sell' : 'buy', price, size, status: 'filled', paper: true };
    }
    const side = direction === 'LONG' ? 'sell' : 'buy';
    const result = await client_1.okxClient.privatePost('/api/v5/trade/order', {
        instId: symbol,
        tdMode: symbol.endsWith('-SWAP') ? 'cross' : 'cash',
        side,
        ordType: 'market',
        sz: String(size),
    });
    if (result[0].sCode !== '0') {
        throw new Error(`OKX close order rejected: sCode=${result[0].sCode} msg=${result[0].sMsg}`);
    }
    return {
        orderId: result[0].ordId,
        symbol,
        side,
        price,
        size,
        status: 'placed',
        paper: false,
    };
}
/**
 * Cancel an active SL algo order on OKX.
 * No-op in paper/demo mode.
 */
async function cancelAlgoOrder(symbol, algoId) {
    if (!config_1.config.trading.isLive || !config_1.config.trading.autoTrade)
        return;
    // OKX cancel-algos expects an array body; cast bypasses Record<string, unknown> constraint
    const result = await client_1.okxClient.privatePost('/api/v5/trade/cancel-algos', [{ algoId, instId: symbol }]);
    if (result[0]?.sCode !== '0') {
        throw new Error(`OKX cancel algo failed: algoId=${algoId} sCode=${result[0]?.sCode} msg=${result[0]?.sMsg}`);
    }
}
async function fetchOkxUsdtBalance() {
    const data = await client_1.okxClient.privateGet('/api/v5/account/balance', { ccy: 'USDT' });
    const usdtBal = data[0]?.details?.find((d) => d.ccy === 'USDT');
    return parseFloat(usdtBal?.availBal || '0');
}
/**
 * Get real OKX account balance for display/reference purposes.
 */
async function getOkxAccountBalance() {
    try {
        return await fetchOkxUsdtBalance();
    }
    catch (err) {
        logger_1.logger.warn(`Failed to fetch OKX balance: ${err.message}`);
        return null;
    }
}
/**
 * Get trading balance used by sizing/risk/execution.
 */
async function getAccountBalance() {
    if (!config_1.config.trading.isLive) {
        // Internal paper trading always uses the virtual SQLite balance.
        return (0, db_1.getPaperTradingBalance)();
    }
    const okxBalance = await getOkxAccountBalance();
    if (okxBalance !== null)
        return okxBalance;
    const state = (0, db_1.getBotState)();
    return state.totalBalance;
}
/**
 * Update paper balance after trade closes.
 */
function updatePaperBalance(pnlUsdt) {
    const balance = (0, db_1.getPaperTradingBalance)();
    (0, db_1.updateBotState)({ totalBalance: balance + pnlUsdt });
}
/**
 * Partially close an open position on OKX.
 *
 * Unlike closePosition(), this function:
 *  - accepts any size <= current open contracts (caller's responsibility)
 *  - sets reduceOnly: 'true' in live mode to prevent accidental position flip
 *
 * Not yet called from trading logic (Stage 4 will wire it to handlePartialClose).
 */
async function closePartialPosition(symbol, direction, size, price) {
    // --- Validation ---
    if (!symbol)
        throw new Error('closePartialPosition: symbol is empty');
    if (direction !== 'LONG' && direction !== 'SHORT') {
        throw new Error('closePartialPosition: invalid direction ' + direction);
    }
    if (size <= 0)
        throw new Error('closePartialPosition: size must be > 0, got ' + size);
    if (price <= 0)
        throw new Error('closePartialPosition: price must be > 0, got ' + price);
    // --- Paper mode ---
    if (!config_1.config.trading.isLive || !config_1.config.trading.autoTrade) {
        const orderId = 'PAPER-PARTIAL-' + (paperOrderCounter++);
        logger_1.logger.info('Paper partial close: ' + symbol + ' ' + direction + ' size=' + size + ' at ' + price);
        return {
            orderId,
            symbol,
            side: direction === 'LONG' ? 'sell' : 'buy',
            price,
            size,
            status: 'filled',
            paper: true,
        };
    }
    // --- Live mode ---
    const side = direction === 'LONG' ? 'sell' : 'buy';
    logger_1.logger.warn('LIVE PARTIAL CLOSE: ' + direction + ' ' + symbol + ' size=' + size + ' at ' + price);
    const result = await client_1.okxClient.privatePost('/api/v5/trade/order', {
        instId: symbol,
        tdMode: symbol.endsWith('-SWAP') ? 'cross' : 'cash',
        side,
        ordType: 'market',
        sz: String(size),
        reduceOnly: 'true',
    });
    if (result[0].sCode !== '0') {
        throw new Error('OKX partial close rejected: sCode=' + result[0].sCode + ' msg=' + result[0].sMsg);
    }
    return {
        orderId: result[0].ordId,
        symbol,
        side,
        price,
        size,
        status: 'placed',
        paper: false,
    };
}
//# sourceMappingURL=trading.js.map