import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from './db.js';
import { classifyFacing, compassLabel, isFacingOk, nearestPointOnRoad, streetNameFromAddress } from './facing.js';

test('applies the custom 300 through 110 degree OK facing rule', () => {
  assert.equal(isFacingOk(0), true);
  assert.equal(isFacingOk(45), true);
  assert.equal(isFacingOk(110), true);
  assert.equal(isFacingOk(111), false);
  assert.equal(isFacingOk(180), false);
  assert.equal(isFacingOk(299), false);
  assert.equal(isFacingOk(300), true);
  assert.equal(isFacingOk(315), true);
});

test('converts degrees to compass labels', () => {
  assert.equal(compassLabel(0), 'N');
  assert.equal(compassLabel(44), 'NE');
  assert.equal(compassLabel(90), 'E');
  assert.equal(compassLabel(181), 'S');
  assert.equal(compassLabel(315), 'NW');
});

test('extracts named street from listing address', () => {
  assert.equal(streetNameFromAddress('720 Keystone Park Dr'), 'Keystone Park Dr');
  assert.equal(streetNameFromAddress('2340 Stevens Pass Sta #2340'), 'Stevens Pass Sta');
  assert.equal(streetNameFromAddress('1417 Merrion Ave, Durham, NC'), 'Merrion Ave');
});

test('finds nearest point on a road polyline', () => {
  const point = { lat: 35, lon: -78 };
  const road = [
    { lat: 34.999, lon: -78.001 },
    { lat: 34.999, lon: -77.999 },
  ];
  const nearest = nearestPointOnRoad(point, road);

  assert.ok(nearest.distance_meters > 100);
  assert.ok(nearest.distance_meters < 120);
});

test('marks plan rows as not street addresses', async () => {
  const db = openDatabase(':memory:');
  const result = await classifyFacing(db, {
    address: 'Westmore Plan',
    latitude: 35.6976399,
    longitude: -78.918118,
  });

  assert.equal(result.facing_status, 'unknown');
  assert.equal(result.facing_reason, 'not_a_street_address');
});

test('marks failed map lookups separately from missing named streets', async (t) => {
  process.env.HOUSE_HUNTER_OVERPASS_RETRY_DELAYS_MS = '';
  process.env.HOUSE_HUNTER_OVERPASS_CALL_DELAY_MS = '0';
  t.after(() => {
    delete process.env.HOUSE_HUNTER_OVERPASS_RETRY_DELAYS_MS;
    delete process.env.HOUSE_HUNTER_OVERPASS_CALL_DELAY_MS;
  });
  t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('rate limited');
  });

  const db = openDatabase(':memory:');
  const result = await classifyFacing(db, {
    address: '3107 Cathedral Comb Dr',
    latitude: 35.696125,
    longitude: -78.929846,
  });

  assert.equal(result.facing_status, 'unknown');
  assert.equal(result.facing_reason, 'Cathedral Comb Dr; map_lookup_failed');
});

test('matches common street suffix differences without using a nearest random street', async (t) => {
  process.env.HOUSE_HUNTER_OVERPASS_CALL_DELAY_MS = '0';
  t.after(() => {
    delete process.env.HOUSE_HUNTER_OVERPASS_CALL_DELAY_MS;
  });
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
    elements: [
      {
        type: 'way',
        id: 1,
        tags: { highway: 'residential', name: 'Cathedral Comb Drive' },
        geometry: [
          { lat: 35.6958, lon: -78.9303 },
          { lat: 35.6958, lon: -78.9293 },
        ],
      },
      {
        type: 'way',
        id: 2,
        tags: { highway: 'residential', name: 'Different Road' },
        geometry: [
          { lat: 35.6962, lon: -78.9303 },
          { lat: 35.6962, lon: -78.9293 },
        ],
      },
    ],
  }), { status: 200 }));

  const db = openDatabase(':memory:');
  const result = await classifyFacing(db, {
    address: '3107 Cathedral Comb Dr',
    latitude: 35.696125,
    longitude: -78.929846,
  });

  assert.notEqual(result.facing_status, 'unknown');
  assert.match(result.facing_reason, /^Cathedral Comb Dr; /);
});
