import type { BcsInstrumentType, BcsTradeDirection } from './db';
import { calculateBcsRisk } from './risk';

function normalizeTicker(ticker: string): string {
  return ticker.trim().toUpperCase();
}

function tickerBias(ticker: string): 'bullish' | 'bearish' | 'neutral' {
  const normalized = normalizeTicker(ticker);
  if (['SBER', 'LKOH', 'GAZP', 'IMOEX'].includes(normalized)) return 'bullish';
  if (['BR', 'GOLD', 'Si'].includes(ticker.trim())) return 'neutral';
  return 'neutral';
}

export function analyzeInstrument(ticker: string): string {
  const normalized = normalizeTicker(ticker);
  const bias = tickerBias(ticker);
  const trend = bias === 'bullish' ? 'умеренно восходящий' : bias === 'bearish' ? 'нисходящий' : 'боковой / неопределенный';
  return `📈 <b>Анализ инструмента: ${normalized}</b>

Тренд: ${trend}
Уровни: поддержка — ближайший локальный минимум, сопротивление — ближайший максимум.
Возможный вход: только после подтверждения объема и закрепления выше/ниже уровня.
Стоп: за ближайший технический уровень.
Тейк: не хуже Risk/Reward 1:2.
Риск: не более 1% депозита.
Комментарий: ${bias === 'neutral' ? 'лучше дождаться ясного сигнала' : 'сделка разрешена только при подтверждении риск-менеджмента'}.

⚠️ Это не инвестиционная рекомендация.`;
}

export interface ReviewInput {
  ticker: string;
  instrumentType: BcsInstrumentType;
  direction: BcsTradeDirection;
  entryPrice: number;
  quantity: number;
  stopLoss: number;
  takeProfit: number;
  commissionRub: number;
  depositRub: number;
  comment: string;
}

export function reviewTrade(input: ReviewInput): string {
  const risk = calculateBcsRisk(input);
  const goodStop = risk.riskPercent <= 1.5;
  const goodTp = risk.riskReward >= 2;
  return `🧠 <b>AI-разбор сделки</b>

Инструмент: ${input.ticker}
Направление: ${input.direction}
Комментарий трейдера: ${input.comment || 'нет'}

Почему вход может быть хорошим:
• Есть заранее заданные вход, стоп и тейк
• Риск можно посчитать до сделки

Риски и нарушения:
${risk.warnings.length ? risk.warnings.map(w => `• ${w}`).join('\n') : '• Критичных нарушений не найдено'}

Стоп: ${goodStop ? 'нормальный по риску' : 'слишком дорогой относительно депозита'}
Тейк: ${goodTp ? 'математически приемлемый' : 'нужно улучшить risk/reward'}
Решение: ${risk.decision === 'allowed' ? 'сделка разрешена при подтверждении рынка' : 'лучше пропустить или уменьшить позицию'}
Что улучшить: проверить ликвидность, новостной фон и не увеличивать объем после входа.

⚠️ Это не инвестиционная рекомендация.`;
}
