import type { BcsTrade } from '../bcs/db';

const QUICKCHART_BASE_URL = 'https://quickchart.io/chart';

type ChartConfig = Record<string, unknown>;

function chartUrl(config: ChartConfig, width = 900, height = 520): string {
  const encoded = encodeURIComponent(JSON.stringify(config));
  return `${QUICKCHART_BASE_URL}?width=${width}&height=${height}&backgroundColor=%230B1020&c=${encoded}`;
}

function rub(value: number): string {
  return `${value >= 0 ? '+' : ''}${Math.round(value).toLocaleString('ru-RU')} ₽`;
}

function pnlColor(value: number): string {
  if (value > 0) return '#22C55E';
  if (value < 0) return '#EF4444';
  return '#94A3B8';
}

function closedTrades(trades: BcsTrade[]): BcsTrade[] {
  return trades.filter(trade => trade.status === 'closed');
}

export function pnlChartUrl(trades: BcsTrade[]): string {
  const closed = closedTrades(trades).slice().reverse();
  const labels = closed.length ? closed.map(trade => `#${trade.id}`) : ['нет сделок'];
  const data = closed.length ? closed.map(trade => trade.pnlRub) : [0];
  return chartUrl({
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'P&L, ₽',
        data,
        backgroundColor: data.map(pnlColor),
        borderRadius: 8,
      }],
    },
    options: {
      plugins: {
        legend: { labels: { color: '#E5E7EB' } },
        title: { display: true, text: 'BCS Assistant · P&L', color: '#F8FAFC', font: { size: 22 } },
      },
      scales: {
        x: { ticks: { color: '#CBD5E1' }, grid: { color: 'rgba(148,163,184,0.16)' } },
        y: { ticks: { color: '#CBD5E1' }, grid: { color: 'rgba(148,163,184,0.16)' } },
      },
    },
  });
}

export function equityCurveUrl(trades: BcsTrade[], depositRub: number): string {
  let equity = depositRub;
  const closed = closedTrades(trades).slice().reverse();
  const data = closed.map(trade => {
    equity += trade.pnlRub;
    return Math.round(equity);
  });
  return chartUrl({
    type: 'line',
    data: {
      labels: data.length ? data.map((_, index) => `${index + 1}`) : ['start'],
      datasets: [{
        label: 'Equity, ₽',
        data: data.length ? data : [depositRub],
        borderColor: '#38BDF8',
        backgroundColor: 'rgba(56,189,248,0.18)',
        fill: true,
        tension: 0.36,
        pointRadius: 3,
      }],
    },
    options: {
      plugins: {
        legend: { labels: { color: '#E5E7EB' } },
        title: { display: true, text: `Equity curve · ${rub(data.at(-1) ?? depositRub)}`, color: '#F8FAFC', font: { size: 22 } },
      },
      scales: {
        x: { ticks: { color: '#CBD5E1' }, grid: { color: 'rgba(148,163,184,0.14)' } },
        y: { ticks: { color: '#CBD5E1' }, grid: { color: 'rgba(148,163,184,0.14)' } },
      },
    },
  });
}

export interface HeatmapItem {
  symbol: string;
  score: number;
  trend: string;
}

export function marketHeatmapUrl(items: HeatmapItem[]): string {
  const labels = items.map(item => item.symbol);
  const data = items.map(item => item.score);
  return chartUrl({
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Market score',
        data,
        backgroundColor: data.map(score => score >= 7 ? '#22C55E' : score >= 5 ? '#F59E0B' : '#EF4444'),
        borderRadius: 10,
      }],
    },
    options: {
      indexAxis: 'y',
      plugins: {
        legend: { display: false },
        title: { display: true, text: 'AI Market Heatmap', color: '#F8FAFC', font: { size: 22 } },
      },
      scales: {
        x: { min: 0, max: 10, ticks: { color: '#CBD5E1' }, grid: { color: 'rgba(148,163,184,0.16)' } },
        y: { ticks: { color: '#CBD5E1' }, grid: { display: false } },
      },
    },
  });
}

export function miniCandlesUrl(symbol: string, trend: 'bullish' | 'bearish' | 'neutral'): string {
  const base = trend === 'bearish' ? 100 : 92;
  const closes = Array.from({ length: 16 }, (_, index) => {
    const drift = trend === 'bullish' ? index * 0.8 : trend === 'bearish' ? -index * 0.7 : Math.sin(index) * 1.4;
    return Number((base + drift + Math.sin(index * 1.7) * 1.2).toFixed(2));
  });
  return chartUrl({
    type: 'line',
    data: {
      labels: closes.map((_, index) => `${index + 1}`),
      datasets: [{
        label: symbol,
        data: closes,
        borderColor: trend === 'bullish' ? '#22C55E' : trend === 'bearish' ? '#EF4444' : '#EAB308',
        backgroundColor: 'rgba(255,255,255,0.04)',
        tension: 0.28,
        fill: true,
        pointRadius: 0,
      }],
    },
    options: {
      plugins: {
        legend: { labels: { color: '#E5E7EB' } },
        title: { display: true, text: `${symbol} · mini candles`, color: '#F8FAFC', font: { size: 22 } },
      },
      scales: {
        x: { display: false },
        y: { ticks: { color: '#CBD5E1' }, grid: { color: 'rgba(148,163,184,0.14)' } },
      },
    },
  }, 900, 430);
}

export function aiDashboardCardUrl(metrics: { imoexGrowthProbability: number; confidence: number; risk: string; volatility: string }): string {
  return chartUrl({
    type: 'doughnut',
    data: {
      labels: ['Рост IMOEX', 'Остальное'],
      datasets: [{
        data: [metrics.imoexGrowthProbability, 100 - metrics.imoexGrowthProbability],
        backgroundColor: ['#22C55E', '#1E293B'],
        borderColor: '#0B1020',
      }],
    },
    options: {
      cutout: '70%',
      plugins: {
        legend: { labels: { color: '#E5E7EB' } },
        title: { display: true, text: `AI Dashboard · ${metrics.imoexGrowthProbability}% bullish`, color: '#F8FAFC', font: { size: 24 } },
        subtitle: { display: true, text: `Confidence ${metrics.confidence}/10 · Risk ${metrics.risk} · Volatility ${metrics.volatility}`, color: '#CBD5E1', font: { size: 15 } },
      },
    },
  }, 900, 520);
}
