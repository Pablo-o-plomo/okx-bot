import { getCandles } from '../okx/market';
import { computeIndicators, findLevels, detectBreakout, volumeAnalysis } from './indicators';
import { config } from '../config';
import { logger } from '../utils/logger';
import { recordReject } from '../database/db';
import type { Signal, Direction } from '../database/models';
import { scoreSignalConfidence } from './confidenceScore';
import { antiFomoFilter } from './filters/antiFomoFilter';
import { volatilityFilter } from './filters/volatilityFilter';
import { volumeFilter } from './filters/volumeFilter';

function qualityConfidenceThreshold(): number {
  const modeThreshold = config.trading.qualityMode === 'low'
    ? 5
    : config.trading.qualityMode === 'normal'
      ? 6
      : 7;
  return process.env.MIN_SIGNAL_CONFIDENCE
    ? Math.max(modeThreshold, config.trading.minSignalConfidence)
    : modeThreshold;
}

function reject(symbol: string, timeframe: string, reason: string, details?: string): null {
  logger.info(`⛔ Signal rejected ${symbol}: ${reason}${details ? ` (${details})` : ''}`);
  try { recordReject(symbol, timeframe, reason, details); } catch { /* database may not be initialized in isolated tests */ }
  return null;
}

export async function analyzeSymbol(symbol: string): Promise<Signal | null> {
  try {
    const [primaryTf, confirmTf, trendTf] = config.trading.timeframes;
    const [pC, cC, tC] = await Promise.all([
      getCandles(symbol, primaryTf, 200),
      getCandles(symbol, confirmTf, 120),
      getCandles(symbol, trendTf || confirmTf, 120),
    ]);

    const primary = computeIndicators(pC, primaryTf);
    const confirm = computeIndicators(cC, confirmTf);
    const trend = computeIndicators(tC, trendTf || confirmTf);
    if (!primary || !confirm || !trend) return reject(symbol, primaryTf, 'not_enough_data');

    const levels = findLevels(pC, 80);
    const vol = volumeAnalysis(pC, 20);
    const volumeMultiplier = Number.isFinite(vol.ratio) ? vol.ratio : 0;

    for (const direction of ['LONG', 'SHORT'] as Direction[]) {
      const breakout = detectBreakout(pC, levels, direction);
      const atrPercent = (primary.atr / primary.price) * 100;

      const stopLoss = direction === 'LONG' ? primary.price - primary.atr * 1.5 : primary.price + primary.atr * 1.5;
      const tp1 = direction === 'LONG' ? primary.price + primary.atr * 1.5 : primary.price - primary.atr * 1.5;
      const tp2 = direction === 'LONG' ? primary.price + primary.atr * 3 : primary.price - primary.atr * 3;
      const tp3 = direction === 'LONG' ? primary.price + primary.atr * 5 : primary.price - primary.atr * 5;
      const rr = Math.abs(tp2 - primary.price) / Math.abs(primary.price - stopLoss);

      const confidencePack = scoreSignalConfidence({
        direction,
        primary,
        confirm,
        trend,
        volumeRatio: volumeMultiplier,
        atrPercent,
        breakoutConfirmed: breakout.isBreakout && !breakout.isFalse,
        riskReward: rr,
      });

      const minConfidence = qualityConfidenceThreshold();
      if (confidencePack.score < minConfidence) {
        recordReject(symbol, primaryTf, 'low_confidence', `${confidencePack.score}/${minConfidence}`);
        continue;
      }
      if (rr < 2) {
        recordReject(symbol, primaryTf, 'bad_risk_reward', rr.toFixed(2));
        continue;
      }

      const volume = volumeFilter(volumeMultiplier);
      if (!volume.pass) {
        recordReject(symbol, primaryTf, volume.rejectReason || 'weak_volume', `x${volume.multiplier.toFixed(2)}`);
        continue;
      }

      if ((direction === 'SHORT' && primary.rsi < 25) || (direction === 'LONG' && primary.rsi > 75)) {
        recordReject(symbol, primaryTf, 'extreme_rsi', primary.rsi.toFixed(2));
        continue;
      }

      const volCheck = volatilityFilter(atrPercent);
      if (!volCheck.pass) {
        recordReject(symbol, primaryTf, 'volatility_filter', volCheck.reason);
        continue;
      }

      const last = pC[pC.length - 1];
      const bodyAtr = primary.atr > 0 ? Math.abs(last.close - last.open) / primary.atr : 0;
      const moveAfter = breakout.isBreakout ? Math.abs(last.close - breakout.level) / breakout.level * 100 : 0;
      const fomo = antiFomoFilter({
        direction,
        price: primary.price,
        ema20: primary.ema20,
        atrPercent,
        candleBodyPercent: bodyAtr,
        movedAfterBreakoutPercent: moveAfter,
        riskReward: rr,
      });
      if (!fomo.pass) {
        recordReject(symbol, primaryTf, 'fomo_entry', fomo.reason);
        continue;
      }

      const warnings = [...volume.warnings];
      if (direction === 'LONG' && primary.rsi > 70) warnings.push('Рынок перекуплен — возможен резкий откат');
      if (direction === 'SHORT' && primary.rsi < 30) warnings.push('Рынок перепродан — возможен резкий отскок');

      return {
        symbol,
        direction,
        entryPrice: primary.price,
        stopLoss,
        takeProfit1: tp1,
        takeProfit2: tp2,
        takeProfit3: tp3,
        riskPercent: parseFloat((Math.abs(primary.price - stopLoss) / primary.price * 100).toFixed(2)),
        positionSize: 0,
        leverage: symbol.endsWith('-SWAP') ? 5 : 1,
        riskReward: parseFloat(rr.toFixed(2)),
        confidence: confidencePack.score,
        reasons: confidencePack.reasons,
        warnings,
        timeframeConfirmations: [primaryTf, confirmTf, trendTf || confirmTf],
        indicatorSummary: {
          ema20: primary.ema20,
          ema50: primary.ema50,
          ema200: primary.ema200,
          emaAlignment: `${primary.ema20.toFixed(2)} / ${primary.ema50.toFixed(2)} / ${primary.ema200.toFixed(2)}`,
          rsi: primary.rsi,
          rsiState: primary.rsi.toFixed(1),
          macd: primary.macdHistogram > 0 ? 'bullish' : primary.macdHistogram < 0 ? 'bearish' : 'neutral',
          macdState: primary.macdHistogram.toFixed(4),
          atr: primary.atr,
          atrPercent: parseFloat(atrPercent.toFixed(2)),
          volumeRatio: parseFloat(volumeMultiplier.toFixed(2)),
          volumeState: volume.state,
        },
        cancelConditions: [
          direction === 'LONG' ? 'Закрытие ниже EMA50' : 'Закрытие выше EMA50',
          'Объем падает ниже среднего',
          'Ложный пробой подтвержден',
        ],
        timeframe: primaryTf,
        status: 'pending',
        indicators: primary,
      };
    }
    return null;
  } catch (e: any) {
    logger.error(`Error analyzing ${symbol}: ${e.message}`);
    return null;
  }
}
