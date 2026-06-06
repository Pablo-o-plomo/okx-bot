import { getBotState, getPaperTradingBalance } from '../database/db';
import { getOkxAccountBalance } from '../okx/trading';
import { config } from '../config';

export interface BalanceView {
  okxApiMode: 'LIVE' | 'DEMO';
  tradeMode: 'PAPER' | 'LIVE';
  autoTrade: boolean;
  tradingBalance: number;
  paperBalance?: number;
  okxBalance?: number | null;
}

export async function getTradingBalance(): Promise<number> {
  if (!config.trading.isLive) {
    return getPaperTradingBalance();
  }

  const okxBalance = await getOkxAccountBalance();
  if (okxBalance !== null) return okxBalance;

  const state = getBotState();
  return state.totalBalance > 0 ? state.totalBalance : config.trading.paperStartBalance;
}

export async function getBalanceView(): Promise<BalanceView> {
  const tradingBalance = await getTradingBalance();

  if (!config.trading.isLive) {
    return {
      okxApiMode: config.okx.isDemo ? 'DEMO' : 'LIVE',
      tradeMode: 'PAPER',
      autoTrade: config.trading.autoTrade,
      tradingBalance,
      paperBalance: tradingBalance,
      okxBalance: await getOkxAccountBalance(),
    };
  }

  return {
    okxApiMode: config.okx.isDemo ? 'DEMO' : 'LIVE',
    tradeMode: 'LIVE',
    autoTrade: config.trading.autoTrade,
    tradingBalance,
    okxBalance: tradingBalance,
  };
}

export async function getDisplayBalance(): Promise<number | null> {
  return getTradingBalance();
}

export async function getOkxReferenceBalance(): Promise<number | null> {
  return getOkxAccountBalance();
}
