function pick(items: string[], seed = Date.now()): string {
  return items[Math.abs(Math.floor(seed)) % items.length];
}

export function getOpenComment(seed?: number): string {
  return pick([
    'Кошка дёрнулась. Смотрим, живая или маркетмейкер пнул.',
    'Киты проснулись. Мелочь снова проверяют на прочность.',
    'На графике запахло ловушкой. Входим только по плану.',
  ], seed);
}

export function getTpComment(level = 1, seed?: number): string {
  const comments = level === 1
    ? ['Первую кровь рынок уже отдал.', 'Первый тейк взяли. Дальше без жадности.']
    : ['План продолжает работать. Не мешаем сделке дышать.', 'Маркетмейкер пока платит по счетам.'];
  return pick(comments, seed);
}

export function getCloseComment(seed?: number): string {
  return pick([
    'План отработал. Кошка действительно отскочила.',
    'Сегодня рынок решил не убивать депозит.',
    'Сделка закрыта по плану — редкий момент, когда рынок не врал.',
  ], seed);
}

export function getStopComment(seed?: number): string {
  return pick([
    'Рынок передумал. Стоп словили — идём дальше.',
    'Маркетмейкер сегодня был голодный.',
    'Ловушка захлопнулась. Убыток принят, депозит жив.',
  ], seed);
}

export function getBreakevenComment(seed?: number): string {
  return pick([
    'Безубыток — скучно, зато депозит жив.',
    'Кошка мяукнула и убежала. Вышли без крови.',
  ], seed);
}

export function getMarketComment(seed?: number): string {
  return pick([
    'Рынок сегодня нервный. Лишние движения могут стоить депозита.',
    'На рынке пахнет охотой за стопами — меньше героизма, больше дисциплины.',
    'Киты двигают воду. Мелким лучше не прыгать без сигнала.',
  ], seed);
}

export function getWeakSignalComment(seed?: number): string {
  return pick([
    'Похоже на ловушку для FOMO.',
    'Объемы слишком тонкие — пахнет ложным движением.',
  ], seed);
}
