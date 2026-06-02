import { config } from '../config';
import { calculateBcsCommission } from './commission';
import type { BcsInstrumentType, BcsTradeDirection } from './db';

export type MarketTrend = 'bullish' | 'bearish' | 'neutral';
export type MarketRisk = 'low' | 'medium' | 'high';
export type ScannerAction = 'LONG' | 'WATCH' | 'SKIP';

export interface MarketScanItem {
  symbol: string;
  action: ScannerAction;
  direction?: BcsTradeDirection;
  trend: MarketTrend;
  volatility: 'low' | 'medium' | 'high';
  momentum: number;
  confidence: number;
  risk: MarketRisk;
  commissionRub: number;
  liquidityScore: number;
  reason?: string;
  instrumentType: BcsInstrumentType;
}

export interface MarketSentiment {
  imoex: MarketTrend;
  oil: 'weak' | 'neutral' | 'strong';
  banks: 'distribution' | 'neutral' | 'accumulation';
  volatility: 'low' | 'medium' | 'high';
  imoexGrowthProbability: number;
  confidence: number;
  risk: MarketRisk;
}

function hashSymbol(symbol: string): number {
  return symbol.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

function detectInstrumentType(symbol: string): BcsInstrumentType {
  if (['BR', 'Si', 'GOLD'].includes(symbol)) return 'future';
  if (['USD', 'EUR', 'CNY'].includes(symbol)) return 'currency';
  return 'stock';
}

function trendFor(symbol: string): MarketTrend {
  const upper = symbol.toUpperCase();
  if (['SBER', 'LKOH', 'IMOEX'].includes(upper)) return 'bullish';
  if (['GAZP'].includes(upper)) return 'bearish';
  return hashSymbol(symbol) % 3 === 0 ? 'bullish' : hashSymbol(symbol) % 3 === 1 ? 'neutral' : 'bearish';
}

function colorIcon(value: number): string {
  if (value >= 7) return '🟢';
  if (value >= 5) return '🟡';
  return '🔴';
}

export function scanMarket(symbols = config.trading.symbols): MarketScanItem[] {
  return symbols.map(rawSymbol => {
    const symbol = rawSymbol.trim();
    const trend = trendFor(symbol);
    const seed = hashSymbol(symbol);
    const momentum = Math.max(2, Math.min(9.5, (trend === 'bullish' ? 7 : trend === 'neutral' ? 5 : 3) + (seed % 17) / 10));
    const volatility: MarketScanItem['volatility'] = seed % 5 === 0 ? 'high' : seed % 2 === 0 ? 'medium' : 'low';
    const liquidityScore = Math.max(4, Math.min(9.7, 9.2 - (seed % 30) / 10 + (symbol === 'SBER' ? 1 : 0)));
    const risk: MarketRisk = volatility === 'high' || liquidityScore < 5.5 ? 'high' : momentum >= 6.5 && trend === 'bullish' ? 'low' : 'medium';
    const confidence = Math.max(3, Math.min(9.6, (momentum + liquidityScore) / 2 - (risk === 'high' ? 1.2 : risk === 'medium' ? 0.3 : 0)));
    const instrumentType = detectInstrumentType(symbol);
    const commissionRub = calculateBcsCommission({ instrumentType, turnoverRub: 35_000, quantity: instrumentType === 'future' ? 1 : 100 }).totalFeeRub;
    const action: ScannerAction = confidence >= 7 && trend === 'bullish' && risk !== 'high' ? 'LONG' : confidence >= 5 ? 'WATCH' : 'SKIP';
    const direction: BcsTradeDirection | undefined = action === 'LONG' ? 'LONG' : undefined;
    return {
      symbol,
      action,
      direction,
      trend,
      volatility,
      momentum: Number(momentum.toFixed(1)),
      confidence: Number(confidence.toFixed(1)),
      risk,
      commissionRub,
      liquidityScore: Number(liquidityScore.toFixed(1)),
      reason: action === 'SKIP' ? (momentum < 5 ? 'низкий momentum' : risk === 'high' ? 'высокий риск' : 'нет преимущества') : undefined,
      instrumentType,
    };
  }).sort((a, b) => b.confidence - a.confidence);
}

export function marketSentiment(items = scanMarket()): MarketSentiment {
  const bullish = items.filter(item => item.trend === 'bullish').length;
  const bearish = items.filter(item => item.trend === 'bearish').length;
  const avgConfidence = items.reduce((sum, item) => sum + item.confidence, 0) / Math.max(1, items.length);
  const highVol = items.filter(item => item.volatility === 'high').length;
  const probability = Math.round(Math.max(35, Math.min(82, 52 + (bullish - bearish) * 7 + avgConfidence * 2)));
  return {
    imoex: bullish >= bearish ? 'bullish' : 'neutral',
    oil: items.some(item => item.symbol.toUpperCase() === 'BR' && item.confidence >= 5) ? 'strong' : 'neutral',
    banks: items.some(item => item.symbol.toUpperCase() === 'SBER' && item.confidence >= 7) ? 'accumulation' : 'neutral',
    volatility: highVol >= 2 ? 'high' : highVol === 1 ? 'medium' : 'low',
    imoexGrowthProbability: probability,
    confidence: Number(avgConfidence.toFixed(1)),
    risk: items.some(item => item.risk === 'high') ? 'medium' : 'low',
  };
}

export function formatMarketSentiment(sentiment = marketSentiment()): string {
  const riskIcon = sentiment.risk === 'low' ? '🟢' : sentiment.risk === 'medium' ? '🟡' : '🔴';
  return `🧠 <b>AI MARKET STATUS</b>

IMOEX: <b>${sentiment.imoex}</b>
Oil: <b>${sentiment.oil}</b>
Banks: <b>${sentiment.banks}</b>
Volatility: <b>${sentiment.volatility}</b>

${riskIcon} Вероятность роста IMOEX: <b>${sentiment.imoexGrowthProbability}%</b>`;
}

export function formatMarketScanner(items = scanMarket(), sentiment = marketSentiment(items)): string {
  const lines = items.slice(0, 8).map(item => {
    const icon = colorIcon(item.confidence);
    const title = item.action === 'LONG' ? `${item.symbol} LONG` : item.action === 'WATCH' ? `${item.symbol} WATCH` : `${item.symbol} SKIP`;
    const reason = item.reason ? `\nПричина: ${item.reason}` : '';
    return `${icon} <b>${title}</b>
Confidence: <b>${item.confidence}/10</b>
Trend: ${item.trend}
Volatility: ${item.volatility}
Momentum: ${item.momentum}/10
Risk: ${item.risk}
Комиссия: ~${Math.round(item.commissionRub)} ₽
Liquidity: ${item.liquidityScore}/10${reason}`;
  }).join('\n\n');

  return `📡 <b>AI MARKET SCANNER</b>

${lines}

${formatMarketSentiment(sentiment)}`;
}
