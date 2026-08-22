import { streetNameFromAddress } from './facing.js';
import { compassLabel, normalizeDegrees } from './facingLabels.js';
import { bearingDegrees, findNamedRoad } from './gisFacing.js';
import { normalizeText } from './normalize.js';
import { ROAD_CACHE_COUNTIES } from './roadCacheConfig.js';

const MAX_ROAD_DISTANCE_METERS = 260;
const MAX_REVIEW_DISTANCE_METERS = 650;

const CITY_COUNTY_PRIORITY = {
  apex: ['Wake', 'Chatham'],
  cary: ['Wake', 'Chatham'],
  carrboro: ['Orange'],
  chapelhill: ['Orange', 'Durham'],
  'chapel hill': ['Orange', 'Durham'],
  durham: ['Durham', 'Wake', 'Orange'],
  fearrington: ['Chatham'],
  'fearrington village': ['Chatham'],
  garner: ['Wake'],
  goldston: ['Chatham'],
  hillsborough: ['Orange'],
  hollysprings: ['Wake'],
  'holly springs': ['Wake'],
  knightdale: ['Wake'],
  mebane: ['Orange'],
  morrisville: ['Wake', 'Durham'],
  pittsboro: ['Chatham'],
  raleigh: ['Wake'],
  rolesville: ['Wake'],
  silercity: ['Chatham'],
  'siler city': ['Chatham'],
  wakeforest: ['Wake'],
  'wake forest': ['Wake'],
  wendell: ['Wake'],
  zebulon: ['Wake'],
};

export function classifyListingFromRoadCache(listing, roadsByCounty) {
  const point = listingCoords(listing);
  if (!point) return unknownFacing('missing_coordinates');
  if (!hasStreetNumber(listing.address)) return unknownFacing('not_a_street_address');

  const streetName = streetNameFromAddress(listing.address);
  if (!streetName || isLikelyNonStreetName(streetName)) {
    return unknownFacing('not_a_street_address', streetName);
  }

  const readyRoads = candidateCountiesForListing(listing)
    .map((county) => ({ county, roads: roadsByCounty.get(county) ?? [] }))
    .filter((entry) => entry.roads.length > 0);

  if (readyRoads.length === 0) return unknownFacing('road_cache_unavailable', streetName);

  const best = bestRoadMatch(point, streetName, readyRoads);
  if (!best) return unknownFacing('named_road_not_found', streetName);

  const degrees = Math.round(normalizeDegrees(bearingDegrees(point.lat, point.lon, best.match.nearest.lat, best.match.nearest.lon)));
  if (!isHighConfidence(best.match)) {
    return reviewFacing(streetName, best, degrees);
  }

  return {
    facing_degrees: degrees,
    facing_label: compassLabel(degrees),
    facing_status: 'known',
    facing_confidence: 'high',
    facing_source: 'estimated_named_street_county_roads',
    facing_reason: reasonText(streetName, 'auto_county_roads_high_confidence', best),
    facing_review_status: 'reviewed',
  };
}

export function candidateCountiesForListing(listing) {
  const city = normalizeText(listing.city ?? '').toLowerCase();
  const mapped = CITY_COUNTY_PRIORITY[city];
  return mapped ? [...mapped, ...ROAD_CACHE_COUNTIES.filter((county) => !mapped.includes(county))] : ROAD_CACHE_COUNTIES;
}

function bestRoadMatch(point, streetName, readyRoads) {
  return readyRoads
    .map((entry) => ({ county: entry.county, match: findNamedRoad(point, streetName, entry.roads) }))
    .filter((entry) => entry.match)
    .sort((a, b) => {
      if (b.match.match_quality !== a.match.match_quality) return b.match.match_quality - a.match.match_quality;
      return a.match.distance_meters - b.match.distance_meters;
    })[0];
}

function reviewFacing(streetName, roadMatch, degrees) {
  const confidence = roadMatch.match.distance_meters <= MAX_REVIEW_DISTANCE_METERS ? 'medium' : 'low';
  return {
    facing_degrees: degrees,
    facing_label: compassLabel(degrees),
    facing_status: 'known',
    facing_confidence: confidence,
    facing_source: 'estimated_named_street_county_roads',
    facing_reason: reasonText(streetName, 'low_confidence_needs_review', roadMatch),
    facing_review_status: 'needs_review',
  };
}

function isHighConfidence(match) {
  return match.match_quality >= 2 && match.distance_meters <= MAX_ROAD_DISTANCE_METERS;
}

function reasonText(streetName, reason, roadMatch) {
  return `${streetName}; ${reason}; ${Math.round(roadMatch.match.distance_meters)}m to ${roadMatch.match.name} in ${roadMatch.county} County`;
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

function unknownFacing(reason, streetName = '') {
  return {
    facing_degrees: null,
    facing_label: '',
    facing_status: 'unknown',
    facing_confidence: 'unknown',
    facing_source: 'estimated_named_street_county_roads',
    facing_reason: streetName ? `${streetName}; ${reason}` : reason,
    facing_review_status: 'unreviewed',
  };
}
