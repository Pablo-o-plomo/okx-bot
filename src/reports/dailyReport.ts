import { getTodayTrades, getBotState } from '../database/db';
import { getAccountBalance } from '../okx/trading';
import { formatDailyReport } from '../telegram/messages';
import { broadcastMessage } from '../telegram/bot';
import { logger } from '../utils/logger';

export async function generateDailyReport(): Promise<string> {
  const today = new Date().toISOString().split('T')[0];
  const trades = getTodayTrades();
  const balance = await getAccountBalance();

  // Approximate start balance (simplified)
  const totalPnlUsdt = trades.reduce((a, t) => a + (t.pnlUsdt ?? 0), 0);
  const startBalance = balance - totalPnlUsdt;

  return formatDailyReport(today, trades, balance, startBalance);
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
