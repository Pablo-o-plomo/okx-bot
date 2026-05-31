import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { config } from '../config';
import { logger } from '../utils/logger';
import type { Signal, Trade, AnalysisReport, BotState, ErrorTag } from './models';

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) throw new Error('Database not initialized');
  return db;
}

export function initDb(): void {
  const dbPath = path.resolve(config.database.url);
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  createTables();
  logger.info(`📦 Database initialized: ${dbPath}`);
}

function createTables(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS signals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      direction TEXT NOT NULL,
      entry_price REAL NOT NULL,
      stop_loss REAL NOT NULL,
      take_profit1 REAL NOT NULL,
      take_profit2 REAL NOT NULL,
      take_profit3 REAL NOT NULL,
      risk_percent REAL NOT NULL,
      position_size REAL NOT NULL,
      leverage REAL NOT NULL DEFAULT 1,
      risk_reward REAL NOT NULL,
      confidence INTEGER NOT NULL,
      reasons TEXT NOT NULL,
      cancel_conditions TEXT NOT NULL,
      timeframe TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      indicators TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      signal_id INTEGER NOT NULL,
      symbol TEXT NOT NULL,
      direction TEXT NOT NULL,
      entry_price REAL NOT NULL,
      exit_price REAL,
      stop_loss REAL NOT NULL,
      take_profit1 REAL NOT NULL,
      take_profit2 REAL NOT NULL,
      take_profit3 REAL NOT NULL,
      position_size REAL NOT NULL,
      leverage REAL NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'open',
      result TEXT,
      pnl_percent REAL,
      pnl_usdt REAL,
      entry_reasons TEXT NOT NULL,
      exit_reason TEXT,
      exit_analysis TEXT,
      improvements TEXT,
      error_tags TEXT,
      indicators_at_entry TEXT,
      opened_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      closed_at DATETIME,
      FOREIGN KEY (signal_id) REFERENCES signals(id)
    );

    CREATE TABLE IF NOT EXISTS analysis_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      total_trades INTEGER NOT NULL,
      wins INTEGER NOT NULL,
      losses INTEGER NOT NULL,
      win_rate REAL NOT NULL,
      avg_profit REAL NOT NULL,
      avg_loss REAL NOT NULL,
      profit_factor REAL NOT NULL,
      best_setups TEXT NOT NULL,
      worst_setups TEXT NOT NULL,
      frequent_errors TEXT NOT NULL,
      recommendations TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS bot_state (
      id INTEGER PRIMARY KEY DEFAULT 1,
      is_paused INTEGER NOT NULL DEFAULT 0,
      paused_until TEXT,
      pause_reason TEXT,
      consecutive_losses INTEGER NOT NULL DEFAULT 0,
      daily_loss_percent REAL NOT NULL DEFAULT 0,
      last_daily_reset TEXT NOT NULL DEFAULT CURRENT_DATE,
      total_balance REAL NOT NULL DEFAULT 1000,
      mode TEXT NOT NULL DEFAULT 'demo',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    INSERT OR IGNORE INTO bot_state (id) VALUES (1);
  `);

  runSafeMigrations();
}

function addColumnIfMissing(table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some(c => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function runSafeMigrations(): void {
  addColumnIfMissing('signals', 'warnings', `TEXT DEFAULT '[]'`);
  addColumnIfMissing('signals', 'timeframe_confirmations', `TEXT DEFAULT '[]'`);
  addColumnIfMissing('signals', 'indicator_summary', 'TEXT');

  addColumnIfMissing('trades', 'tp1_hit_at', 'TEXT');
  addColumnIfMissing('trades', 'tp2_hit_at', 'TEXT');
  addColumnIfMissing('trades', 'tp3_hit_at', 'TEXT');
  addColumnIfMissing('trades', 'breakeven_moved_at', 'TEXT');
  addColumnIfMissing('trades', 'close_reason', 'TEXT');
  addColumnIfMissing('trades', 'final_pnl', 'REAL');
  addColumnIfMissing('trades', 'current_pnl', 'REAL DEFAULT 0');
  addColumnIfMissing('trades', 'progress_json', `TEXT DEFAULT '{"tp1":false,"tp2":false,"tp3":false,"breakeven":false,"partiallyClosed":false}'`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS reject_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      timeframe TEXT,
      reason TEXT NOT NULL,
      details TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}


// ─── Signals ──────────────────────────────────────────────────────────────────
export function saveSignal(signal: Signal): number {
  const stmt = db.prepare(`
    INSERT INTO signals (symbol, direction, entry_price, stop_loss, take_profit1,
      take_profit2, take_profit3, risk_percent, position_size, leverage,
      risk_reward, confidence, reasons, warnings, timeframe_confirmations, indicator_summary, cancel_conditions, timeframe, status, indicators)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    signal.symbol, signal.direction, signal.entryPrice, signal.stopLoss,
    signal.takeProfit1, signal.takeProfit2, signal.takeProfit3,
    signal.riskPercent, signal.positionSize, signal.leverage,
    signal.riskReward, signal.confidence,
    JSON.stringify(signal.reasons), JSON.stringify(signal.warnings),
    JSON.stringify(signal.timeframeConfirmations), JSON.stringify(signal.indicatorSummary),
    JSON.stringify(signal.cancelConditions), signal.timeframe, signal.status,
    signal.indicators ? JSON.stringify(signal.indicators) : null,
  );
  return result.lastInsertRowid as number;
}

