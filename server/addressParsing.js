import { normalizeText } from './normalize.js';

export function streetNameFromAddress(address) {
  const cleaned = normalizeText(address)
    .replace(/^[0-9]+[A-Za-z]?\s+/, '')
    .replace(/,\s*.*$/, '')
    .replace(/\s+#.*$/, '')
    .replace(/\s+(Unit|Apt|Apartment|Suite|Ste)\s+.*$/i, '')
    .trim();
  return cleaned || '';
}

export function hasStreetNumber(address) {
  return /^[0-9]+[A-Za-z]?\b/.test(normalizeText(address));
}

export function isLikelyNonStreetName(streetName) {
  return /\b(plan|model|community|homesite|lot)\b/i.test(streetName);
}
