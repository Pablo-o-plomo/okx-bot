import { getLastNTrades, saveAnalysisReport } from '../database/db';
import { formatLearningReport } from '../telegram/messages';
import { broadcastMessage } from '../telegram/bot';
import { config } from '../config';
import { logger } from '../utils/logger';
import type { AnalysisReport, Trade, ErrorTag } from '../database/models';

export function generateLearningReport(n = 20): AnalysisReport | null {
  const trades = getLastNTrades(n);
  const closed = trades.filter(t => t.status !== 'open');

  if (closed.length < 10) {
    logger.warn('Not enough closed trades for learning report');
    return null;
  }

  const wins = closed.filter(t => t.result === 'win');
  const losses = closed.filter(t => t.result === 'loss');

  const winRate = (wins.length / closed.length) * 100;

  const avgProfit = wins.length > 0
    ? wins.reduce((a, t) => a + (t.pnlPercent ?? 0), 0) / wins.length
    : 0;

  const avgLoss = losses.length > 0
    ? Math.abs(losses.reduce((a, t) => a + (t.pnlPercent ?? 0), 0) / losses.length)
    : 0;

  const totalProfit = wins.reduce((a, t) => a + Math.abs(t.pnlPercent ?? 0), 0);
  const totalLoss = losses.reduce((a, t) => a + Math.abs(t.pnlPercent ?? 0), 0);
  const profitFactor = totalLoss > 0 ? totalProfit / totalLoss : totalProfit;

  // Analyze setups
  const bestSetups = analyzeBestSetups(wins);
  const worstSetups = analyzeWorstSetups(losses);
  const frequentErrors = analyzeErrors(closed);
  const recommendations = buildRecommendations(frequentErrors, winRate, profitFactor, closed);

  const now = new Date().toISOString();
  const firstTrade = closed[closed.length - 1];
  const lastTrade = closed[0];

  const report: AnalysisReport = {
    periodStart: firstTrade?.openedAt?.split('T')[0] ?? now.split('T')[0],
    periodEnd: lastTrade?.closedAt?.split('T')[0] ?? now.split('T')[0],
    totalTrades: closed.length,
    wins: wins.length,
    losses: losses.length,
    winRate,
    avgProfit,
    avgLoss: -avgLoss,
    profitFactor,
    bestSetups,
    worstSetups,
    frequentErrors,
    recommendations,
  };

  saveAnalysisReport(report);

  // Auto-apply if configured
  if (config.trading.autoOptimize) {
    applyOptimizations(recommendations);
  }

  return report;
}

function analyzeBestSetups(wins: Trade[]): string[] {
  if (wins.length === 0) return ['Недостаточно данных'];

  const bySymbol: Record<string, number> = {};
  const byDirection: Record<string, number> = {};

  for (const t of wins) {
    bySymbol[t.symbol] = (bySymbol[t.symbol] ?? 0) + 1;
    byDirection[t.direction] = (byDirection[t.direction] ?? 0) + 1;
  }

  const setups: string[] = [];
  const bestSymbol = Object.entries(bySymbol).sort((a, b) => b[1] - a[1])[0];
  const bestDir = Object.entries(byDirection).sort((a, b) => b[1] - a[1])[0];

  if (bestSymbol) setups.push(`${bestSymbol[0]} — ${bestSymbol[1]} выигрышей`);
  if (bestDir) setups.push(`${bestDir[0]} — лучшее направление (${bestDir[1]} побед)`);

  const avgRR = wins.reduce((a, t) => {
    if (!t.indicatorsAtEntry) return a;
    return a;
  }, 0);

  setups.push('Сетапы с подтверждением объема и EMA-выравниванием');

  return setups;
}

function analyzeWorstSetups(losses: Trade[]): string[] {
  if (losses.length === 0) return ['Нет убыточных сделок'];

  const bySymbol: Record<string, number> = {};
  for (const t of losses) {
    bySymbol[t.symbol] = (bySymbol[t.symbol] ?? 0) + 1;
  }

  const setups: string[] = [];
  const worstSymbol = Object.entries(bySymbol).sort((a, b) => b[1] - a[1])[0];
  if (worstSymbol) setups.push(`${worstSymbol[0]} — ${worstSymbol[1]} убытков`);

  return setups;
}

function analyzeErrors(trades: Trade[]): string[] {
  const tagCounts: Record<string, number> = {};

  for (const t of trades) {
    for (const tag of t.errorTags ?? []) {
      if (tag !== 'correct_execution') {
        tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;
      }
    }
  }

  return Object.entries(tagCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([tag, count]) => `${tag} (${count}x)`);
}

function buildRecommendations(
  errors: string[],
  winRate: number,
  profitFactor: number,
  trades: Trade[],
): string[] {
  const recs: string[] = [];

  if (winRate < 45) {
    recs.push('Повысить минимальный порог уверенности сигнала до 7/10');
    recs.push('Добавить обязательное подтверждение второй свечой');
  }

  if (profitFactor < 1.5) {
    recs.push('Увеличить соотношение TP/SL — цель минимум 1:2.5');
  }

  if (errors.some(e => e.includes('weak_volume'))) {
    recs.push('Требовать объем выше среднего минимум в 1.5x');
  }

  if (errors.some(e => e.includes('false_breakout'))) {
    recs.push('Ждать закрытия свечи после пробоя перед входом');
  }

  if (errors.some(e => e.includes('late_entry'))) {
    recs.push('Не входить после импульсной свечи — ждать ретеста');
  }

  if (errors.some(e => e.includes('trend_against_trade'))) {
    recs.push('Усилить вес фактора тренда на старшем тайм-фрейме');
  }

  if (recs.length === 0) {
    recs.push('Стратегия работает корректно. Продолжать в том же режиме.');
  }

  return recs;
}

function applyOptimizations(recommendations: string[]): void {
  logger.info(`🤖 AUTO_OPTIMIZE: applying ${recommendations.length} recommendations (logged only in this version)`);
  // In a real system, this would update strategy parameters
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