export function getRecentSignals(limit = 10): Signal[] {
  const rows = db.prepare('SELECT * FROM signals ORDER BY created_at DESC LIMIT ?').all(limit) as any[];
  return rows.map(rowToSignal);
}

function rowToSignal(row: any): Signal {
  return {
    id: row.id,
    symbol: row.symbol,
    direction: row.direction,
    entryPrice: row.entry_price,
    stopLoss: row.stop_loss,
    takeProfit1: row.take_profit1,
    takeProfit2: row.take_profit2,
    takeProfit3: row.take_profit3,
    riskPercent: row.risk_percent,
    positionSize: row.position_size,
    leverage: row.leverage,
    riskReward: row.risk_reward,
    confidence: row.confidence,
    reasons: JSON.parse(row.reasons),
    warnings: JSON.parse(row.warnings || '[]'),
    timeframeConfirmations: JSON.parse(row.timeframe_confirmations || JSON.stringify([row.timeframe])),
    indicatorSummary: row.indicator_summary ? JSON.parse(row.indicator_summary) : { ema20: 0, ema50: 0, ema200: 0, emaAlignment: 'n/a', rsi: 0, rsiState: 'n/a', macd: 'neutral', macdState: 'n/a', atr: 0, atrPercent: 0, volumeRatio: 0, volumeState: 'none' },
    cancelConditions: JSON.parse(row.cancel_conditions),
    timeframe: row.timeframe,
    status: row.status,
    indicators: row.indicators ? JSON.parse(row.indicators) : undefined,
    createdAt: row.created_at,
  };
}

// ─── Trades ───────────────────────────────────────────────────────────────────
export function saveTrade(trade: Trade): number {
  const stmt = db.prepare(`
    INSERT INTO trades (signal_id, symbol, direction, entry_price, stop_loss,
      take_profit1, take_profit2, take_profit3, position_size, leverage,
      status, entry_reasons, indicators_at_entry, progress_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    trade.signalId, trade.symbol, trade.direction, trade.entryPrice,
    trade.stopLoss, trade.takeProfit1, trade.takeProfit2, trade.takeProfit3,
    trade.positionSize, trade.leverage, trade.status,
    JSON.stringify(trade.entryReasons),
    trade.indicatorsAtEntry ? JSON.stringify(trade.indicatorsAtEntry) : null,
    JSON.stringify(trade.progress || { tp1: false, tp2: false, tp3: false, breakeven: false, partiallyClosed: false }),
  );
  return result.lastInsertRowid as number;
}

export function closeTrade(
  id: number,
  exitPrice: number,
  status: string,
  result: string,
  pnlPercent: number,
  pnlUsdt: number,
  exitReason: string,
  exitAnalysis: string,
  improvements: string[],
  errorTags: ErrorTag[],
): void {
  db.prepare(`
    UPDATE trades SET
      exit_price = ?, status = ?, result = ?, pnl_percent = ?, pnl_usdt = ?,
      exit_reason = ?, exit_analysis = ?, improvements = ?, error_tags = ?,
      close_reason = ?, final_pnl = ?, current_pnl = ?, closed_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    exitPrice, status, result, pnlPercent, pnlUsdt,
    exitReason, exitAnalysis,
    JSON.stringify(improvements), JSON.stringify(errorTags),
    exitReason, pnlPercent, pnlPercent, id,
  );
}

export function getOpenTrades(): Trade[] {
  const rows = db.prepare("SELECT * FROM trades WHERE status IN ('open','tp1_hit','tp2_hit','breakeven','partially_closed')").all() as any[];
  return rows.map(rowToTrade);
}

