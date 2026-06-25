import type { Signal, Trade, AnalysisReport, LearningDashboard } from '../database/models';
interface StatusMessageInput {
    okxApiMode: 'LIVE' | 'DEMO';
    mode: 'PAPER' | 'LIVE';
    autoTrade?: boolean;
    isPaused: boolean;
    openPositions: number;
    balance: number | null;
    okxBalance?: number | null;
    consecutiveLosses: number;
    pauseReason?: string;
    symbolsCount: number;
    timeframes: readonly string[];
    lastScan?: string;
}
interface HeartbeatInput {
    checkedSymbols: number;
    signalsFound: number;
    openPositions: number;
    lastScan?: string;
}
export declare function formatStatusMessage(input: StatusMessageInput): string;
export declare function formatSignalMessage(signal: Signal): string;
export declare function formatPositionsMessage(trades: Trade[]): string;
export declare function formatSignalsListMessage(signals: Signal[]): string;
export declare function formatTpUpdateMessage(trade: Trade, tpLevel: number, currentPrice: number, stopMovedToBreakeven?: boolean): string;
export declare function formatTradeClosedMessage(trade: Trade, improvements?: string[]): string;
export declare function formatDailyReport(date: string, trades: Trade[], balance: number | null, startBalance: number | null, options?: {
    mode?: 'PAPER' | 'LIVE';
    okxBalance?: number | null;
}): string;
export declare function formatLearningReport(report: AnalysisReport): string;
export declare function formatLearningDashboard(dashboard: LearningDashboard): string;
export declare function formatLearningInProgressMessage(completedTrades: number, requiredTrades?: number): string;
export declare function formatHeartbeatMessage(input: HeartbeatInput): string;
export declare function formatErrorAlert(error: string, context?: string): string;
export {};
//# sourceMappingURL=messages.d.ts.map