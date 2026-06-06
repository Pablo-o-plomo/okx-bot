// ─── Candle ───────────────────────────────────────────────────────────────────
export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// ─── Signal ───────────────────────────────────────────────────────────────────
export type Direction = 'LONG' | 'SHORT';
export type SignalStatus = 'pending' | 'active' | 'cancelled' | 'expired';

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
  cancelConditions: string[];
  timeframe: string;
  status: SignalStatus;
  createdAt?: string;
  // Indicator snapshot
  indicators?: IndicatorSnapshot;
}

// ─── Trade ────────────────────────────────────────────────────────────────────
export type TradeStatus = 'open' | 'closed_tp1' | 'closed_tp2' | 'closed_tp3' | 'closed_sl' | 'closed_manual';
export type TradeResult = 'win' | 'loss' | 'breakeven';
export type MarketPhase = 'TREND_UP' | 'TREND_DOWN' | 'RANGE' | 'BREAKOUT' | 'HIGH_VOLATILITY' | 'UNKNOWN';

export interface Trade {
  id?: number;
  signalId: number;
  symbol: string;
  direction: Direction;
  entryPrice: number;
  exitPrice?: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  takeProfit3: number;
  tp1Hit?: boolean;
  tp2Hit?: boolean;
  tp3Hit?: boolean;
  tp1HitAt?: string | null;
  tp2HitAt?: string | null;
  tp3HitAt?: string | null;
  maxProfitPercent?: number;
  maxDrawdownPercent?: number;
  holdingTimeMinutes?: number | null;
  marketPhase?: MarketPhase;
  signalConfidence?: number;
  scannerScore?: number;
  volumeRatio?: number;
  atrAtEntry?: number;
  rsiAtEntry?: number;
  trendStrength?: number;
  positionSize: number;
  leverage: number;
  status: TradeStatus;
  result?: TradeResult;
  pnlPercent?: number;
  pnlUsdt?: number;
  entryReasons: string[];
  exitReason?: string;
  exitAnalysis?: string;
  improvements?: string[];
  errorTags?: ErrorTag[];
  indicatorsAtEntry?: IndicatorSnapshot;
  openedAt?: string;
  closedAt?: string;
}

// ─── Indicator Snapshot ───────────────────────────────────────────────────────
export interface IndicatorSnapshot {
  price: number;
  ema20: number;
  ema50: number;
  ema200: number;
  rsi: number;
  macdLine: number;
  macdSignal: number;
  macdHistogram: number;
  atr: number;
  volumeAvg: number;
  volumeCurrent: number;
  trend: 'bullish' | 'bearish' | 'neutral';
  timeframe: string;
  timestamp: number;
}

// ─── Error Tags ───────────────────────────────────────────────────────────────
export type ErrorTag =
  | 'late_entry'
  | 'weak_volume'
  | 'false_breakout'
  | 'bad_risk_reward'
  | 'trend_against_trade'
  | 'overtrading'
  | 'news_volatility'
  | 'stop_too_tight'
  | 'stop_too_wide'
  | 'missed_target'
  | 'early_exit'
  | 'correct_execution';

// ─── Analysis Report ──────────────────────────────────────────────────────────
export interface AnalysisReport {
  id?: number;
  periodStart: string;
  periodEnd: string;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  avgProfit: number;
  avgLoss: number;
  profitFactor: number;
  bestSetups: string[];
  worstSetups: string[];
  frequentErrors: string[];
  recommendations: string[];
  learning?: LearningEngineStats;
  createdAt?: string;
}

export interface LearningEngineStats {
  closedTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  tpStats: {
    tp1ReachPercent: number;
    tp2ReachPercent: number;
    tp3ReachPercent: number;
  };
  bestSetups: Array<{ name: string; winRate: number; trades: number }>;
  worstSetups: Array<{ name: string; winRate: number; trades: number }>;
  bestMarketPhases: Array<{ phase: string; winRate: number; trades: number }>;
  worstMarketPhases: Array<{ phase: string; winRate: number; trades: number }>;
  commonErrors: Array<{ name: string; count: number }>;
  quality: {
    averageConfidence: number | null;
    winningConfidence: number | null;
    losingConfidence: number | null;
    averageHoldingMinutes: number | null;
    averageDrawdownPercent: number | null;
    averageMaxProfitPercent: number | null;
  };
  recommendations: AutoOptimizeRecommendations;
  selfLearning: {
    status: 'OFF';
    reason: string;
    collectedTrades: number;
    requiredTrades: number;
  };
  missingFields: string[];
}

export interface LearningDashboard {
  closedTrades: number;
  winRate: number;
  bestSetup: string;
  worstSetup: string;
  tp1ReachPercent: number;
  tp2ReachPercent: number;
  tp3ReachPercent: number;
  topError: string;
  selfLearning: LearningEngineStats['selfLearning'];
}

export interface StrategyAdjustments {
  minConfidence?: number;
  atrMultiplier?: number;
  tpMultiplier?: number;
  blockedSetups: string[];
  preferredMarketPhases: MarketPhase[];
  disabledSymbols: string[];
  reducedRiskSymbols: string[];
}

export interface LearningProfile {
  collectedTrades: number;
  requiredTrades: number;
  selfLearningEnabled: boolean;
  safeModeReason: string;
  candidateAdjustments: StrategyAdjustments;
}

export interface AutoOptimizeRecommendations {
  items: string[];
  profile: LearningProfile;
}

// ─── Bot State ────────────────────────────────────────────────────────────────
export interface BotState {
  isPaused: boolean;
  pausedUntil?: string;
  pauseReason?: string;
  consecutiveLosses: number;
  dailyLossPercent: number;
  lastDailyReset: string;
  totalBalance: number;
  mode: 'demo' | 'live';
}
