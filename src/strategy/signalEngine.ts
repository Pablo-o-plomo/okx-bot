import { getCandles } from '../okx/market';
import { computeIndicators, findLevels, detectBreakout, volumeAnalysis } from './indicators';
import { config } from '../config';
import { logger } from '../utils/logger';
import type { Signal, Direction } from '../database/models';
import { scoreSignalConfidence } from './confidenceScore';
import { antiFomoFilter } from './filters/antiFomoFilter';
import { volatilityFilter } from './filters/volatilityFilter';

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
    if (!primary || !confirm || !trend) return null;

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

      if (confidencePack.score < config.trading.minSignalConfidence) continue;
      if (rr < 2) continue;
      if (volumeMultiplier < 0.5) {
        logger.info(`Volume reject ${symbol}: multiplier=${volumeMultiplier.toFixed(2)}`);
        continue;
      }
      if ((direction === 'SHORT' && primary.rsi < 25) || (direction === 'LONG' && primary.rsi > 75)) {
        logger.info(`RSI hard reject ${symbol} ${direction}: rsi=${primary.rsi.toFixed(2)}`);
        continue;
      }

      const volCheck = volatilityFilter(atrPercent);
      if (!volCheck.pass) {
        logger.info(`Volatility reject ${symbol}: ${volCheck.reason}`);
        continue;
      }

      const last = pC[pC.length - 1];
      const bodyPct = Math.abs(last.close - last.open) / last.open * 100;
      const moveAfter = breakout.isBreakout ? Math.abs(last.close - breakout.level) / breakout.level * 100 : 0;
      const fomo = antiFomoFilter({
        direction,
        price: primary.price,
        ema20: primary.ema20,
        atrPercent,
        candleBodyPercent: bodyPct,
        movedAfterBreakoutPercent: moveAfter,
        riskReward: rr,
      });
      if (!fomo.pass) {
        logger.info(`Anti-FOMO reject ${symbol}: ${fomo.reason}`);
        continue;
      }

      const warnings: string[] = [];
      if (volumeMultiplier === 0) warnings.push('Volume: нет данных');
      else if (volumeMultiplier < 0.7) warnings.push('Слабый объем');
      if (direction === 'LONG' && primary.rsi > 70) warnings.push('RSI: перекупленность');
      if (direction === 'SHORT' && primary.rsi < 30) warnings.push('RSI: перепроданность, риск отскока');

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
          emaAlignment: `${primary.ema20.toFixed(2)} / ${primary.ema50.toFixed(2)} / ${primary.ema200.toFixed(2)}`,
          rsiState: primary.rsi.toFixed(1),
          macdState: primary.macdHistogram.toFixed(4),
          atrPercent: parseFloat(atrPercent.toFixed(2)),
          volumeRatio: parseFloat(volumeMultiplier.toFixed(2)),
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
