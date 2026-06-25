"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateDailyReport = generateDailyReport;
exports.sendDailyReport = sendDailyReport;
const db_1 = require("../database/db");
const balance_1 = require("../utils/balance");
const messages_1 = require("../telegram/messages");
const bot_1 = require("../telegram/bot");
const logger_1 = require("../utils/logger");
async function generateDailyReport() {
    const today = new Date().toISOString().split('T')[0];
    const trades = (0, db_1.getTodayTrades)();
    const balanceView = await (0, balance_1.getBalanceView)();
    const balance = balanceView.tradingBalance;
    // Approximate start balance (simplified)
    const totalPnlUsdt = trades.reduce((a, t) => a + (t.pnlUsdt ?? 0), 0);
    const startBalance = balance === null ? null : balance - totalPnlUsdt;
    return (0, messages_1.formatDailyReport)(today, trades, balance, startBalance, {
        mode: balanceView.tradeMode,
        okxBalance: balanceView.okxBalance,
    });
}
async function sendDailyReport() {
    try {
        const report = await generateDailyReport();
        await (0, bot_1.broadcastMessage)(report);
        logger_1.logger.info('📋 Daily report sent');
    }
    catch (err) {
        logger_1.logger.error(`Failed to send daily report: ${err.message}`);
    }
}
//# sourceMappingURL=dailyReport.js.map