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
  return `💰 <b>Комиссии БКС</b>

Обслуживание: ${config.bcs.monthlyServiceFee.toFixed(2)} ₽/мес при наличии операций
Ценные бумаги: ${config.bcs.securitiesFeePercent}% от оборота
Валюта: ${config.bcs.currencyFeePercent}% от оборота
Доп. комиссия покупки USD/EUR/HKD/GBP: ${config.bcs.extraFxBuyFeePercent}%
Фьючерсы: ${config.bcs.futuresFeeRub.toFixed(2)} ₽ за контракт
Опционы: не более ${config.bcs.optionsMaxFeePercent}% от объема сделки

Настройки редактируются через ENV.`;
}
