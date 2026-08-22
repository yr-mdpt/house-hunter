import { WORK_COORDS } from './config.js';
import { getGeoCache, setGeoCache } from './db.js';
import { normalizeAddress } from './normalize.js';

const KNOWN_PLACES = [
  { token: 'durham', lat: 35.994, lon: -78.8986 },
  { token: 'research triangle park', lat: 35.8992, lon: -78.8636 },
  { token: 'morrisville', lat: 35.8235, lon: -78.8256 },
  { token: 'cary', lat: 35.7915, lon: -78.7811 },
  { token: 'apex', lat: 35.7327, lon: -78.8503 },
  { token: 'chapel hill', lat: 35.9132, lon: -79.0558 },
  { token: 'raleigh', lat: 35.7796, lon: -78.6382 },
  { token: 'wake forest', lat: 35.9799, lon: -78.5097 },
];

export async function classifyCommute(db, listing) {
  const coords = listingCoords(listing) ?? await geocode(db, fullAddress(listing));
  if (!coords) return { minutes: null, reason: 'geocode_failed' };
  const route = await driveMinutes(db, coords);
  const fallbackMiles = haversineMiles(coords.lat, coords.lon, WORK_COORDS.lat, WORK_COORDS.lon);
  return {
    lat: coords.lat,
    lon: coords.lon,
    minutes: route?.minutes ?? estimateMinutes(coords),
    distance_miles: route?.distance_miles ?? roundMiles(fallbackMiles),
    reason: route?.source ?? 'estimated',
  };
}

function listingCoords(listing) {
  const lat = Number(listing.latitude);
  const lon = Number(listing.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon, source: 'listing_coordinates' };
}

function fullAddress(listing) {
  return [listing.address, listing.city, listing.state || 'NC', listing.zip]
    .filter(Boolean)
    .join(', ');
}

export async function geocode(db, address) {
  const key = `geocode:${normalizeAddress(address)}`;
  const cached = getGeoCache(db, key);
  if (cached) return cached;

  if (process.env.DISABLE_REMOTE_GEO === '1') {
    const fallback = fallbackGeocode(address);
    if (fallback) setGeoCache(db, key, fallback);
    return fallback;
  }

  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '1');
  url.searchParams.set('countrycodes', 'us');
  url.searchParams.set('q', address.includes('NC') ? address : `${address}, NC`);

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'HouseHunterPersonalCollector/1.0',
        'Accept': 'application/json',
      },
    });
    if (!response.ok) throw new Error(`Nominatim ${response.status}`);
    const data = await response.json();
    const first = data[0];
    if (!first) throw new Error('No geocode result');
    const coords = { lat: Number(first.lat), lon: Number(first.lon), source: 'nominatim' };
    setGeoCache(db, key, coords);
    return coords;
  } catch {
    const fallback = fallbackGeocode(address);
    if (fallback) setGeoCache(db, key, fallback);
    return fallback;
  }
}

export async function driveMinutes(db, coords) {
  const key = `route:${coords.lat.toFixed(5)},${coords.lon.toFixed(5)}:${WORK_COORDS.lat},${WORK_COORDS.lon}`;
  const cached = getGeoCache(db, key);
  if (cached) return cached;

  if (process.env.DISABLE_REMOTE_GEO === '1') return null;

  const url = `https://router.project-osrm.org/route/v1/driving/${coords.lon},${coords.lat};${WORK_COORDS.lon},${WORK_COORDS.lat}?overview=false`;
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'HouseHunterPersonalCollector/1.0' },
    });
    if (!response.ok) throw new Error(`OSRM ${response.status}`);
    const data = await response.json();
    const route = data?.routes?.[0];
    if (!route?.duration) throw new Error('No route result');
    const result = {
      minutes: Math.round(route.duration / 60),
      distance_miles: route.distance ? roundMiles(route.distance / 1609.344) : null,
      source: 'osrm',
    };
    setGeoCache(db, key, result);
    return result;
  } catch {
    return null;
  }
}

export function estimateMinutes(coords) {
  const miles = haversineMiles(coords.lat, coords.lon, WORK_COORDS.lat, WORK_COORDS.lon);
  return Math.round((miles / 36) * 60 * 1.25);
}

function roundMiles(value) {
  return Math.round(value * 10) / 10;
}

function fallbackGeocode(address) {
  const lower = String(address).toLowerCase();
  const place = KNOWN_PLACES.find((entry) => lower.includes(entry.token));
  return place ? { lat: place.lat, lon: place.lon, source: 'fallback_city' } : null;
}

function haversineMiles(lat1, lon1, lat2, lon2) {
  const toRad = (value) => (value * Math.PI) / 180;
  const radius = 3958.8;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(a));
}
