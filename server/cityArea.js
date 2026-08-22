import { normalizeText } from './normalize.js';

export const RALEIGH_CENTER = {
  lat: 35.7804,
  lon: -78.6391,
};

export function classifyCityArea(listing) {
  if (!isRaleigh(listing.city)) return null;
  if (listing.latitude === null || listing.latitude === undefined || listing.latitude === '') return 'Raleigh Unknown';
  if (listing.longitude === null || listing.longitude === undefined || listing.longitude === '') return 'Raleigh Unknown';

  const lat = Number(listing.latitude);
  const lon = Number(listing.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return 'Raleigh Unknown';

  const northSouth = lat >= RALEIGH_CENTER.lat ? 'N' : 'S';
  const eastWest = lon >= RALEIGH_CENTER.lon ? 'E' : 'W';
  return `Raleigh ${northSouth}${eastWest}`;
}

function isRaleigh(city) {
  return normalizeText(city ?? '').toLowerCase() === 'raleigh';
}
