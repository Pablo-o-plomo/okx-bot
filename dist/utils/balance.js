"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTradingBalance = getTradingBalance;
exports.getBalanceView = getBalanceView;
exports.getDisplayBalance = getDisplayBalance;
exports.getOkxReferenceBalance = getOkxReferenceBalance;
const db_1 = require("../database/db");
const trading_1 = require("../okx/trading");
const config_1 = require("../config");
async function getTradingBalance() {
    if (!config_1.config.trading.isLive) {
        return (0, db_1.getPaperTradingBalance)();
    }
    const okxBalance = await (0, trading_1.getOkxAccountBalance)();
    if (okxBalance !== null)
        return okxBalance;
    const state = (0, db_1.getBotState)();
    return state.totalBalance > 0 ? state.totalBalance : config_1.config.trading.paperStartBalance;
}
async function getBalanceView() {
    const tradingBalance = await getTradingBalance();
    if (!config_1.config.trading.isLive) {
        return {
            okxApiMode: config_1.config.okx.isDemo ? 'DEMO' : 'LIVE',
            tradeMode: 'PAPER',
            autoTrade: config_1.config.trading.autoTrade,
            tradingBalance,
            paperBalance: tradingBalance,
            okxBalance: await (0, trading_1.getOkxAccountBalance)(),
        };
    }
    return {
        okxApiMode: config_1.config.okx.isDemo ? 'DEMO' : 'LIVE',
        tradeMode: 'LIVE',
        autoTrade: config_1.config.trading.autoTrade,
        tradingBalance,
        okxBalance: tradingBalance,
    };
}
async function getDisplayBalance() {
    return getTradingBalance();
}
async function getOkxReferenceBalance() {
    return (0, trading_1.getOkxAccountBalance)();
}
//# sourceMappingURL=balance.js.map