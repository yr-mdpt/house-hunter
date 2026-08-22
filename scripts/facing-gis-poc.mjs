import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import {
  classifyGisFacing,
  geoJsonFeatureToBuilding,
  geoJsonFeatureToRoad,
} from '../server/gisFacing.js';

const DATA_DIR = join(process.cwd(), 'data');
const GIS_DIR = join(DATA_DIR, 'gis');
const DB_PATH = process.env.HOUSE_HUNTER_DB ?? join(DATA_DIR, 'house-hunter.sqlite');
const BUILDINGS_FILE = join(GIS_DIR, 'overture-buildings.geojsonseq');
const ROADS_FILE = join(GIS_DIR, 'overture-roads.geojsonseq');
const REPORT_FILE = join(GIS_DIR, 'facing-poc-report.json');
const OVERTURE_RELEASE = process.env.OVERTURE_RELEASE ?? '2026-07-22.0';
const DEFAULT_SAMPLE_SIZE = 40;

async function main() {
  const options = parseArgs(process.argv.slice(2));
  mkdirSync(GIS_DIR, { recursive: true });

  const db = new DatabaseSync(DB_PATH);
  const listings = db.prepare(`
    SELECT id, address, city, state, zip, latitude, longitude, facing_status, facing_label, facing_degrees, facing_confidence, facing_reason
    FROM listings
    WHERE latitude IS NOT NULL AND longitude IS NOT NULL
    ORDER BY id
  `).all();

  if (listings.length === 0) {
    throw new Error('No geocoded listings found. Import listings and refresh commutes before running the GIS POC.');
  }

  const sample = options.all ? listings : selectSampleListings(listings, options.sampleSize);

  if ((!usableFile(BUILDINGS_FILE) || !usableFile(ROADS_FILE)) && !options.skipExtract) {
    extractOvertureData(sample);
  }

  if (!usableFile(BUILDINGS_FILE) || !usableFile(ROADS_FILE)) {
    throw new Error([
      'Missing local GIS files in data/gis.',
      'Run `npm run facing:gis-poc` with DuckDB installed, or provide:',
      `- ${BUILDINGS_FILE}`,
      `- ${ROADS_FILE}`,
    ].join('\n'));
  }

  const gisData = {
    buildings: loadGeoJsonSeq(BUILDINGS_FILE, geoJsonFeatureToBuilding),
    roads: loadGeoJsonSeq(ROADS_FILE, geoJsonFeatureToRoad),
  };

  const report = sample.map((listing) => ({
    listing_id: listing.id,
    address: listing.address,
    city: listing.city,
    current_facing: currentFacingLabel(listing),
    ...classifyGisFacing(listing, gisData),
  }));

  const summary = summarize(report);
  writeFileSync(REPORT_FILE, `${JSON.stringify({ generated_at: new Date().toISOString(), summary, report }, null, 2)}\n`);

  console.log(`Loaded ${gisData.buildings.length.toLocaleString()} buildings and ${gisData.roads.length.toLocaleString()} named roads.`);
  console.log(`Sampled ${report.length.toLocaleString()} listings. Report saved to ${REPORT_FILE}.`);
  console.table(summary);
  console.table(report.map((row) => ({
    address: row.address,
    current: row.current_facing,
    gis: row.gis_status === 'unknown' ? 'unknown' : `${row.gis_status} ${row.facing_degrees} ${row.facing_label}`,
    confidence: row.confidence,
    reason: row.reason,
    road: row.matched_road_name,
    building_m: row.building_distance_meters,
    road_m: row.road_distance_meters,
  })));
}

