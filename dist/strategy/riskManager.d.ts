import type { Signal, Trade } from '../database/models';
export interface RiskCheck {
    allowed: boolean;
    reason?: string;
}
export interface DailyRiskSnapshot {
    tradingDay: string;
    dailyPnlPercent: number;
    dailyLossPercent: number;
    closedTradesCount: number;
    trades: Trade[];
    isLimitReached: boolean;
    mode: 'PAPER' | 'LIVE';
    behavior: 'OFF' | 'WARNING ONLY' | 'AUTO PAUSE';
}
export interface RiskGuardSettings {
    riskGuardEnabled: boolean;
    autoPauseOnLimit: boolean;
    riskPerTrade: number;
    maxDailyLoss: number;
    maxLossStreak: number;
}
export declare function getRiskGuardSettings(): RiskGuardSettings;
export declare function toggleAutoPauseOnLimit(): boolean;
export declare function getDailyRiskSnapshot(): DailyRiskSnapshot;
/**
 * Run all risk management checks before accepting a signal.
 */
export declare function checkRisk(signal: Signal): Promise<RiskCheck>;
/**
 * Calculate position size based on account balance and risk %.
 *
 * For USDT-SWAP: returns number of contracts
 *   contracts = riskUsdt / (|entry - stopLoss| * ctVal)
 *   floored to lotSz, clamped to minSz.
 *
 * For SPOT: returns base asset quantity
 *   size = riskUsdt / |entry - stopLoss|
 */
export declare function calculatePositionSize(signal: Signal): Promise<number>;
/**
 * Called after a trade closes. Updates counters and checks daily realized loss.
 */
export declare function recordTradeResult(pnlPercent: number): void;
/**
 * Manual pause/resume.
 */
export declare function pauseBot(reason?: string): void;
export declare function resumeBot(): void;
export declare function resetDailyRiskLock(): DailyRiskSnapshot;
//# sourceMappingURL=riskManager.d.ts.map