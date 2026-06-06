import { getLastNTrades, saveAnalysisReport } from '../database/db';
import { formatLearningReport } from '../telegram/messages';
import { broadcastMessage } from '../telegram/bot';
import { config } from '../config';
import { logger } from '../utils/logger';
import type {
  AnalysisReport,
  AutoOptimizeRecommendations,
  LearningDashboard,
  LearningEngineStats,
  LearningProfile,
  Trade,
} from '../database/models';

const MIN_RELIABLE_TRADES = 10;
const SELF_LEARNING_REQUIRED_TRADES = 100;

export function generateLearningReport(n = 20): AnalysisReport | null {
  const trades = getLastNTrades(n);
  const closed = trades.filter(t => t.status !== 'open');

  if (closed.length < MIN_RELIABLE_TRADES) {
    logger.warn('Not enough closed trades for learning report');
    return null;
  }

  const stats = buildLearningEngineStats(closed);
  const wins = closed.filter(t => t.result === 'win');
  const losses = closed.filter(t => t.result === 'loss');

  const avgProfit = wins.length > 0
    ? wins.reduce((a, t) => a + (t.pnlPercent ?? 0), 0) / wins.length
    : 0;

  const avgLoss = losses.length > 0
    ? Math.abs(losses.reduce((a, t) => a + (t.pnlPercent ?? 0), 0) / losses.length)
    : 0;

  const totalProfit = wins.reduce((a, t) => a + Math.abs(t.pnlPercent ?? 0), 0);
  const totalLoss = losses.reduce((a, t) => a + Math.abs(t.pnlPercent ?? 0), 0);
  const profitFactor = totalLoss > 0 ? totalProfit / totalLoss : totalProfit;

  const now = new Date().toISOString();
  const firstTrade = closed[closed.length - 1];
  const lastTrade = closed[0];

  const report: AnalysisReport = {
    periodStart: firstTrade?.openedAt?.split('T')[0] ?? now.split('T')[0],
    periodEnd: lastTrade?.closedAt?.split('T')[0] ?? now.split('T')[0],
    totalTrades: closed.length,
    wins: wins.length,
    losses: losses.length,
    winRate: stats.winRate,
    avgProfit,
    avgLoss: -avgLoss,
    profitFactor,
    bestSetups: stats.bestSetups.map(setup => `${setup.name} — Winrate: ${setup.winRate.toFixed(0)}%`),
    worstSetups: stats.worstSetups.map(setup => `${setup.name} — Winrate: ${setup.winRate.toFixed(0)}%`),
    frequentErrors: stats.commonErrors.map(error => `${error.name} (${error.count}x)`),
    recommendations: stats.recommendations.items,
    learning: stats,
  };

  saveAnalysisReport(report);

  // Auto-apply if configured. Safe mode: log only, no strategy changes.
  if (config.trading.autoOptimize) {
    applyOptimizations(stats.recommendations);
  }

  return report;
}

export function generateLearningDashboard(n = SELF_LEARNING_REQUIRED_TRADES): LearningDashboard {
  const closed = getLastNTrades(n).filter(t => t.status !== 'open');
  const stats = buildLearningEngineStats(closed);

  return {
    closedTrades: stats.closedTrades,
    winRate: stats.winRate,
    bestSetup: stats.bestSetups[0]?.name ?? 'not enough data',
    worstSetup: stats.worstSetups[0]?.name ?? 'not enough data',
    tp1ReachPercent: stats.tpStats.tp1ReachPercent,
    tp2ReachPercent: stats.tpStats.tp2ReachPercent,
    tp3ReachPercent: stats.tpStats.tp3ReachPercent,
    topError: stats.commonErrors[0]?.name ?? 'not enough data',
    selfLearning: stats.selfLearning,
  };
}

