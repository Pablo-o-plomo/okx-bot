export interface BalanceView {
    okxApiMode: 'LIVE' | 'DEMO';
    tradeMode: 'PAPER' | 'LIVE';
    autoTrade: boolean;
    tradingBalance: number;
    paperBalance?: number;
    okxBalance?: number | null;
}
export declare function getTradingBalance(): Promise<number>;
export declare function getBalanceView(): Promise<BalanceView>;
export declare function getDisplayBalance(): Promise<number | null>;
export declare function getOkxReferenceBalance(): Promise<number | null>;
//# sourceMappingURL=balance.d.ts.map