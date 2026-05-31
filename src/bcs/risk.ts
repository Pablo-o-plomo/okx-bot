import type { BcsTrade, BcsTradeDirection, BcsInstrumentType } from './db';

export interface RiskInput {
  depositRub: number;
  direction: BcsTradeDirection;
  instrumentType: BcsInstrumentType;
  entryPrice: number;
  quantity: number;
  stopLoss: number;
  takeProfit: number;
  commissionRub: number;
}

export interface RiskResult {
  positionAmountRub: number;
  riskRub: number;
  riskPercent: number;
  potentialProfitRub: number;
  riskReward: number;
  totalCommissionRub: number;
  expectedPnlRub: number;
  decision: 'allowed' | 'skip';
  warnings: string[];
}

export function calculateBcsRisk(input: RiskInput): RiskResult {
  const positionAmountRub = input.entryPrice * input.quantity;
  const riskPerUnit = input.direction === 'LONG'
    ? input.entryPrice - input.stopLoss
    : input.stopLoss - input.entryPrice;
  const profitPerUnit = input.direction === 'LONG'
    ? input.takeProfit - input.entryPrice
    : input.entryPrice - input.takeProfit;
  const riskRub = Math.max(0, riskPerUnit * input.quantity) + input.commissionRub;
  const potentialProfitRub = Math.max(0, profitPerUnit * input.quantity) - input.commissionRub;
  const riskPercent = input.depositRub > 0 ? (riskRub / input.depositRub) * 100 : 0;
  const riskReward = riskRub > 0 ? potentialProfitRub / riskRub : 0;
  const warnings: string[] = [];

  if (riskPercent > 2) warnings.push('Риск выше 2% депозита — позицию лучше уменьшить.');
  if (riskReward < 2) warnings.push('Risk/reward ниже 1:2 — сделка слабая по математике.');
  if (input.stopLoss <= 0 || input.takeProfit <= 0) warnings.push('Стоп и тейк должны быть выше нуля.');
  if (input.quantity <= 0 || input.entryPrice <= 0) warnings.push('Цена входа и количество должны быть выше нуля.');

  return {
    positionAmountRub,
    riskRub,
    riskPercent,
    potentialProfitRub,
    riskReward,
    totalCommissionRub: input.commissionRub,
    expectedPnlRub: potentialProfitRub,
    decision: warnings.length === 0 ? 'allowed' : 'skip',
    warnings,
  };
}

export function formatRub(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)} ₽`;
}

export function formatTradeLine(trade: BcsTrade): string {
  return `#${trade.id} ${trade.ticker} ${trade.direction}: ${trade.pnlPercent >= 0 ? '+' : ''}${trade.pnlPercent.toFixed(2)}% | ${formatRub(trade.pnlRub)}`;
}