export function getOpenTradeBySymbol(symbol: string): Trade | null {
  const row = db.prepare("SELECT * FROM trades WHERE symbol = ? AND status IN ('open','tp1_hit','tp2_hit','breakeven','partially_closed')").get(symbol) as any;
  return row ? rowToTrade(row) : null;
}

export function getTradeById(id: number): Trade | null {
  const row = db.prepare('SELECT * FROM trades WHERE id = ?').get(id) as any;
  return row ? rowToTrade(row) : null;
}

export function getLastNTrades(n: number): Trade[] {
  const rows = db.prepare("SELECT * FROM trades WHERE status NOT IN ('open','tp1_hit','tp2_hit','breakeven','partially_closed') ORDER BY closed_at DESC LIMIT ?").all(n) as any[];
  return rows.map(rowToTrade);
}

export function getTodayTrades(): Trade[] {
  const rows = db.prepare(`
    SELECT * FROM trades 
    WHERE DATE(opened_at) = DATE('now') AND status NOT IN ('open','tp1_hit','tp2_hit','breakeven','partially_closed')
  `).all() as any[];
  return rows.map(rowToTrade);
}

function rowToTrade(row: any): Trade {
  return {
    id: row.id,
    signalId: row.signal_id,
    symbol: row.symbol,
    direction: row.direction,
    entryPrice: row.entry_price,
    exitPrice: row.exit_price ?? undefined,
    stopLoss: row.stop_loss,
    takeProfit1: row.take_profit1,
    takeProfit2: row.take_profit2,
    takeProfit3: row.take_profit3,
    positionSize: row.position_size,
    leverage: row.leverage,
    status: row.status,
    result: row.result ?? undefined,
    pnlPercent: row.pnl_percent ?? undefined,
    pnlUsdt: row.pnl_usdt ?? undefined,
    finalPnl: row.final_pnl ?? undefined,
    currentPnl: row.current_pnl ?? undefined,
    closeReason: row.close_reason ?? undefined,
    entryReasons: JSON.parse(row.entry_reasons || '[]'),
    exitReason: row.exit_reason ?? undefined,
    exitAnalysis: row.exit_analysis ?? undefined,
    improvements: row.improvements ? JSON.parse(row.improvements) : undefined,
    errorTags: row.error_tags ? JSON.parse(row.error_tags) : undefined,
    indicatorsAtEntry: row.indicators_at_entry ? JSON.parse(row.indicators_at_entry) : undefined,
    progress: row.progress_json ? JSON.parse(row.progress_json) : { tp1: false, tp2: false, tp3: false, breakeven: false, partiallyClosed: false },
    tp1HitAt: row.tp1_hit_at ?? undefined,
    tp2HitAt: row.tp2_hit_at ?? undefined,
    tp3HitAt: row.tp3_hit_at ?? undefined,
    breakevenMovedAt: row.breakeven_moved_at ?? undefined,
    openedAt: row.opened_at,
    closedAt: row.closed_at ?? undefined,
  };
}