function extractOvertureData(listings) {
  const bbox = bboxForListings(listings);
  console.log(`Extracting Overture ${OVERTURE_RELEASE} GIS data near ${listings.length} sampled listings.`);
  console.log(`Sample extent: ${JSON.stringify(bbox)}.`);
  removeExtractionFile(BUILDINGS_FILE);
  removeExtractionFile(ROADS_FILE);

  const overture = findOvertureMaps();
  if (overture) {
    runOvertureMaps(overture, 'building', BUILDINGS_FILE, bbox);
    runOvertureMaps(overture, 'segment', ROADS_FILE, bbox);
    return;
  }

  const duckdb = findDuckDb();
  if (!duckdb) {
    throw new Error([
      'First-time Overture extraction requires either the official `overturemaps` Python CLI or DuckDB.',
      'Recommended: run `python -m pip install overturemaps`, then rerun `npm run facing:gis-poc`.',
      'If you already have GIS files, place them in data/gis and rerun with `npm run facing:gis-poc -- --skip-extract`.',
    ].join('\n'));
  }

  console.log('The official overturemaps CLI was not found; falling back to DuckDB extraction.');
  runDuckDb(duckdb, buildExtractionSql('buildings', BUILDINGS_FILE, listings));
  runDuckDb(duckdb, buildExtractionSql('roads', ROADS_FILE, listings));
}

function runOvertureMaps(overture, type, outputFile, bbox) {
  const bboxArg = `${bbox.west},${bbox.south},${bbox.east},${bbox.north}`;
  const result = spawnSync(overture.command, [
    ...overture.args,
    'download',
    `--bbox=${bboxArg}`,
    '-f',
    'geojsonseq',
    `--type=${type}`,
    '--release',
    OVERTURE_RELEASE,
    '--no-stac',
    '-o',
    outputFile,
  ], { encoding: 'utf8', shell: false });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr && result.status === 0) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error([
      `overturemaps extraction failed for ${type} with exit code ${result.status}.`,
      conciseCliError(result.stderr),
      'You can still provide pre-extracted GeoJSONSeq files in data/gis or try the DuckDB fallback by temporarily removing the overturemaps CLI from PATH.',
    ].filter(Boolean).join('\n'));
  }
}

function buildExtractionSql(kind, outputFile, listings) {
  const output = duckPath(outputFile);
  const releasePath = `s3://overturemaps-us-west-2/release/${OVERTURE_RELEASE}`;
  const spatialWhere = spatialWhereForListings(listings);

  const query = kind === 'buildings'
    ? `
      SELECT id, geometry
      FROM read_parquet('${releasePath}/theme=buildings/type=building/*', filename=true, hive_partitioning=1)
      WHERE ${spatialWhere}
    `
    : `
      SELECT id, names.primary AS name, class, geometry
      FROM read_parquet('${releasePath}/theme=transportation/type=segment/*', filename=true, hive_partitioning=1)
      WHERE subtype = 'road'
        AND names.primary IS NOT NULL
        AND ${spatialWhere}
    `;

  return `
    INSTALL spatial;
    LOAD spatial;
    INSTALL httpfs;
    LOAD httpfs;
    SET s3_region='us-west-2';
    COPY (${query}) TO '${output}' WITH (FORMAT GDAL, DRIVER 'GeoJSONSeq');
  `;
}

function runDuckDb(duckdb, sql) {
  const result = spawnSync(duckdb, ['-c', sql], { stdio: 'inherit', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`DuckDB extraction failed with exit code ${result.status}.`);
}

function findDuckDb() {
  const localAppData = process.env.LOCALAPPDATA;
  const candidates = [
    'duckdb',
    'duckdb.exe',
    localAppData ? join(localAppData, 'Microsoft', 'WinGet', 'Links', 'duckdb.exe') : '',
    localAppData ? join(localAppData, 'Microsoft', 'WinGet', 'Packages', 'DuckDB.cli_Microsoft.Winget.Source_8wekyb3d8bbwe', 'duckdb.exe') : '',
  ].filter(Boolean);

  for (const command of candidates) {
    const result = spawnSync(command, ['--version'], { encoding: 'utf8', shell: false });
    if (result.status === 0) return command;
  }
  return null;
}

function findOvertureMaps() {
  const candidates = [
    { command: 'overturemaps', args: [] },
    { command: 'python', args: ['-m', 'overturemaps'] },
    { command: 'py', args: ['-m', 'overturemaps'] },
  ];

  for (const candidate of candidates) {
    const result = spawnSync(candidate.command, [...candidate.args, '--help'], { encoding: 'utf8', shell: false });
    if (result.status === 0) return candidate;
  }
  return null;
}

function loadGeoJsonSeq(file, mapper) {
  return readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => mapper(JSON.parse(line)))
    .filter(Boolean);
}

