import type { Signal } from '../database/models';
/**
 * Analyze one symbol across all configured timeframes.
 * Returns a signal if confidence threshold is met.
 */
export declare function analyzeSymbol(symbol: string): Promise<Signal | null>;
//# sourceMappingURL=signalEngine.d.ts.map