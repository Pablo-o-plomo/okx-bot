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
  migrateTables();
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
      tp1_hit INTEGER NOT NULL DEFAULT 0,
      tp2_hit INTEGER NOT NULL DEFAULT 0,
      tp3_hit INTEGER NOT NULL DEFAULT 0,
      tp1_hit_at TEXT,
      tp2_hit_at TEXT,
      tp3_hit_at TEXT,
      max_profit_percent REAL NOT NULL DEFAULT 0,
      max_drawdown_percent REAL NOT NULL DEFAULT 0,
      holding_time_minutes INTEGER,
      market_phase TEXT NOT NULL DEFAULT 'UNKNOWN',
      signal_confidence REAL NOT NULL DEFAULT 0,
      scanner_score REAL NOT NULL DEFAULT 0,
      volume_ratio REAL NOT NULL DEFAULT 0,
      atr_at_entry REAL NOT NULL DEFAULT 0,
      rsi_at_entry REAL NOT NULL DEFAULT 0,
      trend_strength REAL NOT NULL DEFAULT 0,
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
  `);

  db.prepare('INSERT OR IGNORE INTO bot_state (id, total_balance, mode) VALUES (1, ?, ?)').run(
    config.trading.paperStartBalance,
    config.trading.mode,
  );
}

function migrateTables(): void {
  addColumnIfMissing('trades', 'tp1_hit', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing('trades', 'tp2_hit', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing('trades', 'tp3_hit', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing('trades', 'tp1_hit_at', 'TEXT');
  addColumnIfMissing('trades', 'tp2_hit_at', 'TEXT');
  addColumnIfMissing('trades', 'tp3_hit_at', 'TEXT');
  addColumnIfMissing('trades', 'max_profit_percent', 'REAL NOT NULL DEFAULT 0');
  addColumnIfMissing('trades', 'max_drawdown_percent', 'REAL NOT NULL DEFAULT 0');
  addColumnIfMissing('trades', 'holding_time_minutes', 'INTEGER');
  addColumnIfMissing('trades', 'market_phase', "TEXT NOT NULL DEFAULT 'UNKNOWN'");
  addColumnIfMissing('trades', 'signal_confidence', 'REAL NOT NULL DEFAULT 0');
  addColumnIfMissing('trades', 'scanner_score', 'REAL NOT NULL DEFAULT 0');
  addColumnIfMissing('trades', 'volume_ratio', 'REAL NOT NULL DEFAULT 0');
  addColumnIfMissing('trades', 'atr_at_entry', 'REAL NOT NULL DEFAULT 0');
  addColumnIfMissing('trades', 'rsi_at_entry', 'REAL NOT NULL DEFAULT 0');
  addColumnIfMissing('trades', 'trend_strength', 'REAL NOT NULL DEFAULT 0');
}

function addColumnIfMissing(table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some(col => col.name === column)) {
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
  }
}

function migrateTables(): void {
  addColumnIfMissing('trades', 'tp1_hit', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing('trades', 'tp2_hit', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing('trades', 'tp3_hit', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing('trades', 'tp1_hit_at', 'TEXT');
  addColumnIfMissing('trades', 'tp2_hit_at', 'TEXT');
  addColumnIfMissing('trades', 'tp3_hit_at', 'TEXT');
  addColumnIfMissing('trades', 'max_profit_percent', 'REAL NOT NULL DEFAULT 0');
  addColumnIfMissing('trades', 'max_drawdown_percent', 'REAL NOT NULL DEFAULT 0');
  addColumnIfMissing('trades', 'holding_time_minutes', 'INTEGER');
  addColumnIfMissing('trades', 'market_phase', "TEXT NOT NULL DEFAULT 'UNKNOWN'");
  addColumnIfMissing('trades', 'signal_confidence', 'REAL NOT NULL DEFAULT 0');
  addColumnIfMissing('trades', 'scanner_score', 'REAL NOT NULL DEFAULT 0');
  addColumnIfMissing('trades', 'volume_ratio', 'REAL NOT NULL DEFAULT 0');
  addColumnIfMissing('trades', 'atr_at_entry', 'REAL NOT NULL DEFAULT 0');
  addColumnIfMissing('trades', 'rsi_at_entry', 'REAL NOT NULL DEFAULT 0');
  addColumnIfMissing('trades', 'trend_strength', 'REAL NOT NULL DEFAULT 0');
}

function addColumnIfMissing(table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some(col => col.name === column)) {
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
  }
}

// ─── Signals ──────────────────────────────────────────────────────────────────
export function saveSignal(signal: Signal): number {
  const stmt = db.prepare(`
    INSERT INTO signals (symbol, direction, entry_price, stop_loss, take_profit1,
      take_profit2, take_profit3, risk_percent, position_size, leverage,
      risk_reward, confidence, reasons, cancel_conditions, timeframe, status, indicators)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    signal.symbol, signal.direction, signal.entryPrice, signal.stopLoss,
    signal.takeProfit1, signal.takeProfit2, signal.takeProfit3,
    signal.riskPercent, signal.positionSize, signal.leverage,
    signal.riskReward, signal.confidence,
    JSON.stringify(signal.reasons), JSON.stringify(signal.cancelConditions),
    signal.timeframe, signal.status,
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
      status, entry_reasons, indicators_at_entry, market_phase, signal_confidence,
      scanner_score, volume_ratio, atr_at_entry, rsi_at_entry, trend_strength)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    trade.signalId, trade.symbol, trade.direction, trade.entryPrice,
    trade.stopLoss, trade.takeProfit1, trade.takeProfit2, trade.takeProfit3,
    trade.positionSize, trade.leverage, trade.status,
    JSON.stringify(trade.entryReasons),
    trade.indicatorsAtEntry ? JSON.stringify(trade.indicatorsAtEntry) : null,
    trade.marketPhase ?? 'UNKNOWN',
    trade.signalConfidence ?? 0,
    trade.scannerScore ?? 0,
    trade.volumeRatio ?? 0,
    trade.atrAtEntry ?? 0,
    trade.rsiAtEntry ?? 0,
    trade.trendStrength ?? 0,
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
      holding_time_minutes = CAST((julianday(CURRENT_TIMESTAMP) - julianday(opened_at)) * 24 * 60 AS INTEGER),
      closed_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    exitPrice, status, result, pnlPercent, pnlUsdt,
    exitReason, exitAnalysis,
    JSON.stringify(improvements), JSON.stringify(errorTags),
    id,
  );
}

