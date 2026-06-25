"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDb = getDb;
exports.initDb = initDb;
exports.saveSignal = saveSignal;
exports.getRecentSignals = getRecentSignals;
exports.saveTrade = saveTrade;
exports.closeTrade = closeTrade;
exports.updateTradeStopLoss = updateTradeStopLoss;
exports.updateTradeTpHit = updateTradeTpHit;
exports.updateTradeExcursion = updateTradeExcursion;
exports.getOpenTrades = getOpenTrades;
exports.getOpenTradeBySymbol = getOpenTradeBySymbol;
exports.getTradeById = getTradeById;
exports.getLastNTrades = getLastNTrades;
exports.getTodayTrades = getTodayTrades;
exports.getTodayClosedTrades = getTodayClosedTrades;
exports.updateTradeSlAlgoId = updateTradeSlAlgoId;
exports.updateTradePartialClose = updateTradePartialClose;
exports.saveAnalysisReport = saveAnalysisReport;
exports.getBotState = getBotState;
exports.getPaperTradingBalance = getPaperTradingBalance;
exports.updateBotState = updateBotState;
exports.getLastAnalyzedTradeId = getLastAnalyzedTradeId;
exports.setLastAnalyzedTradeId = setLastAnalyzedTradeId;
exports.countNewClosedTrades = countNewClosedTrades;
exports.getMaxClosedTradeId = getMaxClosedTradeId;
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const config_1 = require("../config");
const logger_1 = require("../utils/logger");
let db;
function getDb() {
    if (!db)
        throw new Error('Database not initialized');
    return db;
}
function initDb() {
    const dbPath = path_1.default.resolve(config_1.config.database.url);
    const dir = path_1.default.dirname(dbPath);
    if (!fs_1.default.existsSync(dir))
        fs_1.default.mkdirSync(dir, { recursive: true });
    db = new better_sqlite3_1.default(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    createTables();
    migrateTables();
    syncBotStateMode();
    logger_1.logger.info(`📦 Database initialized: ${dbPath}`);
}
function createTables() {
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
      paper_start_balance REAL,
      mode TEXT NOT NULL DEFAULT 'demo',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
    db.prepare('INSERT OR IGNORE INTO bot_state (id) VALUES (1)').run();
}
function syncBotStateMode() {
    const state = db.prepare('SELECT mode, total_balance, paper_start_balance FROM bot_state WHERE id = 1').get();
    if (config_1.config.trading.mode === 'paper') {
        const storedPaperStartBalance = state?.paper_start_balance ?? null;
        const storedTradingBalance = state?.total_balance ?? 0;
        if (state?.mode !== 'paper'
            || storedPaperStartBalance !== config_1.config.trading.paperStartBalance
            || storedTradingBalance <= 0
            || storedTradingBalance < config_1.config.trading.paperStartBalance) {
            db.prepare(`
        UPDATE bot_state SET total_balance = ?, paper_start_balance = ?, mode = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = 1
      `).run(config_1.config.trading.paperStartBalance, config_1.config.trading.paperStartBalance, config_1.config.trading.mode);
        }
        return;
    }
    if (state?.mode !== config_1.config.trading.mode) {
        db.prepare('UPDATE bot_state SET mode = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1').run(config_1.config.trading.mode);
    }
}
function migrateTables() {
    addColumnIfMissing('bot_state', 'paper_start_balance', 'REAL');
    addColumnIfMissing('bot_state', 'last_analyzed_trade_id', 'INTEGER NOT NULL DEFAULT 0');
    addColumnIfMissing('trades', 'sl_algo_id', 'TEXT');
    // Partial close tracking
    addColumnIfMissing('trades', 'remaining_size', 'REAL');
    addColumnIfMissing('trades', 'tp1_closed_size', 'REAL');
    addColumnIfMissing('trades', 'tp1_pnl_usdt', 'REAL');
    addColumnIfMissing('trades', 'tp2_closed_size', 'REAL');
    addColumnIfMissing('trades', 'tp2_pnl_usdt', 'REAL');
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
function addColumnIfMissing(table, column, definition) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!columns.some(col => col.name === column)) {
        db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
    }
}
// ─── Signals ──────────────────────────────────────────────────────────────────
function saveSignal(signal) {
    const stmt = db.prepare(`
    INSERT INTO signals (symbol, direction, entry_price, stop_loss, take_profit1,
      take_profit2, take_profit3, risk_percent, position_size, leverage,
      risk_reward, confidence, reasons, cancel_conditions, timeframe, status, indicators)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
    const result = stmt.run(signal.symbol, signal.direction, signal.entryPrice, signal.stopLoss, signal.takeProfit1, signal.takeProfit2, signal.takeProfit3, signal.riskPercent, signal.positionSize, signal.leverage, signal.riskReward, signal.confidence, JSON.stringify(signal.reasons), JSON.stringify(signal.cancelConditions), signal.timeframe, signal.status, signal.indicators ? JSON.stringify(signal.indicators) : null);
    return result.lastInsertRowid;
}
function getRecentSignals(limit = 10) {
    const rows = db.prepare('SELECT * FROM signals ORDER BY created_at DESC LIMIT ?').all(limit);
    return rows.map(rowToSignal);
}
function rowToSignal(row) {
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
function saveTrade(trade) {
    const stmt = db.prepare(`
    INSERT INTO trades (signal_id, symbol, direction, entry_price, stop_loss,
      take_profit1, take_profit2, take_profit3, position_size, leverage,
      status, entry_reasons, indicators_at_entry, market_phase, signal_confidence,
      scanner_score, volume_ratio, atr_at_entry, rsi_at_entry, trend_strength)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
    const result = stmt.run(trade.signalId, trade.symbol, trade.direction, trade.entryPrice, trade.stopLoss, trade.takeProfit1, trade.takeProfit2, trade.takeProfit3, trade.positionSize, trade.leverage, trade.status, JSON.stringify(trade.entryReasons), trade.indicatorsAtEntry ? JSON.stringify(trade.indicatorsAtEntry) : null, trade.marketPhase ?? 'UNKNOWN', trade.signalConfidence ?? 0, trade.scannerScore ?? 0, trade.volumeRatio ?? 0, trade.atrAtEntry ?? 0, trade.rsiAtEntry ?? 0, trade.trendStrength ?? 0);
    return result.lastInsertRowid;
}
function closeTrade(id, exitPrice, status, result, pnlPercent, pnlUsdt, exitReason, exitAnalysis, improvements, errorTags) {
    db.prepare(`
    UPDATE trades SET
      exit_price = ?, status = ?, result = ?, pnl_percent = ?, pnl_usdt = ?,
      exit_reason = ?, exit_analysis = ?, improvements = ?, error_tags = ?,
      holding_time_minutes = CAST((julianday(CURRENT_TIMESTAMP) - julianday(opened_at)) * 24 * 60 AS INTEGER),
      closed_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(exitPrice, status, result, pnlPercent, pnlUsdt, exitReason, exitAnalysis, JSON.stringify(improvements), JSON.stringify(errorTags), id);
}
function updateTradeStopLoss(id, stopLoss) {
    db.prepare(`
    UPDATE trades SET stop_loss = ?
    WHERE id = ? AND status = 'open'
  `).run(stopLoss, id);
}
function updateTradeTpHit(id, tpLevel) {
    const column = `tp${tpLevel}_hit`;
    const timestampColumn = `tp${tpLevel}_hit_at`;
    db.prepare(`
    UPDATE trades SET ${column} = 1, ${timestampColumn} = COALESCE(${timestampColumn}, CURRENT_TIMESTAMP)
    WHERE id = ?
  `).run(id);
}
function updateTradeExcursion(id, maxProfitPercent, maxDrawdownPercent) {
    db.prepare(`
    UPDATE trades SET
      max_profit_percent = MAX(max_profit_percent, ?),
      max_drawdown_percent = MAX(max_drawdown_percent, ?)
    WHERE id = ? AND status = 'open'
  `).run(maxProfitPercent, maxDrawdownPercent, id);
}
function getOpenTrades() {
    const rows = db.prepare("SELECT * FROM trades WHERE status = 'open'").all();
    return rows.map(rowToTrade);
}
function getOpenTradeBySymbol(symbol) {
    const row = db.prepare("SELECT * FROM trades WHERE symbol = ? AND status = 'open'").get(symbol);
    return row ? rowToTrade(row) : null;
}
function getTradeById(id) {
    const row = db.prepare('SELECT * FROM trades WHERE id = ?').get(id);
    return row ? rowToTrade(row) : null;
}
function getLastNTrades(n) {
    const rows = db.prepare("SELECT * FROM trades WHERE status != 'open' ORDER BY closed_at DESC LIMIT ?").all(n);
    return rows.map(rowToTrade);
}
function getTodayTrades() {
    return getTodayClosedTrades();
}
function getTodayClosedTrades() {
    const rows = db.prepare(`
    SELECT * FROM trades
    WHERE closed_at IS NOT NULL
      AND DATE(closed_at) = DATE('now')
      AND (
        status IN ('closed_tp1', 'closed_tp2', 'closed_tp3', 'closed_sl', 'breakeven')
        OR result = 'breakeven'
      )
    ORDER BY closed_at ASC
  `).all();
    return rows.map(rowToTrade);
}
function rowToTrade(row) {
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
        slAlgoId: row.sl_algo_id ?? undefined,
        remainingSize: row.remaining_size ?? undefined,
        tp1ClosedSize: row.tp1_closed_size ?? undefined,
        tp1PnlUsdt: row.tp1_pnl_usdt ?? undefined,
        tp2ClosedSize: row.tp2_closed_size ?? undefined,
        tp2PnlUsdt: row.tp2_pnl_usdt ?? undefined,
    };
}
function updateTradeSlAlgoId(tradeId, algoId) {
    db.prepare('UPDATE trades SET sl_algo_id = ? WHERE id = ?').run(algoId, tradeId);
}
// Records a partial close at TP1 or TP2.
// Not yet wired to trading logic - prepared for Stage 4 (handlePartialClose).
function updateTradePartialClose(tradeId, tpLevel, closedSize, pnlUsdt, remainingSize) {
    const sizeCol = `tp${tpLevel}_closed_size`;
    const pnlCol = `tp${tpLevel}_pnl_usdt`;
    db.prepare(`
    UPDATE trades
    SET ${sizeCol} = ?, ${pnlCol} = ?, remaining_size = ?
    WHERE id = ?
  `).run(closedSize, pnlUsdt, remainingSize, tradeId);
}
// ─── Analysis Reports ─────────────────────────────────────────────────────────
function saveAnalysisReport(report) {
    db.prepare(`
    INSERT INTO analysis_reports (period_start, period_end, total_trades, wins, losses,
      win_rate, avg_profit, avg_loss, profit_factor, best_setups, worst_setups,
      frequent_errors, recommendations)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(report.periodStart, report.periodEnd, report.totalTrades, report.wins, report.losses, report.winRate, report.avgProfit, report.avgLoss, report.profitFactor, JSON.stringify(report.bestSetups), JSON.stringify(report.worstSetups), JSON.stringify(report.frequentErrors), JSON.stringify(report.recommendations));
}
// ─── Bot State ────────────────────────────────────────────────────────────────
function getBotState() {
    const row = db.prepare('SELECT * FROM bot_state WHERE id = 1').get();
    return {
        isPaused: row.is_paused === 1,
        pausedUntil: row.paused_until ?? undefined,
        pauseReason: row.pause_reason ?? undefined,
        consecutiveLosses: row.consecutive_losses,
        dailyLossPercent: row.daily_loss_percent,
        lastDailyReset: row.last_daily_reset,
        totalBalance: row.total_balance,
        paperStartBalance: row.paper_start_balance ?? undefined,
        mode: row.mode,
    };
}
function getPaperTradingBalance() {
    const state = getBotState();
    const shouldReset = config_1.config.trading.mode === 'paper'
        && (!Number.isFinite(state.totalBalance)
            || state.totalBalance <= 0
            || state.totalBalance < config_1.config.trading.paperStartBalance);
    if (shouldReset) {
        updateBotState({
            totalBalance: config_1.config.trading.paperStartBalance,
            paperStartBalance: config_1.config.trading.paperStartBalance,
            mode: 'paper',
        });
        return config_1.config.trading.paperStartBalance;
    }
    return state.totalBalance;
}
function updateBotState(partial) {
    const current = getBotState();
    const merged = { ...current, ...partial };
    db.prepare(`
    UPDATE bot_state SET
      is_paused = ?, paused_until = ?, pause_reason = ?,
      consecutive_losses = ?, daily_loss_percent = ?,
      last_daily_reset = ?, total_balance = ?, paper_start_balance = ?, mode = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = 1
  `).run(merged.isPaused ? 1 : 0, merged.pausedUntil ?? null, merged.pauseReason ?? null, merged.consecutiveLosses, merged.dailyLossPercent, merged.lastDailyReset, merged.totalBalance, merged.paperStartBalance ?? null, merged.mode);
}
// ─── Learning Analysis Marker ─────────────────────────────────────────────────
/**
 * Returns the max trade ID that was current when the last learning analysis ran.
 * Zero if analysis has never run (new bot or first start).

 */
function getLastAnalyzedTradeId() {
    const row = db.prepare('SELECT last_analyzed_trade_id FROM bot_state WHERE id = 1').get();
    return row?.last_analyzed_trade_id ?? 0;
}
/**
 * Persists the max trade ID seen at the time of a completed learning analysis.
 */
function setLastAnalyzedTradeId(tradeId) {
    db.prepare('UPDATE bot_state SET last_analyzed_trade_id = ? WHERE id = 1').run(tradeId);
}
/**
 * Counts closed trades (status != 'open') with id > sinceTradeId.
 */
function countNewClosedTrades(sinceTradeId) {
    const row = db.prepare("SELECT COUNT(*) as cnt FROM trades WHERE status != 'open' AND id > ?").get(sinceTradeId);
    return row.cnt;
}
/**
 * Returns the highest ID among all closed trades, or 0 if none exist.
 */
function getMaxClosedTradeId() {
    const row = db.prepare("SELECT MAX(id) as maxId FROM trades WHERE status != 'open'").get();
    return row.maxId ?? 0;
}
//# sourceMappingURL=db.js.map