import { getGeoCache, setGeoCache } from './db.js';
import { compassLabel, normalizeDegrees } from './facingLabels.js';
import { normalizeText } from './normalize.js';

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const INITIAL_RADIUS_METERS = 260;
const FALLBACK_RADIUS_METERS = 700;
const DEFAULT_OVERPASS_RETRY_DELAYS_MS = [500, 1200];

export async function classifyFacing(db, listing) {
  const coords = listingCoords(listing);
  if (!coords) return unknownFacing('missing_coordinates');

  if (!hasStreetNumber(listing.address)) return unknownFacing('not_a_street_address');

  const streetName = streetNameFromAddress(listing.address);
  if (!streetName) return unknownFacing('missing_street_name');
  if (isLikelyNonStreetName(streetName)) return unknownFacing('not_a_street_address', streetName);

  const { road, lookupFailed } = await findNamedRoad(db, coords, streetName);
  if (lookupFailed && !road) return unknownFacing('map_lookup_failed', streetName);
  if (!road) return unknownFacing('named_street_not_found', streetName);

  const nearest = nearestPointOnRoad(coords, road.geometry);
  if (!nearest) return unknownFacing('road_geometry_unusable', streetName);

  const degrees = normalizeDegrees(bearingDegrees(coords.lat, coords.lon, nearest.lat, nearest.lon));
  const rounded = Math.round(degrees);
  return {
    facing_degrees: rounded,
    facing_label: compassLabel(rounded),
    facing_status: 'known',
    facing_confidence: confidenceFor(nearest.distance_meters, road.match_quality),
    facing_source: 'estimated_named_street_osm',
    facing_reason: `${streetName}; ${Math.round(nearest.distance_meters)}m to matched road`,
  };
}

export function streetNameFromAddress(address) {
  const cleaned = normalizeText(address)
    .replace(/^[0-9]+[A-Za-z]?\s+/, '')
    .replace(/,\s*.*$/, '')
    .replace(/\s+#.*$/, '')
    .replace(/\s+(Unit|Apt|Apartment|Suite|Ste)\s+.*$/i, '')
    .trim();
  return cleaned || '';
}

async function findNamedRoad(db, coords, streetName) {
  const initial = await fetchRoads(db, coords, INITIAL_RADIUS_METERS);
  if (initial.remoteFetched) await delay(overpassCallDelay());
  const fallback = await fetchRoads(db, coords, FALLBACK_RADIUS_METERS);
  const candidates = [
    ...initial.roads,
    ...fallback.roads,
  ];
  const target = canonicalStreetName(streetName);
  const matches = candidates
    .map((road) => ({ ...road, match_quality: streetMatchQuality(target, canonicalStreetName(road.name)) }))
    .filter((road) => road.match_quality > 0)
    .sort((a, b) => b.match_quality - a.match_quality);

  if (matches.length === 0) {
    return { road: null, lookupFailed: initial.lookupFailed || fallback.lookupFailed };
  }

  const road = matches
    .map((road) => ({ ...road, nearest: nearestPointOnRoad(coords, road.geometry) }))
    .filter((road) => road.nearest)
    .sort((a, b) => {
      if (b.match_quality !== a.match_quality) return b.match_quality - a.match_quality;
      return a.nearest.distance_meters - b.nearest.distance_meters;
    })[0];

  return { road, lookupFailed: false };
}

async function fetchRoads(db, coords, radiusMeters) {
  const cacheKey = `overpass:roads:${coords.lat.toFixed(4)},${coords.lon.toFixed(4)}:${radiusMeters}`;
  const cached = getGeoCache(db, cacheKey);
  if (cached) return { roads: cached, lookupFailed: false, remoteFetched: false };
  if (process.env.DISABLE_REMOTE_GEO === '1') return { roads: [], lookupFailed: false, remoteFetched: false };

  const query = `
    [out:json][timeout:18];
    way(around:${radiusMeters},${coords.lat},${coords.lon})["highway"]["name"];
    out geom;
  `;

  const retryDelays = overpassRetryDelays();
  for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
    try {
      const response = await fetch(OVERPASS_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          'User-Agent': 'HouseHunterPersonalCollector/1.0',
        },
        body: new URLSearchParams({ data: query }),
      });
      if (!response.ok) throw new Error(`Overpass ${response.status}`);
      const payload = await response.json();
      const roads = (payload.elements ?? [])
        .filter((element) => element.type === 'way' && element.tags?.name && Array.isArray(element.geometry))
        .map((element) => ({
          id: element.id,
          name: element.tags.name,
          geometry: element.geometry.map((point) => ({ lat: Number(point.lat), lon: Number(point.lon) })),
        }))
        .filter((road) => road.geometry.length >= 2);
      setGeoCache(db, cacheKey, roads);
      return { roads, lookupFailed: false, remoteFetched: true };
    } catch {
      const delayMs = retryDelays[attempt];
      if (delayMs === undefined) return { roads: [], lookupFailed: true, remoteFetched: true };
      await delay(delayMs);
    }
  }

  return { roads: [], lookupFailed: true, remoteFetched: true };
}

