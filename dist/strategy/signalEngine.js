"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeSymbol = analyzeSymbol;
const market_1 = require("../okx/market");
const indicators_1 = require("./indicators");
const config_1 = require("../config");
const logger_1 = require("../utils/logger");
const MIN_RR = 2.0; // Minimum risk/reward ratio
const MIN_CONFIDENCE = config_1.config.trading.minSignalConfidence;
/**
 * Analyze one symbol across all configured timeframes.
 * Returns a signal if confidence threshold is met.
 */
async function analyzeSymbol(symbol) {
    try {
        const [primaryTf, confirmTf, trendTf] = config_1.config.trading.timeframes;
        // Fetch candles for all timeframes
        const [primaryCandles, confirmCandles, trendCandles] = await Promise.all([
            (0, market_1.getCandles)(symbol, primaryTf, 200),
            (0, market_1.getCandles)(symbol, confirmTf, 100),
            (0, market_1.getCandles)(symbol, trendTf || confirmTf, 100),
        ]);
        if (primaryCandles.length < 50) {
            logger_1.logger.warn(`Not enough candles for ${symbol}`);
            return null;
        }
        const primaryIndicators = (0, indicators_1.computeIndicators)(primaryCandles, primaryTf);
        const confirmIndicators = (0, indicators_1.computeIndicators)(confirmCandles, confirmTf);
        const trendIndicators = (0, indicators_1.computeIndicators)(trendCandles, trendTf || confirmTf);
        if (!primaryIndicators || !confirmIndicators || !trendIndicators)
            return null;
        const levels = (0, indicators_1.findLevels)(primaryCandles, 80);
        const vol = (0, indicators_1.volumeAnalysis)(primaryCandles, 20);
        // Try LONG first, then SHORT
        for (const direction of ['LONG', 'SHORT']) {
            const signal = evaluateSignal(symbol, direction, primaryTf, primaryIndicators, confirmIndicators, trendIndicators, primaryCandles, levels, vol);
            if (signal)
                return signal;
        }
        return null;
    }
    catch (err) {
        logger_1.logger.error(`Error analyzing ${symbol}: ${err.message}`);
        return null;
    }
}
function evaluateSignal(symbol, direction, timeframe, primary, confirm, trend, candles, levels, vol) {
    const price = primary.price;
    const factors = [];
    if (direction === 'LONG') {
        // ── Trend factors ──
        factors.push({
            met: primary.ema200 !== null && primary.price > primary.ema200,
            weight: 2,
            description: primary.ema200 !== null ? 'Цена выше EMA 200' : 'EMA 200 недоступна (мало свечей)',
        });
        factors.push({
            met: primary.ema20 > primary.ema50,
            weight: 1,
            description: 'EMA 20 выше EMA 50 (бычье выравнивание)',
        });
        factors.push({
            met: trend.trend === 'bullish',
            weight: 2,
            description: `Старший тайм-фрейм (${trend.timeframe}) в восходящем тренде`,
        });
        // ── Momentum ──
        factors.push({
            met: primary.rsi > 45 && primary.rsi < 68,
            weight: 1,
            description: `RSI ${primary.rsi.toFixed(1)} — нет перекупленности`,
        });
        factors.push({
            met: primary.macdHistogram > 0,
            weight: 1,
            description: 'MACD гистограмма в положительной зоне',
        });
        factors.push({
            met: confirm.macdHistogram > 0,
            weight: 1,
            description: `MACD подтвержден на ${confirm.timeframe}`,
        });
        // ── Volume ──
        factors.push({
            met: vol.ratio > 1.2,
            weight: 1,
            description: `Объем выше среднего (${vol.ratio.toFixed(2)}x)`,
        });
        // ── Breakout ──
        const breakout = (0, indicators_1.detectBreakout)(candles, levels, 'LONG');
        factors.push({
            met: breakout.isBreakout && !breakout.isFalse,
            weight: 2,
            description: breakout.isBreakout
                ? `Пробой уровня сопротивления ${breakout.level.toFixed(2)}`
                : 'Пробой уровня не обнаружен',
        });
        // ── Price structure ──
        const nearSupport = levels.find(l => l.type === 'support' && Math.abs(l.price - price) / price < 0.01);
        factors.push({
            met: !!nearSupport,
            weight: 1,
            description: nearSupport
                ? `Цена у уровня поддержки ${nearSupport.price.toFixed(2)}`
                : 'Нет близкой поддержки',
        });
    }
    else {
        // ── SHORT factors ──
        factors.push({
            met: primary.ema200 !== null && primary.price < primary.ema200,
            weight: 2,
            description: primary.ema200 !== null ? 'Цена ниже EMA 200' : 'EMA 200 недоступна (мало свечей)',
        });
        factors.push({
            met: primary.ema20 < primary.ema50,
            weight: 1,
            description: 'EMA 20 ниже EMA 50 (медвежье выравнивание)',
        });
        factors.push({
            met: trend.trend === 'bearish',
            weight: 2,
            description: `Старший тайм-фрейм (${trend.timeframe}) в нисходящем тренде`,
        });
        factors.push({
            met: primary.rsi > 32 && primary.rsi < 55,
            weight: 1,
            description: `RSI ${primary.rsi.toFixed(1)} — нет перепроданности`,
        });
        factors.push({
            met: primary.macdHistogram < 0,
            weight: 1,
            description: 'MACD гистограмма в отрицательной зоне',
        });
        factors.push({
            met: confirm.macdHistogram < 0,
            weight: 1,
            description: `MACD подтвержден на ${confirm.timeframe}`,
        });
        factors.push({
            met: vol.ratio > 1.2,
            weight: 1,
            description: `Объем выше среднего (${vol.ratio.toFixed(2)}x)`,
        });
        const breakout = (0, indicators_1.detectBreakout)(candles, levels, 'SHORT');
        factors.push({
            met: breakout.isBreakout && !breakout.isFalse,
            weight: 2,
            description: breakout.isBreakout
                ? `Пробой уровня поддержки вниз ${breakout.level.toFixed(2)}`
                : 'Пробой уровня вниз не обнаружен',
        });
        const nearResistance = levels.find(l => l.type === 'resistance' && Math.abs(l.price - price) / price < 0.01);
        factors.push({
            met: !!nearResistance,
            weight: 1,
            description: nearResistance
                ? `Цена у уровня сопротивления ${nearResistance.price.toFixed(2)}`
                : 'Нет близкого сопротивления',
        });
    }
    // ── Score ──
    const maxScore = factors.reduce((a, f) => a + f.weight, 0);
    const score = factors.filter(f => f.met).reduce((a, f) => a + f.weight, 0);
    const confidence = Math.round((score / maxScore) * 10);
    if (confidence < MIN_CONFIDENCE)
        return null;
    // ── Levels ──
    const atr = primary.atr;
    let stopLoss;
    let tp1, tp2, tp3;
    if (direction === 'LONG') {
        stopLoss = price - atr * 1.5;
        tp1 = price + atr * 1.5;
        tp2 = price + atr * 3;
        tp3 = price + atr * 5;
    }
    else {
        stopLoss = price + atr * 1.5;
        tp1 = price - atr * 1.5;
        tp2 = price - atr * 3;
        tp3 = price - atr * 5;
    }
    const riskPts = Math.abs(price - stopLoss);
    const rewardPts = Math.abs(tp2 - price);
    const riskReward = rewardPts / riskPts;
    if (riskReward < MIN_RR)
        return null;
    if (riskPts / price > 0.05)
        return null; // Stop too far (>5%)
    // ── Cancel conditions ──
    const cancelConditions = direction === 'LONG'
        ? [
            `Цена вернулась ниже уровня пробоя`,
            `Объем резко упал`,
            `Закрытие свечи ниже EMA 50 (${primary.ema50.toFixed(2)})`,
            `RSI вошел в зону перекупленности (>70)`,
        ]
        : [
            `Цена вернулась выше уровня пробоя`,
            `Объем резко упал`,
            `Закрытие свечи выше EMA 50 (${primary.ema50.toFixed(2)})`,
            `RSI вошел в зону перепроданности (<30)`,
        ];
    const reasons = factors.filter(f => f.met).map(f => f.description);
    const leverage = symbol.endsWith('-SWAP') ? 5 : 1;
    const positionSize = 0; // calculated by riskManager
    return {
        symbol,
        direction,
        entryPrice: price,
        stopLoss: parseFloat(stopLoss.toFixed(6)),
        takeProfit1: parseFloat(tp1.toFixed(6)),
        takeProfit2: parseFloat(tp2.toFixed(6)),
        takeProfit3: parseFloat(tp3.toFixed(6)),
        riskPercent: config_1.config.trading.riskPerTrade,
        positionSize,
        leverage,
        riskReward: parseFloat(riskReward.toFixed(2)),
        confidence,
        reasons,
        cancelConditions,
        timeframe,
        status: 'pending',
        indicators: primary,
    };
}
//# sourceMappingURL=signalEngine.js.map