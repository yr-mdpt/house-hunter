import { compassLabel, isFacingOk, streetNameFromAddress } from './facing.js';
import { normalizeText } from './normalize.js';

const MAX_BUILDING_DISTANCE_METERS = 120;
const MAX_ROAD_DISTANCE_METERS = 900;

export function classifyGisFacing(listing, gisData) {
  const point = listingCoords(listing);
  if (!point) return unknownResult('missing_coordinates');
  if (!hasStreetNumber(listing.address)) return unknownResult('not_a_street_address');

  const streetName = streetNameFromAddress(listing.address);
  if (!streetName || isLikelyNonStreetName(streetName)) return unknownResult('not_a_street_address', streetName);

  const building = findBuilding(point, gisData.buildings ?? []);
  if (!building) return unknownResult('no_building_footprint', streetName);
  if (building.distance_meters > MAX_BUILDING_DISTANCE_METERS) {
    return unknownResult('coordinate_too_far_from_building', streetName, {
      building_distance_meters: Math.round(building.distance_meters),
    });
  }

  const road = findNamedRoad(building.origin, streetName, gisData.roads ?? []);
  if (!road) return unknownResult('named_road_not_found', streetName, building);
  if (road.distance_meters > MAX_ROAD_DISTANCE_METERS) {
    return unknownResult('matched_named_road_too_far', streetName, {
      ...building,
      matched_road_name: road.name,
      road_distance_meters: Math.round(road.distance_meters),
    });
  }

  const degrees = Math.round(normalizeDegrees(bearingDegrees(building.origin.lat, building.origin.lon, road.nearest.lat, road.nearest.lon)));
  const confidence = confidenceFor(building, road);
  return {
    gis_status: isFacingOk(degrees) ? 'ok' : 'not_ok',
    facing_degrees: degrees,
    facing_label: compassLabel(degrees),
    confidence,
    reason: confidence === 'high' ? 'auto_gis_high_confidence' : 'auto_gis_needs_review',
    matched_road_name: road.name,
    building_distance_meters: Math.round(building.distance_meters),
    road_distance_meters: Math.round(road.distance_meters),
    building_id: building.id,
    road_id: road.id,
  };
}

export function findBuilding(point, buildings) {
  const candidates = buildings
    .map((building) => buildingCandidate(point, building))
    .filter(Boolean)
    .sort((a, b) => {
      if (a.contains !== b.contains) return a.contains ? -1 : 1;
      return a.distance_meters - b.distance_meters;
    });

  if (candidates.length === 0) return null;
  const best = candidates[0];
  const nearby = candidates.filter((candidate) => candidate.distance_meters <= Math.max(15, best.distance_meters + 8));
  return {
    ...best,
    ambiguous: !best.contains && nearby.length > 1,
  };
}

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

export function pointInPolygon(point, polygon) {
  if (!Array.isArray(polygon) || polygon.length === 0) return false;
  if (!pointInRing(point, polygon[0])) return false;
  return !polygon.slice(1).some((ring) => pointInRing(point, ring));
}

export function pointInMultiPolygon(point, multiPolygon) {
  return (multiPolygon ?? []).some((polygon) => pointInPolygon(point, polygon));
}

export function polygonCentroid(polygon, referenceLat) {
  const ring = polygon?.[0] ?? [];
  if (ring.length === 0) return null;

  const projected = ring.map((point) => project(point, referenceLat));
  let twiceArea = 0;
  let x = 0;
  let y = 0;

  for (let index = 0; index < projected.length; index += 1) {
    const current = projected[index];
    const next = projected[(index + 1) % projected.length];
    const cross = current.x * next.y - next.x * current.y;
    twiceArea += cross;
    x += (current.x + next.x) * cross;
    y += (current.y + next.y) * cross;
  }

  if (Math.abs(twiceArea) < 0.000001) {
    const totals = projected.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), { x: 0, y: 0 });
    return unproject({ x: totals.x / projected.length, y: totals.y / projected.length }, referenceLat);
  }

  return unproject({ x: x / (3 * twiceArea), y: y / (3 * twiceArea) }, referenceLat);
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

