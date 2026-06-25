export declare const config: {
    readonly telegram: {
        readonly botToken: string;
        readonly chatId: string;
        readonly adminId: string;
    };
    readonly okx: {
        readonly apiKey: string;
        readonly apiSecret: string;
        readonly passphrase: string;
        readonly baseUrl: "https://www.okx.com";
        readonly isDemo: boolean;
    };
    readonly trading: {
        readonly mode: "paper" | "live";
        readonly isLive: boolean;
        readonly autoTrade: boolean;
        readonly riskGuardEnabled: boolean;
        readonly autoPauseOnLimit: boolean;
        readonly paperStartBalance: number;
        readonly symbols: string[];
        readonly timeframes: string[];
        readonly riskPerTrade: number;
        readonly maxDailyLoss: number;
        readonly maxOpenPositions: number;
        readonly maxLossesInRow: number;
        readonly minSignalConfidence: number;
        readonly autoOptimize: boolean;
    };
    readonly database: {
        readonly url: string;
    };
    readonly server: {
        readonly port: number;
    };
};
export type Config = typeof config;
//# sourceMappingURL=config.d.ts.map