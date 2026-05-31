import { getLastNTrades } from '../database/db';

export function generateErrorAnalysis(): string | null {
  const trades = getLastNTrades(20);
  if (trades.length < 20) return null;
  const losses = trades.filter(t => t.result === 'loss');
  const bySymbol: Record<string, number> = {}; const byTf: Record<string, number> = {}; const byReason: Record<string, number> = {};
  for (const t of losses) {
    bySymbol[t.symbol] = (bySymbol[t.symbol] || 0) + 1;
    for (const r of t.entryReasons || []) byReason[r] = (byReason[r] || 0) + 1;
    const tf = t.indicatorsAtEntry?.timeframe || 'нет данных'; byTf[tf] = (byTf[tf] || 0) + 1;
  }
  const top = (m: Record<string, number>) => Object.entries(m).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([k,v])=>`• ${k}: ${v}`).join('\n') || '• нет данных';
  return `🧪 <b>ML-анализ ошибок (20 сделок)</b>\nУбыточные причины:\n${top(byReason)}\nСлабые символы:\n${top(bySymbol)}\nСлабые таймфреймы:\n${top(byTf)}\nРекомендация: ужесточить фильтры для топ-2 причин.`;
}
