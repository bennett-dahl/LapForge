/** PSI → bar (exact definition used in product). */
export const PSI_TO_BAR = 0.0689476;

export type PressureUnit = 'psi' | 'bar';
export type TempUnit = 'c' | 'f';
/** Matches backend `_PREF_DEFAULTS.default_distance_unit` (`km` | `mi`). */
export type DistanceUnit = 'km' | 'mi';
export type SpeedUnit = 'km/h' | 'mph';

export const KMH_TO_MPH = 0.621371;

export function convertSpeed(kmh: number, to: SpeedUnit): number {
  if (!Number.isFinite(kmh)) return kmh;
  return to === 'mph' ? kmh * KMH_TO_MPH : kmh;
}

export function speedLabel(unit: SpeedUnit): string {
  return unit;
}

const METERS_PER_MI = 1609.344;

export function metersToDistanceDisplay(meters: number, unit: DistanceUnit): number {
  if (!Number.isFinite(meters)) return meters;
  return unit === 'mi' ? meters / METERS_PER_MI : meters / 1000;
}

/** X-axis title when plotting distance from meter-valued series. */
export function distanceAxisTitle(unit: DistanceUnit): string {
  return unit === 'mi' ? 'Distance (mi)' : 'Distance (km)';
}

export function convertPressure(value: number, from: PressureUnit, to: PressureUnit): number {
  if (!Number.isFinite(value) || from === to) return value;
  if (from === 'psi' && to === 'bar') return value * PSI_TO_BAR;
  if (from === 'bar' && to === 'psi') return value / PSI_TO_BAR;
  return value;
}

export function convertTemp(value: number, from: TempUnit, to: TempUnit): number {
  if (!Number.isFinite(value) || from === to) return value;
  if (from === 'c' && to === 'f') return (value * 9) / 5 + 32;
  if (from === 'f' && to === 'c') return ((value - 32) * 5) / 9;
  return value;
}

export function pressureLabel(unit: PressureUnit): string {
  return unit === 'bar' ? 'bar' : 'psi';
}

export function tempLabel(unit: TempUnit): string {
  return unit === 'f' ? '°f' : '°c';
}

/** Raw storage unit for a pressure channel from metadata / naming. */
export function storagePressureUnit(
  meta: { unit?: string; category?: string } | undefined,
  channelKey: string,
): PressureUnit {
  const u = (meta?.unit || '').toLowerCase();
  if (u === 'psi') return 'psi';
  if (u === 'bar') return 'bar';
  const k = channelKey.toLowerCase();
  if (k.includes('_psi')) return 'psi';
  if (/tpms_press/i.test(k)) return 'bar';
  if (meta?.category === 'pressure') return 'bar';
  return 'psi';
}

/** Whether values are Celsius (TPMS temps, etc.). */
export function isCelsiusTelemetryChannel(
  meta: { unit?: string } | undefined,
  channelKey: string,
): boolean {
  const u = (meta?.unit || '').replace(/\s/g, '').toLowerCase();
  if (u.includes('°c') || u === 'c') return true;
  if (/tpms_temp/i.test(channelKey)) return true;
  return false;
}

/** Pressure series (excludes tpms_temp, which is categorized as pressure in some blobs). */
export function isPressureTelemetryChannel(
  meta: { unit?: string; category?: string } | undefined,
  channelKey: string,
): boolean {
  const k = channelKey.toLowerCase();
  if (/tpms_temp/i.test(k)) return false;
  if (/tpms_press/i.test(k)) return true;
  const u = (meta?.unit || '').toLowerCase();
  if (meta?.category === 'pressure' && (u === 'bar' || u === 'psi')) return true;
  return false;
}

export function mapNumericArray(
  arr: number[],
  fn: (v: number) => number,
): number[] {
  return arr.map((v) => (Number.isFinite(v) ? fn(v) : v));
}
