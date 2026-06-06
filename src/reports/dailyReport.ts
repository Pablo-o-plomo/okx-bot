import { getTodayTrades } from '../database/db';
import { getBalanceView } from '../utils/balance';
import { formatDailyReport } from '../telegram/messages';
import { broadcastMessage } from '../telegram/bot';
import { logger } from '../utils/logger';

export async function generateDailyReport(): Promise<string> {
  const today = new Date().toISOString().split('T')[0];
  const trades = getTodayTrades();
  const balanceView = await getBalanceView();
  const balance = balanceView.tradingBalance;

  // Approximate start balance (simplified)
  const totalPnlUsdt = trades.reduce((a, t) => a + (t.pnlUsdt ?? 0), 0);
  const startBalance = balance === null ? null : balance - totalPnlUsdt;

  return formatDailyReport(today, trades, balance, startBalance, {
    mode: balanceView.tradeMode,
    okxBalance: balanceView.okxBalance,
  });
}

export async function sendDailyReport(): Promise<void> {
  try {
    const report = await generateDailyReport();
    await broadcastMessage(report);
    logger.info('📋 Daily report sent');
  } catch (err: any) {
    logger.error(`Failed to send daily report: ${err.message}`);
  }
}
