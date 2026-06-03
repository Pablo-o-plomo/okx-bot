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

function biasIcon(bias: 'bullish' | 'bearish' | 'neutral'): string {
  if (bias === 'bullish') return '🟢';
  if (bias === 'bearish') return '🔴';
  return '⚪';
}

export function analyzeInstrument(ticker: string): string {
  const normalized = normalizeTicker(ticker);
  const bias = tickerBias(ticker);
  const trend = bias === 'bullish' ? 'bullish' : bias === 'bearish' ? 'bearish' : 'neutral';
  const confidence = bias === 'bullish' ? '7.4/10' : bias === 'bearish' ? '4.2/10' : '5.6/10';
  const risk = bias === 'bullish' ? 'low/medium' : bias === 'bearish' ? 'high' : 'medium';

  return `${biasIcon(bias)} <b>${normalized} · AI ANALYSIS</b>

📈 Trend: <b>${trend}</b>
🧠 Confidence: <b>${confidence}</b>
⚠️ Risk: <b>${risk}</b>
🌊 Volatility: medium
💧 Liquidity: high

🎯 <b>Trading desk</b>
Entry: только после подтверждения объема
Stop: за технический уровень
Target: R/R не хуже 1:2

🧠 AI: ${bias === 'neutral' ? 'лучше ждать импульса и не форсировать вход.' : 'сценарий рабочий только при дисциплине по риску.'}

⚠️ Не является инвестиционной рекомендацией.`;
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
  const decisionIcon = risk.decision === 'allowed' ? '🟢' : '🔴';

  return `🧠 <b>AI TRADE REVIEW</b>

${decisionIcon} <b>${input.ticker} ${input.direction}</b>
💵 Entry: <b>${input.entryPrice}</b>
🛑 Stop: <b>${input.stopLoss}</b> · ${goodStop ? 'OK' : 'дорого'}
🎯 Target: <b>${input.takeProfit}</b> · R/R 1:${risk.riskReward.toFixed(2)} ${goodTp ? '✅' : '⚠️'}

⚠️ Risk: <b>${risk.riskRub.toFixed(0)} ₽</b> (${risk.riskPercent.toFixed(2)}%)
💸 Fees: <b>${risk.totalCommissionRub.toFixed(0)} ₽</b>
💬 Note: ${input.comment || 'нет'}

${risk.warnings.length ? `🧯 <b>Warnings</b>\n${risk.warnings.map(w => `• ${w}`).join('\n')}\n\n` : ''}🧠 AI: ${risk.decision === 'allowed' ? 'сделку можно подтвердить вручную, реальные ордера не отправляются.' : 'лучше пропустить или уменьшить размер позиции.'}

⚠️ Не является инвестиционной рекомендацией.`;
}
