import TelegramBot from 'node-telegram-bot-api';
import type { Signal, Trade } from '../database/models';
export declare function recordScannerRun(checkedSymbols: number, signalsFound: number, openPositions: number): void;
export declare function initTelegramBot(): TelegramBot;
export declare function getBot(): TelegramBot;
export declare function broadcastSignal(signal: Signal): Promise<void>;
export declare function broadcastTradeClosed(trade: Trade, improvements?: string[]): Promise<void>;
export declare function broadcastTpHit(trade: Trade, level: number, price: number, stopMovedToBreakeven?: boolean): Promise<void>;
export declare function sendErrorAlert(error: string, context?: string): Promise<void>;
export declare function broadcastScannerHeartbeat(): Promise<void>;
export declare function broadcastMessage(text: string): Promise<void>;
//# sourceMappingURL=bot.d.ts.map