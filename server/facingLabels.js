export const FACING_DIRECTIONS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export function compassLabel(degrees) {
  const normalized = normalizeDegrees(degrees);
  if (normalized >= 337.5 || normalized < 22.5) return 'N';
  if (normalized < 67.5) return 'NE';
  if (normalized <= 110) return 'E';
  if (normalized < 157.5) return 'SE';
  if (normalized < 202.5) return 'S';
  if (normalized < 247.5) return 'SW';
  if (normalized < 300) return 'W';
  return 'NW';
}

export function normalizeDegrees(degrees) {
  return ((degrees % 360) + 360) % 360;
}
