import type { Direction } from '../database/models';

export function decimalsForSymbol(symbol: string): number {
  if (symbol.startsWith('BTC-') || symbol.startsWith('ETH-')) return 2;
  if (symbol.startsWith('SOL-') || symbol.startsWith('TON-')) return 4;
  if (symbol.startsWith('XRP-') || symbol.startsWith('DOGE-')) return 5;
  return 6;
}

export function formatPrice(symbol: string, value: number | undefined | null): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return 'нет данных';
  return value.toFixed(decimalsForSymbol(symbol));
}

export function formatPercent(value: number | undefined | null, digits = 2): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return 'нет данных';
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}%`;
}

export function formatUnsignedPercent(value: number | undefined | null, digits = 2): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return 'нет данных';
  return `${value.toFixed(digits)}%`;
}

export function formatDirection(direction: Direction): string {
  return direction === 'LONG' ? '🟢 ЛОНГ' : '🔴 ШОРТ';
}

export function formatTradingViewSymbol(symbol: string): string {
  return `OKX:${symbol.replace('-USDT-SWAP', 'USDT.P').replace(/-/g, '')}`;
}

export function formatTradingViewLink(symbol: string): string {
  return `https://www.tradingview.com/chart/?symbol=${formatTradingViewSymbol(symbol)}`;
}