export function nearestPointOnPolygon(point, multiPolygon) {
  let best = null;
  for (const polygon of multiPolygon ?? []) {
    for (const ring of polygon ?? []) {
      const candidate = nearestPointOnLineString(point, ring);
      if (candidate && (!best || candidate.distance_meters < best.distance_meters)) best = candidate;
    }
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

export function geoJsonFeatureToBuilding(feature) {
  const geometry = feature?.geometry;
  const multiPolygon = geometryToMultiPolygon(geometry);
  if (!multiPolygon) return null;
  return {
    id: feature.id ?? feature.properties?.id ?? feature.properties?.overture_id ?? '',
    multiPolygon,
  };
}

export function geoJsonFeatureToRoad(feature) {
  const geometry = feature?.geometry;
  const lineStrings = geometryToLineStrings(geometry);
  const name = feature.properties?.name ?? feature.properties?.primary_name ?? feature.properties?.names?.primary ?? '';
  if (!lineStrings || !name) return null;
  return {
    id: feature.id ?? feature.properties?.id ?? feature.properties?.overture_id ?? '',
    name,
    lineStrings,
  };
}

function buildingCandidate(point, building) {
  const multiPolygon = building.multiPolygon;
  if (!multiPolygon?.length) return null;
  const contains = pointInMultiPolygon(point, multiPolygon);
  const nearest = nearestPointOnPolygon(point, multiPolygon);
  const centroid = largestPolygonCentroid(multiPolygon, point.lat);
  if (!nearest || !centroid) return null;
  return {
    id: building.id,
    origin: centroid,
    contains,
    distance_meters: contains ? 0 : nearest.distance_meters,
  };
}

function largestPolygonCentroid(multiPolygon, referenceLat) {
  let largest = null;
  for (const polygon of multiPolygon) {
    const area = Math.abs(projectedRingArea(polygon[0] ?? [], referenceLat));
    if (!largest || area > largest.area) largest = { area, centroid: polygonCentroid(polygon, referenceLat) };
  }
  return largest?.centroid ?? null;
}

function projectedRingArea(ring, referenceLat) {
  const projected = ring.map((point) => project(point, referenceLat));
  let area = 0;
  for (let index = 0; index < projected.length; index += 1) {
    const current = projected[index];
    const next = projected[(index + 1) % projected.length];
    area += current.x * next.y - next.x * current.y;
  }
  return area / 2;
}

function confidenceFor(building, road) {
  if (!building.ambiguous && building.distance_meters <= 25 && road.match_quality >= 2 && road.distance_meters <= 180) return 'high';
  if (building.distance_meters <= 70 && road.match_quality >= 1 && road.distance_meters <= 420) return 'medium';
  return 'low';
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

function pointInRing(point, ring) {
  let inside = false;
  for (let index = 0, previousIndex = ring.length - 1; index < ring.length; previousIndex = index, index += 1) {
    const current = ring[index];
    const previous = ring[previousIndex];
    const intersects = ((current.lat > point.lat) !== (previous.lat > point.lat))
      && (point.lon < ((previous.lon - current.lon) * (point.lat - current.lat)) / (previous.lat - current.lat) + current.lon);
    if (intersects) inside = !inside;
  }
  return inside;
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

function geometryToMultiPolygon(geometry) {
  if (geometry?.type === 'Polygon') return [coordinatesToPolygon(geometry.coordinates)];
  if (geometry?.type === 'MultiPolygon') return geometry.coordinates.map(coordinatesToPolygon);
  return null;
}

function geometryToLineStrings(geometry) {
  if (geometry?.type === 'LineString') return [coordinatesToLineString(geometry.coordinates)];
  if (geometry?.type === 'MultiLineString') return geometry.coordinates.map(coordinatesToLineString);
  return null;
}

function coordinatesToPolygon(coordinates) {
  return coordinates.map((ring) => ring.map(coordinateToPoint));
}

function coordinatesToLineString(coordinates) {
  return coordinates.map(coordinateToPoint);
}

function coordinateToPoint(coordinate) {
  return { lon: Number(coordinate[0]), lat: Number(coordinate[1]) };
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

function normalizeDegrees(degrees) {
  return ((degrees % 360) + 360) % 360;
}

function unknownResult(reason, streetName = '', details = {}) {
  return {
    gis_status: 'unknown',
    facing_degrees: null,
    facing_label: '',
    confidence: 'unknown',
    reason: streetName ? `${streetName}; ${reason}` : reason,
    matched_road_name: details.matched_road_name ?? '',
    building_distance_meters: details.building_distance_meters ?? null,
    road_distance_meters: details.road_distance_meters ?? null,
    building_id: details.id ?? details.building_id ?? '',
    road_id: details.road_id ?? '',
  };
}