function buildLearningEngineStats(trades: Trade[]): LearningEngineStats {
  const closed = trades.filter(t => t.status !== 'open');
  const wins = closed.filter(t => t.result === 'win');
  const losses = closed.filter(t => t.result === 'loss');
  const winRate = closed.length > 0 ? (wins.length / closed.length) * 100 : 0;
  const commonErrors = analyzeErrors(closed);
  const stats: LearningEngineStats = {
    closedTrades: closed.length,
    wins: wins.length,
    losses: losses.length,
    winRate,
    tpStats: analyzeTpStats(closed),
    bestSetups: analyzeSetups(closed, 'best'),
    worstSetups: analyzeSetups(closed, 'worst'),
    bestMarketPhases: analyzeMarketPhases(closed, 'best'),
    worstMarketPhases: analyzeMarketPhases(closed, 'worst'),
    commonErrors,
    quality: analyzeTradeQuality(closed),
    recommendations: { items: [], profile: buildLearningProfile(closed) },
    selfLearning: {
      status: 'OFF',
      reason: 'Safe mode enabled',
      collectedTrades: closed.length,
      requiredTrades: SELF_LEARNING_REQUIRED_TRADES,
    },
    missingFields: collectMissingFields(closed),
  };

  stats.recommendations = buildRecommendations(stats, closed);
  return stats;
}

function analyzeTpStats(trades: Trade[]): LearningEngineStats['tpStats'] {
  const total = trades.length || 1;
  const tp1 = trades.filter(t => hasTpHit(t, 1)).length;
  const tp2 = trades.filter(t => hasTpHit(t, 2)).length;
  const tp3 = trades.filter(t => hasTpHit(t, 3)).length;

  return {
    tp1ReachPercent: (tp1 / total) * 100,
    tp2ReachPercent: (tp2 / total) * 100,
    tp3ReachPercent: (tp3 / total) * 100,
  };
}

function hasTpHit(trade: Trade, level: 1 | 2 | 3): boolean {
  if (level === 1) return !!trade.tp1Hit || !!trade.tp2Hit || !!trade.tp3Hit || ['closed_tp1', 'closed_tp2', 'closed_tp3'].includes(trade.status);
  if (level === 2) return !!trade.tp2Hit || !!trade.tp3Hit || ['closed_tp2', 'closed_tp3'].includes(trade.status);
  return !!trade.tp3Hit || trade.status === 'closed_tp3';
}

function analyzeSetups(trades: Trade[], mode: 'best' | 'worst'): Array<{ name: string; winRate: number; trades: number }> {
  const groups = groupBy(trades, t => `${compactSymbol(t.symbol)} ${t.direction}`);
  return Object.entries(groups)
    .map(([name, group]) => ({ name, trades: group.length, winRate: winRate(group) }))
    .filter(item => item.trades >= 2)
    .sort((a, b) => mode === 'best' ? b.winRate - a.winRate : a.winRate - b.winRate)
    .slice(0, 3);
}

function analyzeMarketPhases(trades: Trade[], mode: 'best' | 'worst'): Array<{ phase: string; winRate: number; trades: number }> {
  const known = trades.filter(t => t.marketPhase && t.marketPhase !== 'UNKNOWN');
  const groups = groupBy(known, t => t.marketPhase ?? 'UNKNOWN');
  return Object.entries(groups)
    .map(([phase, group]) => ({ phase, trades: group.length, winRate: winRate(group) }))
    .filter(item => item.trades >= 2)
    .sort((a, b) => mode === 'best' ? b.winRate - a.winRate : a.winRate - b.winRate)
    .slice(0, 3);
}

function analyzeErrors(trades: Trade[]): Array<{ name: string; count: number }> {
  const tagCounts: Record<string, number> = {};
  for (const t of trades) {
    for (const tag of t.errorTags ?? []) {
      if (tag !== 'correct_execution') tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;
    }
  }

  return Object.entries(tagCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => ({ name, count }));
}

function analyzeTradeQuality(trades: Trade[]): LearningEngineStats['quality'] {
  const wins = trades.filter(t => t.result === 'win');
  const losses = trades.filter(t => t.result === 'loss');

  return {
    averageConfidence: average(trades.map(t => t.signalConfidence).filter(isPositiveNumber)),
    winningConfidence: average(wins.map(t => t.signalConfidence).filter(isPositiveNumber)),
    losingConfidence: average(losses.map(t => t.signalConfidence).filter(isPositiveNumber)),
    averageHoldingMinutes: average(trades.map(t => t.holdingTimeMinutes).filter(isPositiveNumber)),
    averageDrawdownPercent: average(trades.map(t => t.maxDrawdownPercent).filter(isPositiveNumber)),
    averageMaxProfitPercent: average(trades.map(t => t.maxProfitPercent).filter(isPositiveNumber)),
  };
}

