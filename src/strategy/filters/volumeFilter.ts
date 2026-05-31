import { config } from '../../config';

export interface VolumeFilterResult {
  pass: boolean;
  multiplier: number;
  state: 'none' | 'low' | 'weak' | 'normal' | 'high';
  warnings: string[];
  rejectReason?: 'low_volume' | 'weak_volume';
}

export function volumeFilter(volumeMultiplier: number): VolumeFilterResult {
  const multiplier = Number.isFinite(volumeMultiplier) ? volumeMultiplier : 0;
  if (multiplier <= 0) {
    return { pass: false, multiplier, state: 'none', warnings: ['Объем: нет данных'], rejectReason: 'low_volume' };
  }
  if (multiplier < 0.5) {
    return { pass: false, multiplier, state: 'low', warnings: ['Критически слабый объем'], rejectReason: 'low_volume' };
  }
  if (multiplier < 0.7) {
    return { pass: config.trading.qualityMode === 'low', multiplier, state: 'weak', warnings: ['Слабый объем'], rejectReason: 'weak_volume' };
  }
  if (config.trading.qualityMode === 'high' && multiplier < 1) {
    return { pass: false, multiplier, state: 'normal', warnings: ['Объем ниже строгого порога x1.0'], rejectReason: 'weak_volume' };
  }
  if (multiplier < config.trading.minVolumeMultiplier) {
    return { pass: true, multiplier, state: 'normal', warnings: [`Объем ниже желаемого x${config.trading.minVolumeMultiplier}`] };
  }
  if (multiplier >= 1.5) return { pass: true, multiplier, state: 'high', warnings: [] };
  return { pass: true, multiplier, state: 'normal', warnings: [] };
}
