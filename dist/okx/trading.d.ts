import type { Signal } from '../database/models';
export interface OrderResult {
    orderId: string;
    symbol: string;
    side: string;
    price: number;
    size: number;
    status: string;
    paper: boolean;
}
/**
 * Place order — routes to paper or live depending on config.
 */
export declare function placeOrder(signal: Signal): Promise<OrderResult>;
/**
 * Move stop loss to breakeven (live or paper).
 */
export declare function moveStopLossToBreakeven(symbol: string, direction: 'LONG' | 'SHORT', size: number, stopLoss: number): Promise<OrderResult>;
/**
 * Close a position (live or paper).
 */
export declare function closePosition(symbol: string, direction: 'LONG' | 'SHORT', size: number, price: number): Promise<OrderResult>;
/**
 * Cancel an active SL algo order on OKX.
 * No-op in paper/demo mode.
 */
export declare function cancelAlgoOrder(symbol: string, algoId: string): Promise<void>;
/**
 * Get real OKX account balance for display/reference purposes.
 */
export declare function getOkxAccountBalance(): Promise<number | null>;
/**
 * Get trading balance used by sizing/risk/execution.
 */
export declare function getAccountBalance(): Promise<number>;
/**
 * Update paper balance after trade closes.
 */
export declare function updatePaperBalance(pnlUsdt: number): void;
/**
 * Partially close an open position on OKX.
 *
 * Unlike closePosition(), this function:
 *  - accepts any size <= current open contracts (caller's responsibility)
 *  - sets reduceOnly: 'true' in live mode to prevent accidental position flip
 *
 * Not yet called from trading logic (Stage 4 will wire it to handlePartialClose).
 */
export declare function closePartialPosition(symbol: string, direction: 'LONG' | 'SHORT', size: number, price: number): Promise<OrderResult>;
//# sourceMappingURL=trading.d.ts.map