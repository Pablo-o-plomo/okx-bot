import Database from 'better-sqlite3';
import type { Signal, Trade, AnalysisReport, BotState, ErrorTag } from './models';
export declare function getDb(): Database.Database;
export declare function initDb(): void;
export declare function saveSignal(signal: Signal): number;
export declare function getRecentSignals(limit?: number): Signal[];
export declare function saveTrade(trade: Trade): number;
export declare function closeTrade(id: number, exitPrice: number, status: string, result: string, pnlPercent: number, pnlUsdt: number, exitReason: string, exitAnalysis: string, improvements: string[], errorTags: ErrorTag[]): void;
export declare function updateTradeStopLoss(id: number, stopLoss: number): void;
export declare function updateTradeTpHit(id: number, tpLevel: 1 | 2 | 3): void;
export declare function updateTradeExcursion(id: number, maxProfitPercent: number, maxDrawdownPercent: number): void;
export declare function getOpenTrades(): Trade[];
export declare function getOpenTradeBySymbol(symbol: string): Trade | null;
export declare function getTradeById(id: number): Trade | null;
export declare function getLastNTrades(n: number): Trade[];
export declare function getTodayTrades(): Trade[];
export declare function getTodayClosedTrades(): Trade[];
export declare function updateTradeSlAlgoId(tradeId: number, algoId: string | null): void;
export declare function updateTradePartialClose(tradeId: number, tpLevel: 1 | 2, closedSize: number, pnlUsdt: number, remainingSize: number): void;
export declare function saveAnalysisReport(report: AnalysisReport): void;
export declare function getBotState(): BotState;
export declare function getPaperTradingBalance(): number;
export declare function updateBotState(partial: Partial<BotState>): void;
/**
 * Returns the max trade ID that was current when the last learning analysis ran.
 * Zero if analysis has never run (new bot or first start).

 */
export declare function getLastAnalyzedTradeId(): number;
/**
 * Persists the max trade ID seen at the time of a completed learning analysis.
 */
export declare function setLastAnalyzedTradeId(tradeId: number): void;
/**
 * Counts closed trades (status != 'open') with id > sinceTradeId.
 */
export declare function countNewClosedTrades(sinceTradeId: number): number;
/**
 * Returns the highest ID among all closed trades, or 0 if none exist.
 */
export declare function getMaxClosedTradeId(): number;
//# sourceMappingURL=db.d.ts.map