// ─── Analysis Reports ─────────────────────────────────────────────────────────
export function saveAnalysisReport(report: AnalysisReport): void {
  db.prepare(`
    INSERT INTO analysis_reports (period_start, period_end, total_trades, wins, losses,
      win_rate, avg_profit, avg_loss, profit_factor, best_setups, worst_setups,
      frequent_errors, recommendations)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    report.periodStart, report.periodEnd, report.totalTrades,
    report.wins, report.losses, report.winRate, report.avgProfit, report.avgLoss,
    report.profitFactor,
    JSON.stringify(report.bestSetups), JSON.stringify(report.worstSetups),
    JSON.stringify(report.frequentErrors), JSON.stringify(report.recommendations),
  );
}

// ─── Bot State ────────────────────────────────────────────────────────────────
export function getBotState(): BotState {
  const row = db.prepare('SELECT * FROM bot_state WHERE id = 1').get() as any;
  return {
    isPaused: row.is_paused === 1,
    pausedUntil: row.paused_until ?? undefined,
    pauseReason: row.pause_reason ?? undefined,
    consecutiveLosses: row.consecutive_losses,
    dailyLossPercent: row.daily_loss_percent,
    lastDailyReset: row.last_daily_reset,
    totalBalance: row.total_balance,
    mode: row.mode,
  };
}

export function updateBotState(partial: Partial<BotState>): void {
  const current = getBotState();
  const merged = { ...current, ...partial };
  db.prepare(`
    UPDATE bot_state SET
      is_paused = ?, paused_until = ?, pause_reason = ?,
      consecutive_losses = ?, daily_loss_percent = ?,
      last_daily_reset = ?, total_balance = ?, mode = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = 1
  `).run(
    merged.isPaused ? 1 : 0,
    merged.pausedUntil ?? null,
    merged.pauseReason ?? null,
    merged.consecutiveLosses,
    merged.dailyLossPercent,
    merged.lastDailyReset,
    merged.totalBalance,
    merged.mode,
  );
}


export function updateTradeLifecycle(
  id: number,
  patch: { status?: string; currentPnl?: number; progress?: unknown; tp1HitAt?: string; tp2HitAt?: string; tp3HitAt?: string; breakevenMovedAt?: string },
): void {
  const trade = getTradeById(id);
  if (!trade) return;
  db.prepare(`
    UPDATE trades SET
      status = ?, current_pnl = ?, progress_json = ?,
      tp1_hit_at = COALESCE(?, tp1_hit_at),
      tp2_hit_at = COALESCE(?, tp2_hit_at),
      tp3_hit_at = COALESCE(?, tp3_hit_at),
      breakeven_moved_at = COALESCE(?, breakeven_moved_at)
    WHERE id = ?
  `).run(
    patch.status ?? trade.status,
    patch.currentPnl ?? trade.currentPnl ?? 0,
    JSON.stringify(patch.progress ?? trade.progress ?? { tp1: false, tp2: false, tp3: false, breakeven: false, partiallyClosed: false }),
    patch.tp1HitAt ?? null,
    patch.tp2HitAt ?? null,
    patch.tp3HitAt ?? null,
    patch.breakevenMovedAt ?? null,
    id,
  );
}

export function recordReject(symbol: string, timeframe: string | undefined, reason: string, details?: string): void {
  db.prepare('INSERT INTO reject_events (symbol, timeframe, reason, details) VALUES (?, ?, ?, ?)')
    .run(symbol, timeframe ?? null, reason, details ?? null);
}

export function getRejectStats(limit = 100): Array<{ reason: string; count: number }> {
  return db.prepare(`
    SELECT reason, COUNT(*) as count
    FROM reject_events
    GROUP BY reason
    ORDER BY count DESC
    LIMIT ?
  `).all(limit) as Array<{ reason: string; count: number }>;
}

export function getRejectStatsBySymbol(limit = 10): Array<{ symbol: string; count: number }> {
  return db.prepare(`
    SELECT symbol, COUNT(*) as count
    FROM reject_events
    GROUP BY symbol
    ORDER BY count DESC
    LIMIT ?
  `).all(limit) as Array<{ symbol: string; count: number }>;
}

export function getRejectStatsByTimeframe(limit = 10): Array<{ timeframe: string; count: number }> {
  return db.prepare(`
    SELECT COALESCE(timeframe, 'n/a') as timeframe, COUNT(*) as count
    FROM reject_events
    GROUP BY COALESCE(timeframe, 'n/a')
    ORDER BY count DESC
    LIMIT ?
  `).all(limit) as Array<{ timeframe: string; count: number }>;
}

export function getRejectCountSince(hours: number): number {
  const row = db.prepare("SELECT COUNT(*) as count FROM reject_events WHERE created_at >= datetime('now', ?)").get(`-${hours} hours`) as { count: number };
  return row.count;
}

export function getWinrateBySymbol(): Array<{ symbol: string; winrate: number; trades: number; pnlPercent: number }> {
  const rows = db.prepare(`
    SELECT
      symbol,
      COUNT(*) AS trades,
      SUM(CASE WHEN result = 'win' THEN 1 ELSE 0 END) AS wins,
      AVG(COALESCE(pnl_percent, 0)) AS avg_pnl
    FROM trades
    WHERE status NOT IN ('open', 'tp1_hit', 'tp2_hit', 'breakeven', 'partially_closed')
    GROUP BY symbol
    HAVING COUNT(*) > 0
    ORDER BY (SUM(CASE WHEN result = 'win' THEN 1 ELSE 0 END) * 1.0 / COUNT(*)) DESC
  `).all() as Array<{ symbol: string; trades: number; wins: number; avg_pnl: number }>;

  return rows.map(row => ({
    symbol: row.symbol,
    trades: row.trades,
    winrate: row.trades > 0 ? (row.wins / row.trades) * 100 : 0,
    pnlPercent: row.avg_pnl ?? 0,
  }));
}