export function updateTradeStopLoss(id: number, stopLoss: number): void {
  db.prepare(`
    UPDATE trades SET stop_loss = ?
    WHERE id = ? AND status = 'open'
  `).run(stopLoss, id);
}

export function updateTradeTpHit(id: number, tpLevel: 1 | 2 | 3): void {
  const column = `tp${tpLevel}_hit`;
  const timestampColumn = `tp${tpLevel}_hit_at`;
  db.prepare(`
    UPDATE trades SET ${column} = 1, ${timestampColumn} = COALESCE(${timestampColumn}, CURRENT_TIMESTAMP)
    WHERE id = ?
  `).run(id);
}

export function updateTradeExcursion(id: number, maxProfitPercent: number, maxDrawdownPercent: number): void {
  db.prepare(`
    UPDATE trades SET
      max_profit_percent = MAX(max_profit_percent, ?),
      max_drawdown_percent = MAX(max_drawdown_percent, ?)
    WHERE id = ? AND status = 'open'
  `).run(maxProfitPercent, maxDrawdownPercent, id);
}

export function getOpenTrades(): Trade[] {
  const rows = db.prepare("SELECT * FROM trades WHERE status = 'open'").all() as any[];
  return rows.map(rowToTrade);
}

export function getOpenTradeBySymbol(symbol: string): Trade | null {
  const row = db.prepare("SELECT * FROM trades WHERE symbol = ? AND status = 'open'").get(symbol) as any;
  return row ? rowToTrade(row) : null;
}

export function getTradeById(id: number): Trade | null {
  const row = db.prepare('SELECT * FROM trades WHERE id = ?').get(id) as any;
  return row ? rowToTrade(row) : null;
}

export function getLastNTrades(n: number): Trade[] {
  const rows = db.prepare("SELECT * FROM trades WHERE status != 'open' ORDER BY closed_at DESC LIMIT ?").all(n) as any[];
  return rows.map(rowToTrade);
}

export function getTodayTrades(): Trade[] {
  return getTodayClosedTrades();
}

export function getTodayClosedTrades(): Trade[] {
  const rows = db.prepare(`
    SELECT * FROM trades
    WHERE closed_at IS NOT NULL
      AND DATE(closed_at) = DATE('now')
      AND (
        status IN ('closed_tp1', 'closed_tp2', 'closed_tp3', 'closed_sl', 'breakeven')
        OR result = 'breakeven'
      )
    ORDER BY closed_at ASC
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
    tp1Hit: row.tp1_hit === 1,
    tp2Hit: row.tp2_hit === 1,
    tp3Hit: row.tp3_hit === 1,
    tp1HitAt: row.tp1_hit_at ?? null,
    tp2HitAt: row.tp2_hit_at ?? null,
    tp3HitAt: row.tp3_hit_at ?? null,
    maxProfitPercent: row.max_profit_percent ?? 0,
    maxDrawdownPercent: row.max_drawdown_percent ?? 0,
    holdingTimeMinutes: row.holding_time_minutes ?? null,
    marketPhase: row.market_phase ?? 'UNKNOWN',
    signalConfidence: row.signal_confidence ?? 0,
    scannerScore: row.scanner_score ?? 0,
    volumeRatio: row.volume_ratio ?? 0,
    atrAtEntry: row.atr_at_entry ?? 0,
    rsiAtEntry: row.rsi_at_entry ?? 0,
    trendStrength: row.trend_strength ?? 0,
    positionSize: row.position_size,
    leverage: row.leverage,
    status: row.status,
    result: row.result ?? undefined,
    pnlPercent: row.pnl_percent ?? undefined,
    pnlUsdt: row.pnl_usdt ?? undefined,
    entryReasons: JSON.parse(row.entry_reasons || '[]'),
    exitReason: row.exit_reason ?? undefined,
    exitAnalysis: row.exit_analysis ?? undefined,
    improvements: row.improvements ? JSON.parse(row.improvements) : undefined,
    errorTags: row.error_tags ? JSON.parse(row.error_tags) : undefined,
    indicatorsAtEntry: row.indicators_at_entry ? JSON.parse(row.indicators_at_entry) : undefined,
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