function buildRecommendations(stats: LearningEngineStats, trades: Trade[]): AutoOptimizeRecommendations {
  if (trades.length < MIN_RELIABLE_TRADES) {
    return {
      items: ['Need more closed trades for reliable recommendations.'],
      profile: buildLearningProfile(trades),
    };
  }

  const items: string[] = [];
  const lowConfidenceTrades = trades.filter(t => (t.signalConfidence ?? 0) > 0 && (t.signalConfidence ?? 0) < 7);
  if (lowConfidenceTrades.length >= 2 && winRate(lowConfidenceTrades) < stats.winRate) {
    items.push('Avoid confidence below 7');
  }

  if (stats.commonErrors.some(error => error.name === 'weak_volume')) {
    items.push('Avoid low volume entries');
  }

  const worstSetup = stats.worstSetups[0];
  if (worstSetup && worstSetup.winRate < 45) {
    items.push(`${worstSetup.name} setups underperform`);
  }

  const bestPhase = stats.bestMarketPhases[0];
  const worstPhase = stats.worstMarketPhases[0];
  if (bestPhase && worstPhase && bestPhase.phase !== worstPhase.phase) {
    items.push(`${bestPhase.phase} entries outperform ${worstPhase.phase} entries`);
  }

  if (stats.tpStats.tp1ReachPercent >= 60 && stats.tpStats.tp3ReachPercent < 30) {
    items.push('TP1 is reached often, but TP3 rarely reached');
  }

  if ((stats.quality.averageDrawdownPercent ?? 0) > 2) {
    items.push('Average drawdown before profit is too high');
  }

  if (items.length === 0) items.push('Need more closed trades for reliable recommendations.');

  return { items, profile: buildLearningProfile(trades) };
}

function buildLearningProfile(trades: Trade[]): LearningProfile {
  const stats = trades.length > 0 ? analyzeSetups(trades, 'worst') : [];
  return {
    collectedTrades: trades.length,
    requiredTrades: SELF_LEARNING_REQUIRED_TRADES,
    selfLearningEnabled: false,
    safeModeReason: 'Safe mode enabled',
    candidateAdjustments: {
      minConfidence: undefined,
      atrMultiplier: undefined,
      tpMultiplier: undefined,
      blockedSetups: stats.filter(s => s.winRate < 35).map(s => s.name),
      preferredMarketPhases: [],
      disabledSymbols: [],
      reducedRiskSymbols: [],
    },
  };
}

function applyOptimizations(recommendations: AutoOptimizeRecommendations): void {
  logger.info(`🤖 AUTO_OPTIMIZE: ${recommendations.items.length} recommendations generated (safe mode: no strategy changes applied)`);
}

export async function runLearningAnalysis(): Promise<void> {
  try {
    const report = generateLearningReport(20);
    if (report) {
      await broadcastMessage(formatLearningReport(report));
      logger.info('🧠 Learning report sent');
    }
  } catch (err: any) {
    logger.error(`Learning report error: ${err.message}`);
  }
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Record<string, T[]> {
  return items.reduce<Record<string, T[]>>((groups, item) => {
    const key = keyFn(item);
    groups[key] = groups[key] ?? [];
    groups[key].push(item);
    return groups;
  }, {});
}

function winRate(trades: Trade[]): number {
  return trades.length > 0 ? (trades.filter(t => t.result === 'win').length / trades.length) * 100 : 0;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function isPositiveNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && value > 0;
}

function compactSymbol(symbol: string): string {
  return symbol.replace(/-USDT-SWAP$/, '').replace(/-USDT$/, '');
}

function collectMissingFields(trades: Trade[]): string[] {
  const missing = new Set<string>();
  if (trades.some(t => !t.signalConfidence)) missing.add('signalConfidence');
  if (trades.some(t => !t.volumeRatio)) missing.add('volumeRatio');
  if (trades.some(t => !t.atrAtEntry)) missing.add('atrAtEntry');
  if (trades.some(t => !t.rsiAtEntry)) missing.add('rsiAtEntry');
  if (trades.some(t => !t.trendStrength)) missing.add('trendStrength');
  if (trades.some(t => !t.marketPhase || t.marketPhase === 'UNKNOWN')) missing.add('marketPhase');
  return Array.from(missing);
}
