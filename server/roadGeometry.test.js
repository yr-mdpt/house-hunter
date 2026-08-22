import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalStreetName, findNamedRoad, nearestPointOnLineString } from './roadGeometry.js';

test('normalizes common road suffix differences', () => {
  assert.equal(canonicalStreetName('Cathedral Comb Drive'), 'cathedral comb dr');
  assert.equal(canonicalStreetName('Stevens Pass Station'), 'stevens pass sta');
  assert.equal(canonicalStreetName('Keystone Park Pkwy.'), 'keystone park pkwy');
});

test('finds nearest point on a road line', () => {
  const point = { lat: 35, lon: -78 };
  const road = [
    { lat: 34.999, lon: -78.001 },
    { lat: 34.999, lon: -77.999 },
  ];
  const nearest = nearestPointOnLineString(point, road);

  assert.ok(nearest.distance_meters > 100);
  assert.ok(nearest.distance_meters < 120);
});

test('matches named roads across common suffix differences', () => {
  const road = findNamedRoad({ lat: 35.0005, lon: -78 }, 'Cathedral Comb Dr', [
    {
      id: 'road-1',
      name: 'Cathedral Comb Drive',
      lineStrings: [[
        { lat: 35.0001, lon: -78.0004 },
        { lat: 35.0001, lon: -77.9996 },
      ]],
    },
  ]);

  assert.equal(road.name, 'Cathedral Comb Drive');
  assert.equal(road.match_quality, 3);
});
