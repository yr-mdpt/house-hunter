import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { openDatabase, getReadyRoadSegmentsByCounty, listListings, replaceRoadSegmentsForCounty, updateFacing, upsertListing, upsertRoadCacheStatus } from './db.js';
import { arcGisFeatureToRoad, candidateCountiesForListing, classifyListingFromRoadCache, fetchArcGisRoads, roadNameFromAttributes } from './roadCache.js';
import { compactListing } from './normalize.js';

test('builds normalized road names from NG911 field pieces', () => {
  assert.equal(roadNameFromAttributes({
    st_name: 'Keystone Park',
    st_postyp: 'Dr',
  }), 'Keystone Park Dr');
  assert.equal(roadNameFromAttributes({
    FullStreetName: 'Cathedral Comb Drive',
    st_name: 'Ignored',
  }), 'Cathedral Comb Drive');
});

test('converts ArcGIS road centerline features to cached road records', () => {
  const road = arcGisFeatureToRoad({
    attributes: {
      objectid: 7,
      county_l: 'Durham',
      st_name: 'Merrion',
      st_postyp: 'Ave',
      fromaddr_l: 1400,
      toaddr_l: 1498,
    },
    geometry: {
      paths: [[[-78.9, 35.9], [-78.89, 35.9]]],
    },
  }, 'Durham', { key: 'test_source', url: 'https://example.test/query' });

  assert.equal(road.name, 'Merrion Ave');
  assert.equal(road.normalized_name, 'merrion ave');
  assert.equal(road.from_left, 1400);
  assert.equal(road.lineStrings[0][0].lat, 35.9);
});

test('skips road centerlines assigned to a different county', () => {
  const road = arcGisFeatureToRoad({
    attributes: {
      county_l: 'Wake',
      county_r: 'Wake',
      st_name: 'Border',
      st_postyp: 'Rd',
    },
    geometry: {
      paths: [[[-78.9, 35.9], [-78.89, 35.9]]],
    },
  }, 'Durham', { key: 'test_source', url: 'https://example.test/query' });

  assert.equal(road, null);
});

test('marks ArcGIS refresh partial when a later page fails', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return {
        ok: true,
        async json() {
          return {
            exceededTransferLimit: true,
            features: [{
              attributes: { objectid: 1, st_name: 'Nova', st_postyp: 'Dr' },
              geometry: { paths: [[[-78.9, 35.9], [-78.89, 35.9]]] },
            }],
          };
        },
      };
    }
    throw new Error('page timed out');
  };

  try {
    const result = await fetchArcGisRoads('Durham', { key: 'test', label: 'Test Roads', url: 'https://example.test/query' });
    assert.equal(result.status, 'partial');
    assert.equal(result.roads.length, 1);
    assert.equal(result.error, 'page timed out');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('county road cache classifier only auto-saves high confidence direction matches', () => {
  const roads = new Map([[
    'Durham',
    [{
      id: 'road-1',
      name: 'Merrion Ave',
      lineStrings: [[
        { lat: 35.899, lon: -78.91 },
        { lat: 35.899, lon: -78.89 },
      ]],
    }],
  ]]);

  const listing = {
    address: '1417 Merrion Ave',
    city: 'Durham',
    state: 'NC',
    latitude: 35.900,
    longitude: -78.900,
  };
  const result = classifyListingFromRoadCache(listing, roads);

  assert.equal(result.facing_status, 'known');
  assert.equal(result.facing_label, 'S');
  assert.equal(result.facing_confidence, 'high');
  assert.equal(result.facing_review_status, 'reviewed');
  assert.match(result.facing_reason, /auto_county_roads_high_confidence/);

  const review = classifyListingFromRoadCache({
    ...listing,
    longitude: -78.916,
  }, roads);
  assert.equal(review.facing_status, 'known');
  assert.equal(review.facing_review_status, 'needs_review');
  assert.match(review.facing_reason, /low_confidence_needs_review/);
});

test('stores road cache status and returns only ready county roads', () => {
  const dir = mkdtempSync(join(tmpdir(), 'house-hunter-'));
  const db = openDatabase(join(dir, 'test.sqlite'));

  upsertRoadCacheStatus(db, {
    county: 'Durham',
    source_key: 'test_source',
    source_url: 'https://example.test/query',
    status: 'ready',
    records_downloaded: 1,
    pages_downloaded: 1,
  });
  upsertRoadCacheStatus(db, {
    county: 'Wake',
    status: 'failed',
    last_error: 'boom',
  });
  replaceRoadSegmentsForCounty(db, 'Durham', [{
    source_key: 'test_source',
    source_url: 'https://example.test/query',
    external_id: '1',
    name: 'Merrion Ave',
    normalized_name: 'merrion ave',
    lineStrings: [[{ lat: 35.899, lon: -78.91 }, { lat: 35.899, lon: -78.89 }]],
  }]);
  replaceRoadSegmentsForCounty(db, 'Wake', [{
    source_key: 'test_source',
    source_url: 'https://example.test/query',
    external_id: '2',
    name: 'Hidden Rd',
    normalized_name: 'hidden rd',
    lineStrings: [[{ lat: 35.7, lon: -78.7 }, { lat: 35.71, lon: -78.7 }]],
  }]);

  const roads = getReadyRoadSegmentsByCounty(db, ['Durham', 'Wake']);
  assert.equal(roads.get('Durham').length, 1);
  assert.equal(roads.has('Wake'), false);
});

test('keeps needs review distinct from plain unknown listings', () => {
  const dir = mkdtempSync(join(tmpdir(), 'house-hunter-'));
  const db = openDatabase(join(dir, 'test.sqlite'));
  const listing = upsertListing(db, compactListing({
    source: 'redfin_export',
    address: '100 Review Rd',
    city: 'Durham',
    state: 'NC',
  }));

  updateFacing(db, listing.id, {
    facing_degrees: 82,
    facing_label: 'E',
    facing_status: 'unknown',
    facing_confidence: 'medium',
    facing_source: 'estimated_named_street_county_roads',
    facing_reason: 'Review Rd; low_confidence_needs_review',
    facing_review_status: 'needs_review',
  });

  assert.equal(listListings(db, { facing: 'needs_review' }).length, 1);
  assert.equal(listListings(db, { facing: 'unknown' }).length, 0);
});

test('candidate counties prefer likely city counties first', () => {
  assert.deepEqual(candidateCountiesForListing({ city: 'Morrisville' }).slice(0, 2), ['Wake', 'Durham']);
  assert.deepEqual(candidateCountiesForListing({ city: 'Apex' }).slice(0, 2), ['Wake', 'Chatham']);
});
