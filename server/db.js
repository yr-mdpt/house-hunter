import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { COMMUTE_LIMIT_MINUTES } from './config.js';
import { ROAD_CACHE_COUNTIES } from './roadCacheConfig.js';
import { classifyCityArea } from './cityArea.js';
import { FACING_DIRECTIONS, compassLabel } from './facingLabels.js';

const DATA_DIR = join(process.cwd(), 'data');
const DB_PATH = process.env.HOUSE_HUNTER_DB ?? join(DATA_DIR, 'house-hunter.sqlite');

export function openDatabase(path = DB_PATH) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  migrate(db);
  return db;
}

export function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS listings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dedupe_key TEXT NOT NULL UNIQUE,
      url TEXT,
      address TEXT,
      city TEXT,
      city_area TEXT,
      state TEXT,
      zip TEXT,
      price INTEGER,
      beds REAL,
      baths REAL,
      sqft REAL,
      lot TEXT,
      year_built INTEGER,
      property_type TEXT,
      listing_type TEXT,
      status TEXT,
      listed_at TEXT,
      auction_at TEXT,
      latitude REAL,
      longitude REAL,
      commute_minutes REAL,
      distance_miles REAL,
      commute_status TEXT DEFAULT 'unknown_commute',
      facing_degrees REAL,
      facing_label TEXT,
      facing_status TEXT DEFAULT 'unknown',
      facing_confidence TEXT,
      facing_source TEXT,
      facing_reason TEXT,
      facing_review_status TEXT DEFAULT 'unreviewed',
      is_favorite INTEGER NOT NULL DEFAULT 0,
      photo_url TEXT,
      notes TEXT,
      source_refs TEXT NOT NULL DEFAULT '[]',
      raw_payloads TEXT NOT NULL DEFAULT '[]',
      first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      listing_id INTEGER,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      read_at TEXT,
      FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS geo_cache (
      cache_key TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS road_cache_status (
      county TEXT PRIMARY KEY,
      source_key TEXT,
      source_url TEXT,
      status TEXT NOT NULL DEFAULT 'missing',
      records_downloaded INTEGER NOT NULL DEFAULT 0,
      pages_downloaded INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      refreshed_at TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS road_segments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      county TEXT NOT NULL,
      source_key TEXT NOT NULL,
      source_url TEXT,
      external_id TEXT,
      road_name TEXT NOT NULL,
      normalized_name TEXT NOT NULL,
      geometry TEXT NOT NULL,
      from_left INTEGER,
      to_left INTEGER,
      from_right INTEGER,
      to_right INTEGER,
      raw_payload TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS road_segments_county_name_idx ON road_segments (county, normalized_name);
  `);
  ensureColumn(db, 'listings', 'url', 'TEXT');
  ensureColumn(db, 'listings', 'city_area', 'TEXT');
  ensureColumn(db, 'listings', 'distance_miles', 'REAL');
  ensureColumn(db, 'listings', 'year_built', 'INTEGER');
  ensureColumn(db, 'listings', 'facing_degrees', 'REAL');
  ensureColumn(db, 'listings', 'facing_label', 'TEXT');
  ensureColumn(db, 'listings', 'facing_status', 'TEXT');
  ensureColumn(db, 'listings', 'facing_confidence', 'TEXT');
  ensureColumn(db, 'listings', 'facing_source', 'TEXT');
  ensureColumn(db, 'listings', 'facing_reason', 'TEXT');
  ensureColumn(db, 'listings', 'facing_review_status', "TEXT DEFAULT 'unreviewed'");
  ensureColumn(db, 'listings', 'is_favorite', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'road_cache_status', 'source_key', 'TEXT');
  ensureColumn(db, 'road_cache_status', 'source_url', 'TEXT');
  ensureColumn(db, 'road_cache_status', 'records_downloaded', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'road_cache_status', 'pages_downloaded', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'road_cache_status', 'last_error', 'TEXT');
  backfillYearBuilt(db);
  backfillCityAreas(db);
  backfillFacingLabels(db);
}

export function getStats(db) {
  const total = db.prepare('SELECT COUNT(*) AS count FROM listings').get().count;
  const within = db.prepare("SELECT COUNT(*) AS count FROM listings WHERE commute_status = 'within_30_min'").get().count;
  const facingKnown = db.prepare("SELECT COUNT(*) AS count FROM listings WHERE facing_label IS NOT NULL AND facing_label != ''").get().count;
  const facingNeedsReview = db.prepare("SELECT COUNT(*) AS count FROM listings WHERE facing_review_status = 'needs_review'").get().count;
  const unread = db.prepare('SELECT COUNT(*) AS count FROM notifications WHERE read_at IS NULL').get().count;
  const sources = db.prepare("SELECT COUNT(DISTINCT json_extract(value, '$.source')) AS count FROM listings, json_each(source_refs)").get().count;
  const roadCacheReady = db.prepare("SELECT COUNT(*) AS count FROM road_cache_status WHERE status = 'ready'").get().count;
  const cachedRoads = db.prepare('SELECT COUNT(*) AS count FROM road_segments').get().count;
  return {
    total,
    within,
    facingKnown,
    facingNeedsReview,
    unread,
    sources,
    roadCacheReady,
    roadCacheTotal: ROAD_CACHE_COUNTIES.length,
    cachedRoads,
  };
}

export function listListings(db, params = {}) {
  const clauses = [];
  const values = {};
  if (params.commute && params.commute !== 'all') {
    clauses.push('commute_status = $commute');
    values.$commute = params.commute;
  }
  if (params.query) {
    clauses.push('(address LIKE $query OR city LIKE $query OR city_area LIKE $query OR zip LIKE $query OR listing_type LIKE $query)');
    values.$query = `%${params.query}%`;
  }
  const cityFilters = filterValues(params.city).map(parseCityFilter);
  if (cityFilters.length > 0) {
    const cityClauses = cityFilters.map((cityFilter, index) => {
      const key = `$city_${index}`;
      values[key] = cityFilter.value;
      return cityFilter.column === 'city_area' ? `city_area = ${key}` : `city = ${key}`;
    });
    clauses.push(`(${cityClauses.join(' OR ')})`);
  }
  const facingFilters = filterValues(params.facing);
  if (facingFilters.length > 0) {
    const facingClauses = [];
    for (const [index, value] of facingFilters.entries()) {
      const direction = String(value).toUpperCase();
      if (value === 'needs_review') {
        facingClauses.push("facing_review_status = 'needs_review'");
      } else if (value === 'unknown') {
        facingClauses.push("(facing_label IS NULL OR facing_label = '')");
      } else if (FACING_DIRECTIONS.includes(direction)) {
        const key = `$facing_${index}`;
        values[key] = direction;
        facingClauses.push(`facing_label = ${key}`);
      }
    }
    clauses.push(facingClauses.length > 0 ? `(${facingClauses.join(' OR ')})` : '1 = 0');
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const orderBy = orderByFor(params.sort);
  const rows = db.prepare(`
    SELECT * FROM listings
    ${where}
    ORDER BY ${orderBy}
    LIMIT 500
  `).all(values);
  return rows.map(decodeListing);
}

export function listCities(db) {
  const cityRows = db.prepare(`
    SELECT city, COUNT(*) AS count
    FROM listings
    WHERE city IS NOT NULL AND city != ''
    GROUP BY city
    ORDER BY city COLLATE NOCASE
  `).all();
  const areaRows = db.prepare(`
    SELECT city_area, COUNT(*) AS count
    FROM listings
    WHERE city = 'Raleigh' AND city_area IS NOT NULL AND city_area != ''
    GROUP BY city_area
    ORDER BY
      CASE city_area
        WHEN 'Raleigh NE' THEN 1
        WHEN 'Raleigh NW' THEN 2
        WHEN 'Raleigh SE' THEN 3
        WHEN 'Raleigh SW' THEN 4
        WHEN 'Raleigh Unknown' THEN 5
        ELSE 6
      END,
      city_area COLLATE NOCASE
  `).all();

  const options = [];
  for (const row of cityRows) {
    options.push({ value: `city:${row.city}`, label: row.city, city: row.city, count: row.count });
    if (row.city === 'Raleigh') {
      for (const area of areaRows) {
        options.push({ value: `area:${area.city_area}`, label: area.city_area, city: area.city_area, count: area.count });
      }
    }
  }
  return options;
}

export function listNotifications(db, options = {}) {
  const todayClause = options.all ? '' : "WHERE DATE(n.created_at, 'localtime') = DATE('now', 'localtime')";
  const limitClause = options.all ? '' : 'LIMIT 500';
  return db.prepare(`
    SELECT n.*, l.address, l.price, l.url
    FROM notifications n
    LEFT JOIN listings l ON l.id = n.listing_id
    ${todayClause}
    ORDER BY n.created_at DESC
    ${limitClause}
  `).all();
}

export function markNotificationsRead(db) {
  db.prepare('UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE read_at IS NULL').run();
}

export function clearNotifications(db) {
  return db.prepare('DELETE FROM notifications').run().changes;
}

export function listRoadCacheStatuses(db) {
  const existing = new Map(db.prepare('SELECT * FROM road_cache_status ORDER BY county').all().map((row) => [row.county, row]));
  return ROAD_CACHE_COUNTIES.map((county) => existing.get(county) ?? {
    county,
    source_key: '',
    source_url: '',
    status: 'missing',
    records_downloaded: 0,
    pages_downloaded: 0,
    last_error: '',
    refreshed_at: null,
    updated_at: null,
  });
}

export function upsertRoadCacheStatus(db, status) {
  db.prepare(`
    INSERT INTO road_cache_status (
      county, source_key, source_url, status, records_downloaded, pages_downloaded,
      last_error, refreshed_at, updated_at
    )
    VALUES (
      $county, $source_key, $source_url, $status, $records_downloaded, $pages_downloaded,
      $last_error, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
    ON CONFLICT(county) DO UPDATE SET
      source_key = excluded.source_key,
      source_url = excluded.source_url,
      status = excluded.status,
      records_downloaded = excluded.records_downloaded,
      pages_downloaded = excluded.pages_downloaded,
      last_error = excluded.last_error,
      refreshed_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
  `).run({
    $county: status.county,
    $source_key: status.source_key ?? '',
    $source_url: status.source_url ?? '',
    $status: status.status,
    $records_downloaded: status.records_downloaded ?? 0,
    $pages_downloaded: status.pages_downloaded ?? 0,
    $last_error: status.last_error ?? '',
  });
}

export function replaceRoadSegmentsForCounty(db, county, roads) {
  const remove = db.prepare('DELETE FROM road_segments WHERE county = ?');
  const insert = db.prepare(`
    INSERT INTO road_segments (
      county, source_key, source_url, external_id, road_name, normalized_name, geometry,
      from_left, to_left, from_right, to_right, raw_payload
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  db.exec('BEGIN');
  try {
    remove.run(county);
    for (const road of roads) {
      insert.run(
        county,
        road.source_key,
        road.source_url,
        road.external_id ?? '',
        road.name,
        road.normalized_name,
        JSON.stringify(road.lineStrings),
        road.from_left ?? null,
        road.to_left ?? null,
        road.from_right ?? null,
        road.to_right ?? null,
        JSON.stringify(road.raw_payload ?? {}),
      );
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function getReadyRoadSegmentsByCounty(db, counties) {
  const statuses = new Map(listRoadCacheStatuses(db).map((status) => [status.county, status.status]));
  const result = new Map();
  const statement = db.prepare(`
    SELECT * FROM road_segments
    WHERE county = ?
    ORDER BY road_name COLLATE NOCASE
  `);
  for (const county of counties) {
    if (statuses.get(county) !== 'ready') continue;
    const roads = statement.all(county).map(decodeRoadSegment);
    if (roads.length > 0) result.set(county, roads);
  }
  return result;
}

export function getGeoCache(db, key) {
  const row = db.prepare('SELECT payload FROM geo_cache WHERE cache_key = ?').get(key);
  return row ? JSON.parse(row.payload) : null;
}

export function setGeoCache(db, key, payload) {
  db.prepare(`
    INSERT INTO geo_cache (cache_key, payload, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(cache_key) DO UPDATE SET payload = excluded.payload, updated_at = CURRENT_TIMESTAMP
  `).run(key, JSON.stringify(payload));
}

export function upsertListing(db, listing) {
  const existing = db.prepare('SELECT * FROM listings WHERE dedupe_key = ?').get(listing.dedupe_key);
  const cityArea = classifyCityArea(listing);
  const sourceRef = {
    source: listing.source,
    label: listing.source_label || listing.source,
    url: listing.url,
    external_id: listing.external_id,
    seen_at: new Date().toISOString(),
  };

  if (!existing) {
    const result = db.prepare(`
      INSERT INTO listings (
        dedupe_key, url, address, city, city_area, state, zip, price, beds, baths, sqft, lot,
        year_built, property_type, listing_type, status, listed_at, auction_at, latitude, longitude, photo_url,
        notes, source_refs, raw_payloads
      )
      VALUES (
        $dedupe_key, $url, $address, $city, $city_area, $state, $zip, $price, $beds, $baths, $sqft, $lot,
        $year_built, $property_type, $listing_type, $status, $listed_at, $auction_at, $latitude, $longitude, $photo_url,
        $notes, $source_refs, $raw_payloads
      )
    `).run({
      $dedupe_key: listing.dedupe_key,
      $url: listing.url,
      $address: listing.address,
      $city: listing.city,
      $city_area: cityArea,
      $state: listing.state,
      $zip: listing.zip,
      $price: listing.price,
      $beds: listing.beds,
      $baths: listing.baths,
      $sqft: listing.sqft,
      $lot: listing.lot,
      $year_built: listing.year_built,
      $property_type: listing.property_type,
      $listing_type: listing.listing_type,
      $status: listing.status,
      $listed_at: listing.listed_at,
      $auction_at: listing.auction_at,
      $latitude: listing.latitude,
      $longitude: listing.longitude,
      $photo_url: listing.photo_url,
      $notes: listing.notes,
      $source_refs: JSON.stringify([sourceRef]),
      $raw_payloads: JSON.stringify([{ source: listing.source, payload: listing.raw, seen_at: sourceRef.seen_at }]),
    });
    createDailyNotification(db, result.lastInsertRowid, 'new_listing', 'New listing found', listing.address || listing.url || 'New listing imported');
    return { id: Number(result.lastInsertRowid), action: 'created' };
  }

  const previous = decodeListing(existing);
  const wasSeenToday = isToday(db, previous.last_seen_at);
  const merged = mergeListing(previous, listing, sourceRef);
  const mergedCityArea = classifyCityArea(merged);
  db.prepare(`
    UPDATE listings SET
      url = $url, address = $address, city = $city, city_area = $city_area, state = $state, zip = $zip,
      price = $price, beds = $beds, baths = $baths, sqft = $sqft, lot = $lot,
      year_built = $year_built, property_type = $property_type, listing_type = $listing_type, status = $status,
      listed_at = $listed_at, auction_at = $auction_at, latitude = $latitude, longitude = $longitude, photo_url = $photo_url,
      notes = $notes, source_refs = $source_refs, raw_payloads = $raw_payloads,
      last_seen_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = $id
  `).run({
    $id: existing.id,
    $url: merged.url,
    $address: merged.address,
    $city: merged.city,
    $city_area: mergedCityArea,
    $state: merged.state,
    $zip: merged.zip,
    $price: merged.price,
    $beds: merged.beds,
    $baths: merged.baths,
    $sqft: merged.sqft,
    $lot: merged.lot,
    $year_built: merged.year_built,
    $property_type: merged.property_type,
    $listing_type: merged.listing_type,
    $status: merged.status,
    $listed_at: merged.listed_at,
    $auction_at: merged.auction_at,
    $latitude: merged.latitude,
    $longitude: merged.longitude,
    $photo_url: merged.photo_url,
    $notes: merged.notes,
    $source_refs: JSON.stringify(merged.source_refs),
    $raw_payloads: JSON.stringify(merged.raw_payloads),
  });

  emitChangeNotifications(db, existing.id, previous, merged, { skipDailyAlerts: wasSeenToday });
  return { id: existing.id, action: 'updated' };
}

export function updateCommute(db, id, result) {
  const listing = db.prepare('SELECT city FROM listings WHERE id = ?').get(id) ?? {};
  const minutes = result.minutes ?? null;
  const status = minutes === null
    ? 'unknown_commute'
    : minutes <= COMMUTE_LIMIT_MINUTES
      ? 'within_30_min'
      : 'outside_30_min';
  db.prepare(`
    UPDATE listings
    SET latitude = ?, longitude = ?, city_area = ?, commute_minutes = ?, distance_miles = ?, commute_status = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    result.lat ?? null,
    result.lon ?? null,
    classifyCityArea({ ...listing, latitude: result.lat ?? null, longitude: result.lon ?? null }),
    minutes,
    result.distance_miles ?? null,
    status,
    id,
  );
}

export function updateFacing(db, id, result) {
  db.prepare(`
    UPDATE listings
    SET
      facing_degrees = ?,
      facing_label = ?,
      facing_status = ?,
      facing_confidence = ?,
      facing_source = ?,
      facing_reason = ?,
      facing_review_status = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    result.facing_degrees ?? null,
    result.facing_label ?? '',
    result.facing_label ? 'known' : 'unknown',
    result.facing_confidence ?? 'unknown',
    result.facing_source ?? '',
    result.facing_reason ?? '',
    result.facing_review_status ?? (result.facing_label ? 'reviewed' : 'unreviewed'),
    id,
  );
}

export function setListingFavorite(db, id, isFavorite) {
  return db.prepare(`
    UPDATE listings
    SET is_favorite = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(isFavorite ? 1 : 0, id).changes;
}

function mergeListing(previous, incoming, sourceRef) {
  const sourceRefs = previous.source_refs ?? [];
  if (!sourceRefs.some((ref) => ref.source === sourceRef.source && ref.url === sourceRef.url)) {
    sourceRefs.push(sourceRef);
  }

  const rawPayloads = previous.raw_payloads ?? [];
  rawPayloads.push({ source: incoming.source, payload: incoming.raw, seen_at: sourceRef.seen_at });
  while (rawPayloads.length > 10) rawPayloads.shift();

  const merged = { ...previous };
  for (const key of [
    'url', 'address', 'city', 'state', 'zip', 'price', 'beds', 'baths', 'sqft', 'lot',
    'year_built',
    'latitude', 'longitude',
    'property_type', 'listing_type', 'status', 'listed_at', 'auction_at', 'photo_url', 'notes',
  ]) {
    if (incoming[key] !== null && incoming[key] !== undefined && incoming[key] !== '') {
      merged[key] = incoming[key];
    }
  }
  merged.source_refs = sourceRefs;
  merged.raw_payloads = rawPayloads;
  return merged;
}

function emitChangeNotifications(db, id, previous, merged, options = {}) {
  if (options.skipDailyAlerts) return;
  if (previous.price && merged.price && merged.price !== previous.price) {
    createDailyNotification(db, id, 'price_change', 'Price changed', `${merged.address}: $${previous.price.toLocaleString()} -> $${merged.price.toLocaleString()}`);
  }
  if (previous.status && merged.status && previous.status !== merged.status) {
    createDailyNotification(db, id, 'status_change', 'Status changed', `${merged.address}: ${previous.status} -> ${merged.status}`);
  }
  if (previous.auction_at !== merged.auction_at && merged.auction_at) {
    createDailyNotification(db, id, 'auction_date_change', 'Auction date changed', `${merged.address}: ${merged.auction_at}`);
  }
}

function createDailyNotification(db, listingId, type, title, message) {
  const existing = db.prepare(`
    SELECT id
    FROM notifications
    WHERE listing_id = ?
      AND type = ?
      AND DATE(created_at, 'localtime') = DATE('now', 'localtime')
    LIMIT 1
  `).get(listingId, type);
  if (existing) return 0;
  return db.prepare('INSERT INTO notifications (listing_id, type, title, message) VALUES (?, ?, ?, ?)').run(listingId, type, title, message).changes;
}

function isToday(db, value) {
  if (!value) return false;
  const result = db.prepare("SELECT DATE(?, 'localtime') = DATE('now', 'localtime') AS is_today").get(value);
  return result?.is_today === 1;
}

function decodeListing(row) {
  return {
    ...row,
    city_area: row.city_area ?? null,
    is_favorite: row.is_favorite === 1,
    facing_review_status: row.facing_review_status ?? 'unreviewed',
    source_refs: safeJson(row.source_refs, []),
    raw_payloads: safeJson(row.raw_payloads, []),
  };
}

function decodeRoadSegment(row) {
  return {
    id: row.id,
    county: row.county,
    source_key: row.source_key,
    source_url: row.source_url,
    external_id: row.external_id,
    name: row.road_name,
    normalized_name: row.normalized_name,
    lineStrings: safeJson(row.geometry, []),
    from_left: row.from_left,
    to_left: row.to_left,
    from_right: row.from_right,
    to_right: row.to_right,
    raw_payload: safeJson(row.raw_payload, {}),
  };
}

function safeJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function ensureColumn(db, table, column, type) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((entry) => entry.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

function backfillCityAreas(db) {
  const rows = db.prepare(`
    SELECT id, city, latitude, longitude
    FROM listings
    WHERE city = 'Raleigh' OR city_area IS NOT NULL
  `).all();
  const update = db.prepare('UPDATE listings SET city_area = ? WHERE id = ?');
  for (const row of rows) {
    update.run(classifyCityArea(row), row.id);
  }
}

function backfillYearBuilt(db) {
  const rows = db.prepare(`
    SELECT id, raw_payloads
    FROM listings
    WHERE year_built IS NULL
  `).all();
  const update = db.prepare('UPDATE listings SET year_built = ? WHERE id = ?');
  for (const row of rows) {
    const year = yearBuiltFromRawPayloads(row.raw_payloads);
    if (year) update.run(year, row.id);
  }
}

function yearBuiltFromRawPayloads(rawPayloads) {
  for (const entry of safeJson(rawPayloads, [])) {
    const year = yearBuiltFromPayload(entry?.payload);
    if (year) return year;
  }
  return null;
}

function yearBuiltFromPayload(payload) {
  if (!payload || typeof payload !== 'object') return null;
  for (const [key, value] of Object.entries(payload)) {
    const normalizedKey = String(key).toLowerCase().replace(/[_\s-]+/g, ' ').trim();
    if (normalizedKey === 'year built' || normalizedKey === 'yearbuilt') {
      return plausibleYear(value);
    }
  }
  return null;
}

function plausibleYear(value) {
  if (value === null || value === undefined || value === '') return null;
  const match = String(value).replace(/,/g, '').match(/\b(1[7-9]\d{2}|20\d{2})\b/);
  if (!match) return null;
  const year = Number(match[1]);
  const maxYear = new Date().getFullYear() + 5;
  return year >= 1700 && year <= maxYear ? year : null;
}

function backfillFacingLabels(db) {
  const rows = db.prepare(`
    SELECT id, facing_degrees
    FROM listings
    WHERE facing_degrees IS NOT NULL
  `).all();
  const updateKnown = db.prepare("UPDATE listings SET facing_label = ?, facing_status = 'known' WHERE id = ?");
  for (const row of rows) {
    updateKnown.run(compassLabel(row.facing_degrees), row.id);
  }
  db.prepare(`
    UPDATE listings
    SET facing_status = 'unknown'
    WHERE facing_degrees IS NULL OR facing_label IS NULL OR facing_label = ''
  `).run();
}

function parseCityFilter(value) {
  if (value.startsWith('city:')) return { column: 'city', value: value.slice(5) };
  if (value.startsWith('area:')) return { column: 'city_area', value: value.slice(5) };
  return { column: 'city', value };
}

function filterValues(value) {
  const values = Array.isArray(value) ? value : [value];
  return values
    .filter((item) => item !== undefined && item !== null)
    .map((item) => String(item).trim())
    .filter((item) => item !== '' && item !== 'all');
}

function orderByFor(sort = 'commute_asc') {
  const sorts = {
    commute_asc: `
      CASE WHEN commute_minutes IS NULL THEN 1 ELSE 0 END,
      commute_minutes ASC,
      COALESCE(distance_miles, 9999) ASC,
      updated_at DESC
    `,
    price_asc: `
      CASE WHEN price IS NULL THEN 1 ELSE 0 END,
      price ASC,
      COALESCE(commute_minutes, 9999) ASC,
      updated_at DESC
    `,
    price_desc: `
      CASE WHEN price IS NULL THEN 1 ELSE 0 END,
      price DESC,
      COALESCE(commute_minutes, 9999) ASC,
      updated_at DESC
    `,
    distance_asc: `
      CASE WHEN distance_miles IS NULL THEN 1 ELSE 0 END,
      distance_miles ASC,
      COALESCE(commute_minutes, 9999) ASC,
      updated_at DESC
    `,
    facing_direction: `
      CASE WHEN facing_label IS NULL OR facing_label = '' THEN 1 ELSE 0 END,
      CASE facing_label
        WHEN 'N' THEN 1
        WHEN 'NE' THEN 2
        WHEN 'E' THEN 3
        WHEN 'SE' THEN 4
        WHEN 'S' THEN 5
        WHEN 'SW' THEN 6
        WHEN 'W' THEN 7
        WHEN 'NW' THEN 8
        ELSE 9
      END,
      COALESCE(commute_minutes, 9999) ASC,
      updated_at DESC
    `,
    updated_desc: 'updated_at DESC',
  };
  return sorts[sort] ?? sorts.commute_asc;
}
