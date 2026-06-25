export declare class OKXClient {
    private http;
    private isDemo;
    private hasCredentials;
    constructor();
    private getHeaders;
    publicGet<T = any>(path: string, params?: Record<string, string>): Promise<T>;
    privateGet<T = any>(path: string, params?: Record<string, string>): Promise<T>;
    privatePost<T = any>(path: string, body: Record<string, unknown>): Promise<T>;
    private withRetry;
}
export declare const okxClient: OKXClient;
//# sourceMappingURL=client.d.ts.map