export function nearestPointOnRoad(point, geometry) {
  let best = null;
  for (let index = 0; index < geometry.length - 1; index += 1) {
    const candidate = nearestPointOnSegment(point, geometry[index], geometry[index + 1]);
    if (!best || candidate.distance_meters < best.distance_meters) best = candidate;
  }
  return best;
}

function nearestPointOnSegment(point, start, end) {
  const origin = project(point, point.lat);
  const a = project(start, point.lat);
  const b = project(end, point.lat);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0
    ? 0
    : Math.max(0, Math.min(1, ((origin.x - a.x) * dx + (origin.y - a.y) * dy) / lengthSquared));
  const x = a.x + t * dx;
  const y = a.y + t * dy;
  const nearest = unproject({ x, y }, point.lat);
  return {
    ...nearest,
    distance_meters: Math.hypot(origin.x - x, origin.y - y),
  };
}

function project(point, referenceLat) {
  const metersPerDegreeLat = 111_320;
  const metersPerDegreeLon = 111_320 * Math.cos((referenceLat * Math.PI) / 180);
  return {
    x: point.lon * metersPerDegreeLon,
    y: point.lat * metersPerDegreeLat,
  };
}

function unproject(point, referenceLat) {
  const metersPerDegreeLat = 111_320;
  const metersPerDegreeLon = 111_320 * Math.cos((referenceLat * Math.PI) / 180);
  return {
    lat: point.y / metersPerDegreeLat,
    lon: point.x / metersPerDegreeLon,
  };
}

function bearingDegrees(lat1, lon1, lat2, lon2) {
  const toRad = (value) => (value * Math.PI) / 180;
  const toDeg = (value) => (value * 180) / Math.PI;
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const deltaLon = toRad(lon2 - lon1);
  const y = Math.sin(deltaLon) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLon);
  return toDeg(Math.atan2(y, x));
}

function confidenceFor(distanceMeters, matchQuality) {
  if (matchQuality >= 2 && distanceMeters <= 90) return 'high';
  if (matchQuality >= 1 && distanceMeters <= 220) return 'medium';
  return 'low';
}

function streetMatchQuality(target, candidate) {
  if (!target || !candidate) return 0;
  if (target === candidate) return 3;
  if (stripStreetSuffix(target) === stripStreetSuffix(candidate)) return 2;
  return candidate.includes(target) || target.includes(candidate) ? 1 : 0;
}

function canonicalStreetName(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[.,]/g, '')
    .replace(/&/g, ' and ')
    .replace(/\b(street)\b/g, 'st')
    .replace(/\b(road)\b/g, 'rd')
    .replace(/\b(avenue)\b/g, 'ave')
    .replace(/\b(drive)\b/g, 'dr')
    .replace(/\b(lane)\b/g, 'ln')
    .replace(/\b(court)\b/g, 'ct')
    .replace(/\b(boulevard)\b/g, 'blvd')
    .replace(/\b(parkway)\b/g, 'pkwy')
    .replace(/\b(circle)\b/g, 'cir')
    .replace(/\b(place)\b/g, 'pl')
    .replace(/\b(station)\b/g, 'sta')
    .replace(/\b(terrace)\b/g, 'ter')
    .replace(/\b(trail)\b/g, 'trl')
    .replace(/\b(trace)\b/g, 'trce')
    .replace(/\b(highway)\b/g, 'hwy')
    .replace(/\b(commons)\b/g, 'cmns')
    .replace(/\b(crossing)\b/g, 'xing')
    .replace(/\b(landing)\b/g, 'lndg')
    .replace(/\b(square)\b/g, 'sq')
    .replace(/\b(extension)\b/g, 'ext')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripStreetSuffix(value) {
  return value.replace(/\s+(st|rd|ave|dr|ln|ct|blvd|pkwy|cir|pl|way|ter|trl|trce|sta|hwy|cmns|xing|lndg|sq|ext)$/i, '');
}

function listingCoords(listing) {
  const lat = Number(listing.latitude);
  const lon = Number(listing.longitude);
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}

function hasStreetNumber(address) {
  return /^[0-9]+[A-Za-z]?\b/.test(normalizeText(address));
}

function isLikelyNonStreetName(streetName) {
  return /\b(plan|model|community|homesite|lot)\b/i.test(streetName);
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function overpassRetryDelays() {
  const raw = process.env.HOUSE_HUNTER_OVERPASS_RETRY_DELAYS_MS;
  if (raw === undefined) return DEFAULT_OVERPASS_RETRY_DELAYS_MS;
  if (raw.trim() === '') return [];
  return raw
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value) && value >= 0);
}

function overpassCallDelay() {
  const raw = process.env.HOUSE_HUNTER_OVERPASS_CALL_DELAY_MS;
  if (raw === undefined) return 800;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : 800;
}

function unknownFacing(reason, streetName = '') {
  return {
    facing_degrees: null,
    facing_label: '',
    facing_status: 'unknown',
    facing_confidence: 'unknown',
    facing_source: 'estimated_named_street_osm',
    facing_reason: streetName ? `${streetName}; ${reason}` : reason,
  };
}
