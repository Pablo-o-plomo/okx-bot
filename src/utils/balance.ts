import { getBotState } from '../database/db';
import { getAccountBalance } from '../okx/trading';
import { config } from '../config';
import { logger } from './logger';

export async function getDisplayBalance(): Promise<number | null> {
  if (!config.trading.isLive) {
    return getBotState().totalBalance;
  }

  try {
    return await getAccountBalance();
  } catch (err: any) {
    logger.warn(`Failed to fetch display balance: ${err.message}`);
    return null;
  }
}
