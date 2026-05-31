import Database from 'better-sqlite3';
import { config } from '../config';

export type BcsTradeDirection = 'LONG' | 'SHORT';
export type BcsTradeStatus = 'open' | 'closed';
export type BcsInstrumentType = 'stock' | 'future' | 'currency' | 'bond' | 'fund' | 'option';

export interface BcsTradeInput {
  userId: number;
  ticker: string;
  instrumentType: BcsInstrumentType;
  direction: BcsTradeDirection;
  entryPrice: number;
  quantity: number;
  stopLoss: number;
  takeProfit: number;
  commissionRub: number;
  comment: string;
}

export interface BcsTrade extends BcsTradeInput {
  id: number;
  status: BcsTradeStatus;
  exitPrice?: number;
  pnlRub: number;
  pnlPercent: number;
  openedAt: string;
  closedAt?: string;
}

let db: Database.Database;

export function initBcsDb(): void {
  db = new Database(config.database.url);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      telegram_id INTEGER UNIQUE NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS settings (
      user_id INTEGER PRIMARY KEY,
      deposit_rub REAL NOT NULL DEFAULT ${config.bcs.defaultDepositRub},
      risk_per_trade REAL NOT NULL DEFAULT ${config.bcs.defaultRiskPerTrade},
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS instruments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticker TEXT UNIQUE NOT NULL,
      type TEXT NOT NULL,
      name TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      ticker TEXT NOT NULL,
      instrument_type TEXT NOT NULL,
      direction TEXT NOT NULL,
      entry_price REAL NOT NULL,
      quantity REAL NOT NULL,
      stop_loss REAL NOT NULL,
      take_profit REAL NOT NULL,
      commission_rub REAL NOT NULL DEFAULT 0,
      comment TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open',
      exit_price REAL,
      pnl_rub REAL NOT NULL DEFAULT 0,
      pnl_percent REAL NOT NULL DEFAULT 0,
      opened_at TEXT DEFAULT CURRENT_TIMESTAMP,
      closed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trade_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS portfolio_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      deposit_rub REAL NOT NULL,
      total_pnl_rub REAL NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS broker_fees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trade_id INTEGER,
      fee_rub REAL NOT NULL,
      description TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS ai_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trade_id INTEGER,
      user_id INTEGER NOT NULL,
      review TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function database(): Database.Database {
  if (!db) initBcsDb();
  return db;
}

export function ensureUser(telegramId: number): void {
  const databaseRef = database();
  databaseRef.prepare('INSERT OR IGNORE INTO users (telegram_id) VALUES (?)').run(telegramId);
  databaseRef.prepare('INSERT OR IGNORE INTO settings (user_id, deposit_rub, risk_per_trade) VALUES (?, ?, ?)')
    .run(telegramId, config.bcs.defaultDepositRub, config.bcs.defaultRiskPerTrade);
}

export function getSettings(userId: number): { depositRub: number; riskPerTrade: number } {
  ensureUser(userId);
  const row = database().prepare('SELECT deposit_rub as depositRub, risk_per_trade as riskPerTrade FROM settings WHERE user_id = ?').get(userId) as { depositRub: number; riskPerTrade: number } | undefined;
  return row ?? { depositRub: config.bcs.defaultDepositRub, riskPerTrade: config.bcs.defaultRiskPerTrade };
}

export function saveBcsTrade(input: BcsTradeInput): number {
  ensureUser(input.userId);
  const result = database().prepare(`
    INSERT INTO trades (user_id, ticker, instrument_type, direction, entry_price, quantity, stop_loss, take_profit, commission_rub, comment)
    VALUES (@userId, @ticker, @instrumentType, @direction, @entryPrice, @quantity, @stopLoss, @takeProfit, @commissionRub, @comment)
  `).run(input);
  database().prepare('INSERT INTO positions (trade_id, status) VALUES (?, ?)').run(result.lastInsertRowid, 'open');
  if (input.commissionRub > 0) {
    database().prepare('INSERT INTO broker_fees (trade_id, fee_rub, description) VALUES (?, ?, ?)').run(result.lastInsertRowid, input.commissionRub, 'Комиссия при открытии сделки');
  }
  return Number(result.lastInsertRowid);
}

function rowToTrade(row: any): BcsTrade {
  return {
    id: row.id,
    userId: row.user_id,
    ticker: row.ticker,
    instrumentType: row.instrument_type,
    direction: row.direction,
    entryPrice: row.entry_price,
    quantity: row.quantity,
    stopLoss: row.stop_loss,
    takeProfit: row.take_profit,
    commissionRub: row.commission_rub,
    comment: row.comment,
    status: row.status,
    exitPrice: row.exit_price ?? undefined,
    pnlRub: row.pnl_rub,
    pnlPercent: row.pnl_percent,
    openedAt: row.opened_at,
    closedAt: row.closed_at ?? undefined,
  };
}

export function getOpenBcsTrades(userId: number): BcsTrade[] {
  ensureUser(userId);
  const rows = database().prepare('SELECT * FROM trades WHERE user_id = ? AND status = ? ORDER BY opened_at DESC').all(userId, 'open');
  return rows.map(rowToTrade);
}

export function getClosedBcsTrades(userId: number, limit = 50): BcsTrade[] {
  ensureUser(userId);
  const rows = database().prepare('SELECT * FROM trades WHERE user_id = ? AND status = ? ORDER BY closed_at DESC, opened_at DESC LIMIT ?').all(userId, 'closed', limit);
  return rows.map(rowToTrade);
}

export function getTodayBcsTrades(userId: number): BcsTrade[] {
  ensureUser(userId);
  const rows = database().prepare("SELECT * FROM trades WHERE user_id = ? AND date(opened_at) = date('now') ORDER BY opened_at DESC").all(userId);
  return rows.map(rowToTrade);
}

export function getMonthBcsTrades(userId: number): BcsTrade[] {
  ensureUser(userId);
  const rows = database().prepare("SELECT * FROM trades WHERE user_id = ? AND strftime('%Y-%m', opened_at) = strftime('%Y-%m', 'now') ORDER BY opened_at DESC").all(userId);
  return rows.map(rowToTrade);
}

export function closeBcsTrade(userId: number, tradeId: number, exitPrice: number, exitCommissionRub: number): BcsTrade | undefined {
  const trade = database().prepare('SELECT * FROM trades WHERE id = ? AND user_id = ?').get(tradeId, userId) as any | undefined;
  if (!trade) return undefined;
  const gross = trade.direction === 'LONG'
    ? (exitPrice - trade.entry_price) * trade.quantity
    : (trade.entry_price - exitPrice) * trade.quantity;
  const totalCommission = trade.commission_rub + exitCommissionRub;
  const pnlRub = gross - totalCommission;
  const positionAmount = trade.entry_price * trade.quantity;
  const pnlPercent = positionAmount > 0 ? (pnlRub / positionAmount) * 100 : 0;
  database().prepare(`
    UPDATE trades SET status = 'closed', exit_price = ?, pnl_rub = ?, pnl_percent = ?, commission_rub = commission_rub + ?, closed_at = CURRENT_TIMESTAMP
    WHERE id = ? AND user_id = ?
  `).run(exitPrice, pnlRub, pnlPercent, exitCommissionRub, tradeId, userId);
  database().prepare('UPDATE positions SET status = ? WHERE trade_id = ?').run('closed', tradeId);
  if (exitCommissionRub > 0) {
    database().prepare('INSERT INTO broker_fees (trade_id, fee_rub, description) VALUES (?, ?, ?)').run(tradeId, exitCommissionRub, 'Комиссия при закрытии сделки');
  }
  const updated = database().prepare('SELECT * FROM trades WHERE id = ?').get(tradeId) as any;
  return rowToTrade(updated);
}

export function saveAiReview(userId: number, review: string, tradeId?: number): void {
  ensureUser(userId);
  database().prepare('INSERT INTO ai_reviews (trade_id, user_id, review) VALUES (?, ?, ?)').run(tradeId ?? null, userId, review);
}
