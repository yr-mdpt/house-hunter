import { canonicalStreetName } from './roadGeometry.js';
import { normalizeText } from './normalize.js';

const PAGE_SIZE = 2000;
const MAX_PAGES = 100;

const COUNTY_BOUNDS = {
  Durham: { west: -79.05, south: 35.83, east: -78.67, north: 36.25 },
  Wake: { west: -78.99, south: 35.48, east: -78.23, north: 36.09 },
  Orange: { west: -79.32, south: 35.82, east: -78.91, north: 36.28 },
  Chatham: { west: -79.72, south: 35.45, east: -78.77, north: 36.09 },
};

const NC_ONEMAP_NG911 = {
  key: 'nc_onemap_ng911_centerlines',
  label: 'NC OneMap NG911 Centerlines',
  url: 'https://services.gis.nc.gov/secure/rest/services/NC1Map_Transportation/FeatureServer/0/query',
};

export function sourcesForCounty(county) {
  const bounds = COUNTY_BOUNDS[county];
  if (!bounds) return [];
  return [{ ...NC_ONEMAP_NG911, bounds }];
}

export async function fetchCountyRoads(county, onProgress = () => {}) {
  const sources = sourcesForCounty(county);
  if (sources.length === 0) {
    return failedCountyResult(county, null, `No road-cache source configured for ${county}`);
  }

  let lastError = '';
  for (const source of sources) {
    try {
      const result = await fetchArcGisRoads(county, source, onProgress);
      if (result.roads.length > 0) return result;
      lastError = `${source.label} returned no usable road segments`;
    } catch (error) {
      lastError = error.message || String(error);
    }
  }

  return failedCountyResult(county, sources[0], lastError || `No usable road data found for ${county}`);
}

export async function fetchArcGisRoads(county, source, onProgress = () => {}) {
  const roads = [];
  let pages = 0;
  let lastError = '';

  for (let offset = 0; offset < PAGE_SIZE * MAX_PAGES; offset += PAGE_SIZE) {
    try {
      const payload = await fetchArcGisPage(source, offset);
      const pageRoads = (payload.features ?? [])
        .map((feature) => arcGisFeatureToRoad(feature, county, source))
        .filter(Boolean);
      roads.push(...pageRoads);
      pages += 1;
      onProgress({ county, source, pages, roads: roads.length });

      const featureCount = payload.features?.length ?? 0;
      const hasMore = payload.exceededTransferLimit || featureCount === PAGE_SIZE;
      if (!hasMore || featureCount === 0) break;
    } catch (error) {
      lastError = error.message || String(error);
      break;
    }
  }

  return {
    county,
    status: roads.length > 0 ? (lastError ? 'partial' : 'ready') : 'failed',
    source,
    roads,
    pages,
    error: lastError || (roads.length > 0 ? '' : `${source.label} returned no usable road segments`),
  };
}

export function arcGisFeatureToRoad(feature, county, source) {
  const attributes = feature.attributes ?? feature.properties ?? {};
  if (!featureBelongsToCounty(attributes, county)) return null;

  const lineStrings = arcGisGeometryToLineStrings(feature.geometry);
  const roadName = roadNameFromAttributes(attributes);
  if (!roadName || !lineStrings?.length) return null;

  return {
    county,
    source_key: source.key,
    source_url: source.url,
    external_id: stringValue(attributes.objectid ?? attributes.OBJECTID ?? attributes.ObjectId ?? attributes.nguid ?? attributes.NGUID),
    name: roadName,
    normalized_name: canonicalStreetName(roadName),
    lineStrings,
    from_left: numberValue(attributes.fromaddr_l ?? attributes.FROMADDR_L ?? attributes.L_F_ADD),
    to_left: numberValue(attributes.toaddr_l ?? attributes.TOADDR_L ?? attributes.L_T_ADD),
    from_right: numberValue(attributes.fromaddr_r ?? attributes.FROMADDR_R ?? attributes.R_F_ADD),
    to_right: numberValue(attributes.toaddr_r ?? attributes.TOADDR_R ?? attributes.R_T_ADD),
    raw_payload: attributes,
  };
}

