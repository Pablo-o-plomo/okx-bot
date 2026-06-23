import { getInstrumentInfo } from './market';
import { logger } from '../utils/logger';
import { config } from '../config';

const FALLBACK_SYMBOLS = ['BTC-USDT-SWAP', 'ETH-USDT-SWAP', 'SOL-USDT-SWAP'];

// Хранит актуальный список символов после валидации при старте
let _activeSymbols: string[] = [];

/**
 * Возвращает список символов, прошедших валидацию.
 * До вызова validateAndSetSymbols() возвращает пустой массив.
 */
export function getActiveSymbols(): string[] {
  return _activeSymbols;
}

/**
 * Проверяет каждый символ из config.trading.symbols через OKX API.
 * - Невалидные символы исключаются из сканирования с предупреждением в лог.
 * - Ошибка OKX для одного символа не останавливает проверку остальных.
 * - Если ни один символ не прошёл — используется fallback с error log.
 * Вызывается один раз в bootstrap() перед запуском schedulers.
 */
export async function validateAndSetSymbols(): Promise<void> {
  const candidates = config.trading.symbols;

  if (candidates.length === 0) {
    logger.error('❌ SYMBOLS пустой — используем fallback: ' + FALLBACK_SYMBOLS.join(', '));
    _activeSymbols = [...FALLBACK_SYMBOLS];
    return;
  }

  logger.info(`🔍 Валидация символов (${candidates.length}): ${candidates.join(', ')}`);

  const results = await Promise.all(
    candidates.map(async (symbol): Promise<string | null> => {
      try {
        const info = await getInstrumentInfo(symbol);
        if (!info) {
          logger.warn(`⚠️ Символ ${symbol} не найден на OKX — исключён из сканирования`);
          return null;
        }
        logger.info(`✅ ${symbol} — OK (${info.instType})`);
        return symbol;
      } catch (err: any) {
        logger.warn(`⚠️ Ошибка при проверке ${symbol}: ${err.message} — исключён из сканирования`);
        return null;
      }
    })
  );

  const valid = results.filter((s): s is string => s !== null);
  const removed = candidates.filter(s => !valid.includes(s));

  if (removed.length > 0) {
    logger.warn(`⛔ Отключены невалидные символы (${removed.length}): ${removed.join(', ')}`);
  }

  if (valid.length === 0) {
    logger.error(
      '❌ Ни один символ из SYMBOLS не прошёл валидацию. ' +
      'Торговый сканер НЕ будет запущен. ' +
      'Проверьте SYMBOLS в Railway ENV.'
    );
    // Не используем fallback — лучше явно упасть с ошибкой, чем торговать
    // неожиданными символами. Сканер просто не запустится (пустой массив).
    _activeSymbols = [];
    return;
  }

  _activeSymbols = valid;
  logger.info(`✅ Активные символы (${valid.length}/${candidates.length}): ${valid.join(', ')}`);
}
