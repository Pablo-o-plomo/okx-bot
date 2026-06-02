import { config } from '../config';

export type BcsInstrumentType = 'stock' | 'future' | 'currency' | 'bond' | 'fund' | 'option';

export interface BcsCommissionInput {
  instrumentType: BcsInstrumentType;
  turnoverRub: number;
  quantity: number;
  isCurrencyBuy?: boolean;
}

export interface BcsCommissionResult {
  brokerFeeRub: number;
  extraFeeRub: number;
  totalFeeRub: number;
  comment: string;
}

export function calculateBcsCommission(input: BcsCommissionInput): BcsCommissionResult {
  const turnoverRub = Math.max(0, input.turnoverRub);
  const quantity = Math.max(1, input.quantity || 1);
  let brokerFeeRub = 0;
  let extraFeeRub = 0;
  let comment = 'Комиссия рассчитана по настройкам БКС из ENV.';

  if (input.instrumentType === 'future') {
    brokerFeeRub = config.bcs.futuresFeeRub * quantity;
    comment = 'Срочный рынок: комиссия за контракт.';
  } else if (input.instrumentType === 'option') {
    brokerFeeRub = Math.min(config.bcs.futuresFeeRub * quantity, turnoverRub * (config.bcs.optionsMaxFeePercent / 100));
    comment = 'Опционы: комиссия ограничена максимальным процентом от объема сделки.';
  } else if (input.instrumentType === 'currency') {
    brokerFeeRub = turnoverRub * (config.bcs.currencyFeePercent / 100);
    extraFeeRub = input.isCurrencyBuy ? turnoverRub * (config.bcs.extraFxBuyFeePercent / 100) : 0;
    comment = input.isCurrencyBuy ? 'Валюта: учтена дополнительная комиссия за покупку.' : 'Валюта: стандартная комиссия от оборота.';
  } else {
    brokerFeeRub = turnoverRub * (config.bcs.securitiesFeePercent / 100);
    comment = 'Ценные бумаги: комиссия от оборота.';
  }

  return {
    brokerFeeRub,
    extraFeeRub,
    totalFeeRub: brokerFeeRub + extraFeeRub,
    comment,
  };
}

export function formatBcsCommissionSettings(): string {
  return `💸 <b>BCS FEES</b>

🏦 Service: <b>${config.bcs.monthlyServiceFee.toFixed(0)} ₽/мес</b>
📈 Stocks/Funds/Bonds: <b>${config.bcs.securitiesFeePercent}%</b>
💱 FX: <b>${config.bcs.currencyFeePercent}%</b>
➕ FX buy add-on: <b>${config.bcs.extraFxBuyFeePercent}%</b>
⚡ Futures: <b>${config.bcs.futuresFeeRub.toFixed(2)} ₽/contract</b>
🧩 Options cap: <b>${config.bcs.optionsMaxFeePercent}%</b>

🧠 AI: комиссии считаются до входа и входят в риск сделки.`;
}