export function roadNameFromAttributes(attributes) {
  const direct = firstString(attributes, [
    'full_street_name', 'FullStreetName', 'FULL_STREET_NAME', 'FULLNAME', 'full_name',
    'streetname', 'StreetName', 'STREETNAME', 'road_name', 'ROAD_NAME', 'name', 'NAME',
  ]);
  if (direct) return direct;

  const pieces = [
    firstString(attributes, ['st_predir', 'ST_PREDIR', 'predir', 'PreDir']),
    firstString(attributes, ['st_premod', 'ST_PREMOD']),
    firstString(attributes, ['st_pretyp', 'ST_PRETYP']),
    firstString(attributes, ['st_name', 'ST_NAME', 'lst_name', 'LST_NAME', 'street_name', 'Street_Name']),
    firstString(attributes, ['st_postyp', 'ST_POSTYP', 'lst_typ', 'LST_TYP', 'street_type', 'StreetType']),
    firstString(attributes, ['st_posdir', 'ST_POSDIR']),
    firstString(attributes, ['st_posmod', 'ST_POSMOD']),
  ].filter(Boolean);
  return normalizeText(pieces.join(' '));
}

async function fetchArcGisPage(source, offset) {
  const response = await fetch(arcGisQueryUrl(source, offset), {
    headers: { 'User-Agent': 'HouseHunterPersonalCollector/1.0' },
  });
  if (!response.ok) throw new Error(`${source.label} HTTP ${response.status}`);

  const payload = await response.json();
  if (payload.error) {
    throw new Error(`${source.label}: ${payload.error.message || 'ArcGIS query failed'}`);
  }
  return payload;
}

function arcGisQueryUrl(source, offset) {
  const params = new URLSearchParams({
    f: 'json',
    where: '1=1',
    outFields: '*',
    returnGeometry: 'true',
    outSR: '4326',
    resultOffset: String(offset),
    resultRecordCount: String(PAGE_SIZE),
  });
  if (source.bounds) {
    params.set('geometry', `${source.bounds.west},${source.bounds.south},${source.bounds.east},${source.bounds.north}`);
    params.set('geometryType', 'esriGeometryEnvelope');
    params.set('inSR', '4326');
    params.set('spatialRel', 'esriSpatialRelIntersects');
  }
  return `${source.url}?${params}`;
}

function failedCountyResult(county, source, error) {
  return {
    county,
    status: 'failed',
    source,
    roads: [],
    pages: 0,
    error,
  };
}

function featureBelongsToCounty(attributes, county) {
  const countyValues = [
    attributes.county_l,
    attributes.county_r,
    attributes.COUNTY_L,
    attributes.COUNTY_R,
    attributes.county,
    attributes.COUNTY,
  ].map(stringValue).filter(Boolean);
  if (countyValues.length === 0) return true;

  const target = county.toLowerCase();
  return countyValues.some((value) => value.toLowerCase().includes(target));
}

function arcGisGeometryToLineStrings(geometry) {
  if (!geometry) return null;
  if (Array.isArray(geometry.paths)) {
    return geometry.paths
      .map((path) => path.map((point) => ({ lon: Number(point[0]), lat: Number(point[1]) })))
      .filter((path) => path.length >= 2 && path.every(validPoint));
  }
  if (geometry.type === 'LineString') return [geometry.coordinates.map(coordinateToPoint)].filter((path) => path.length >= 2);
  if (geometry.type === 'MultiLineString') return geometry.coordinates.map((path) => path.map(coordinateToPoint)).filter((path) => path.length >= 2);
  return null;
}

function firstString(attributes, keys) {
  for (const key of keys) {
    const value = stringValue(attributes[key]);
    if (value) return value;
  }
  return '';
}

function coordinateToPoint(coordinate) {
  return { lon: Number(coordinate[0]), lat: Number(coordinate[1]) };
}

function validPoint(point) {
  return Number.isFinite(point.lat) && Number.isFinite(point.lon) && Math.abs(point.lat) <= 90 && Math.abs(point.lon) <= 180;
}

function stringValue(value) {
  return value === null || value === undefined ? '' : normalizeText(String(value));
}

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
