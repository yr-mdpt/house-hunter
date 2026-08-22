import { normalizeText } from './normalize.js';

export function findNamedRoad(origin, streetName, roads) {
  const target = canonicalStreetName(streetName);
  const matches = roads
    .map((road) => ({
      ...road,
      match_quality: streetMatchQuality(target, canonicalStreetName(road.name)),
      nearest: nearestPointOnLineStrings(origin, road.lineStrings ?? []),
    }))
    .filter((road) => road.match_quality > 0 && road.nearest)
    .sort((a, b) => {
      if (b.match_quality !== a.match_quality) return b.match_quality - a.match_quality;
      return a.nearest.distance_meters - b.nearest.distance_meters;
    });

  return matches[0] ? {
    ...matches[0],
    distance_meters: matches[0].nearest.distance_meters,
  } : null;
}

export function nearestPointOnLineStrings(point, lineStrings) {
  let best = null;
  for (const lineString of lineStrings) {
    const candidate = nearestPointOnLineString(point, lineString);
    if (candidate && (!best || candidate.distance_meters < best.distance_meters)) best = candidate;
  }
  return best;
}

export function nearestPointOnLineString(point, lineString) {
  let best = null;
  for (let index = 0; index < lineString.length - 1; index += 1) {
    const candidate = nearestPointOnSegment(point, lineString[index], lineString[index + 1]);
    if (!best || candidate.distance_meters < best.distance_meters) best = candidate;
  }
  return best;
}

export function bearingDegrees(lat1, lon1, lat2, lon2) {
  const toRad = (value) => (value * Math.PI) / 180;
  const toDeg = (value) => (value * 180) / Math.PI;
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const deltaLon = toRad(lon2 - lon1);
  const y = Math.sin(deltaLon) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLon);
  return toDeg(Math.atan2(y, x));
}

export function canonicalStreetName(value) {
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

function streetMatchQuality(target, candidate) {
  if (!target || !candidate) return 0;
  if (target === candidate) return 3;
  if (stripStreetSuffix(target) === stripStreetSuffix(candidate)) return 2;
  return candidate.includes(target) || target.includes(candidate) ? 1 : 0;
}

function stripStreetSuffix(value) {
  return value.replace(/\s+(st|rd|ave|dr|ln|ct|blvd|pkwy|cir|pl|way|ter|trl|trce|sta|hwy|cmns|xing|lndg|sq|ext)$/i, '');
}