function spatialWhereForListings(listings) {
  const pad = 0.012;
  return listings
    .map((listing) => {
      const lat = Number(listing.latitude);
      const lon = Number(listing.longitude);
      return `(
        bbox.xmin < ${lon + pad}
        AND bbox.xmax > ${lon - pad}
        AND bbox.ymin < ${lat + pad}
        AND bbox.ymax > ${lat - pad}
      )`;
    })
    .join('\n      OR ');
}

function selectSampleListings(listings, sampleSize) {
  const selected = [];
  const add = (items) => {
    for (const item of items) {
      if (selected.length >= sampleSize) return;
      if (!selected.some((existing) => existing.id === item.id)) selected.push(item);
    }
  };

  add(listings.filter((listing) => /merrion|keystone park|cathedral comb|nova|deercroft/i.test(listing.address ?? '')));
  add(listings.filter((listing) => String(listing.facing_reason ?? '').includes('map_lookup_failed')));
  add(listings.filter((listing) => String(listing.facing_reason ?? '').includes('named_street_not_found')));
  add(listings.filter((listing) => listing.facing_status === 'ok' || listing.facing_status === 'not_ok'));
  add(listings);
  return selected.slice(0, sampleSize);
}

function summarize(report) {
  const counts = {
    total: report.length,
    high_confidence_resolved: 0,
    medium_confidence_resolved: 0,
    low_confidence_resolved: 0,
    unknown: 0,
    no_building_footprint: 0,
    named_road_not_found: 0,
    coordinate_too_far_from_building: 0,
  };

  for (const row of report) {
    if (row.gis_status === 'unknown') counts.unknown += 1;
    if (row.confidence === 'high') counts.high_confidence_resolved += 1;
    if (row.confidence === 'medium') counts.medium_confidence_resolved += 1;
    if (row.confidence === 'low') counts.low_confidence_resolved += 1;
    if (row.reason.includes('no_building_footprint')) counts.no_building_footprint += 1;
    if (row.reason.includes('named_road_not_found')) counts.named_road_not_found += 1;
    if (row.reason.includes('coordinate_too_far_from_building')) counts.coordinate_too_far_from_building += 1;
  }

  counts.high_confidence_rate = counts.total ? Number((counts.high_confidence_resolved / counts.total).toFixed(2)) : 0;
  return [counts];
}

function bboxForListings(listings) {
  const lats = listings.map((listing) => Number(listing.latitude)).filter(Number.isFinite);
  const lons = listings.map((listing) => Number(listing.longitude)).filter(Number.isFinite);
  const pad = 0.025;
  return {
    west: Math.min(...lons) - pad,
    south: Math.min(...lats) - pad,
    east: Math.max(...lons) + pad,
    north: Math.max(...lats) + pad,
  };
}

function currentFacingLabel(listing) {
  if (listing.facing_status === 'ok' || listing.facing_status === 'not_ok') {
    return `${listing.facing_status} ${listing.facing_degrees ?? ''} ${listing.facing_label ?? ''}`.trim();
  }
  return listing.facing_reason || 'unknown';
}

function parseArgs(args) {
  const options = { all: false, sampleSize: DEFAULT_SAMPLE_SIZE, skipExtract: false };
  for (const arg of args) {
    if (arg === '--all') options.all = true;
    if (arg === '--skip-extract') options.skipExtract = true;
    if (arg.startsWith('--sample-size=')) {
      const value = Number(arg.replace('--sample-size=', ''));
      if (Number.isFinite(value) && value > 0) options.sampleSize = value;
    }
  }
  return options;
}

function duckPath(file) {
  return file.replace(/\\/g, '/').replace(/'/g, "''");
}

function conciseCliError(stderr) {
  const lines = String(stderr ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const useful = lines.filter((line) => /error|exception|failed|not found|timeout/i.test(line));
  return useful.slice(-4).join('\n') || lines.slice(-4).join('\n');
}

function usableFile(file) {
  return existsSync(file) && statSync(file).size > 0;
}

function removeExtractionFile(file) {
  if (existsSync(file)) {
    rmSync(file, { force: true });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
