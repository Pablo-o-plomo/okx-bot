// ─── Candle ───────────────────────────────────────────────────────────────────
export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type Direction = 'LONG' | 'SHORT';
export type SignalStatus = 'pending' | 'active' | 'cancelled' | 'expired';

export interface SignalIndicatorSummary {
  emaAlignment: string;
  rsiState: string;
  macdState: string;
  atrPercent: number;
  volumeRatio: number;
}

export interface Signal {
  id?: number;
  symbol: string;
  direction: Direction;
  entryPrice: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  takeProfit3: number;
  riskPercent: number;
  positionSize: number;
  leverage: number;
  riskReward: number;
  confidence: number;
  reasons: string[];
  warnings: string[];
  timeframeConfirmations: string[];
  indicatorSummary: SignalIndicatorSummary;
  cancelConditions: string[];
  timeframe: string;
  status: SignalStatus;
  createdAt?: string;
  indicators?: IndicatorSnapshot;
}
export type TradeStatus = 'open' | 'closed_tp1' | 'closed_tp2' | 'closed_tp3' | 'closed_sl' | 'closed_manual';
export type TradeResult = 'win' | 'loss' | 'breakeven';
export interface Trade { id?: number; signalId: number; symbol: string; direction: Direction; entryPrice: number; exitPrice?: number; stopLoss: number; takeProfit1: number; takeProfit2: number; takeProfit3: number; positionSize: number; leverage: number; status: TradeStatus; result?: TradeResult; pnlPercent?: number; pnlUsdt?: number; entryReasons: string[]; exitReason?: string; exitAnalysis?: string; improvements?: string[]; errorTags?: ErrorTag[]; indicatorsAtEntry?: IndicatorSnapshot; openedAt?: string; closedAt?: string; }
export interface IndicatorSnapshot { price: number; ema20: number; ema50: number; ema200: number; rsi: number; macdLine: number; macdSignal: number; macdHistogram: number; atr: number; volumeAvg: number; volumeCurrent: number; trend: 'bullish' | 'bearish' | 'neutral'; timeframe: string; timestamp: number; }
export type ErrorTag = 'late_entry' | 'weak_volume' | 'false_breakout' | 'bad_risk_reward' | 'trend_against_trade' | 'overtrading' | 'news_volatility' | 'stop_too_tight' | 'stop_too_wide' | 'missed_target' | 'early_exit' | 'correct_execution';
export interface AnalysisReport { id?: number; periodStart: string; periodEnd: string; totalTrades: number; wins: number; losses: number; winRate: number; avgProfit: number; avgLoss: number; profitFactor: number; bestSetups: string[]; worstSetups: string[]; frequentErrors: string[]; recommendations: string[]; createdAt?: string; }
export interface BotState { isPaused: boolean; pausedUntil?: string; pauseReason?: string; consecutiveLosses: number; dailyLossPercent: number; lastDailyReset: string; totalBalance: number; mode: 'demo' | 'live' | 'defensive'; }
