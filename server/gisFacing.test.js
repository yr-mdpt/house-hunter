import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyGisFacing,
  findNamedRoad,
  pointInPolygon,
} from './gisFacing.js';

const squareBuilding = {
  id: 'building-1',
  multiPolygon: [[[
    { lat: 35.0004, lon: -78.0001 },
    { lat: 35.0004, lon: -77.9999 },
    { lat: 35.0006, lon: -77.9999 },
    { lat: 35.0006, lon: -78.0001 },
    { lat: 35.0004, lon: -78.0001 },
  ]]],
};

test('detects whether a point is inside a polygon', () => {
  const polygon = squareBuilding.multiPolygon[0];
  assert.equal(pointInPolygon({ lat: 35.0005, lon: -78 }, polygon), true);
  assert.equal(pointInPolygon({ lat: 35.001, lon: -78 }, polygon), false);
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

test('classifies south-facing GIS result as not OK', () => {
  const result = classifyGisFacing({
    address: '1417 Merrion Ave',
    latitude: 35.0005,
    longitude: -78,
  }, {
    buildings: [squareBuilding],
    roads: [{
      id: 'merrion',
      name: 'Merrion Avenue',
      lineStrings: [[
        { lat: 34.9998, lon: -78.0005 },
        { lat: 34.9998, lon: -77.9995 },
      ]],
    }],
  });

  assert.equal(result.gis_status, 'not_ok');
  assert.equal(result.facing_label, 'S');
  assert.equal(result.confidence, 'high');
});

test('classifies northeast-facing GIS result as OK', () => {
  const result = classifyGisFacing({
    address: '720 Keystone Park Dr',
    latitude: 35.0005,
    longitude: -78,
  }, {
    buildings: [squareBuilding],
    roads: [{
      id: 'keystone',
      name: 'Keystone Park Drive',
      lineStrings: [[
        { lat: 35.0012, lon: -77.9995 },
        { lat: 35.0014, lon: -77.9993 },
      ]],
    }],
  });

  assert.equal(result.gis_status, 'ok');
  assert.equal(result.facing_label, 'NE');
});

test('keeps non-address plan rows out of automated GIS results', () => {
  const result = classifyGisFacing({
    address: 'Westmore Plan',
    latitude: 35.0005,
    longitude: -78,
  }, {
    buildings: [squareBuilding],
    roads: [],
  });

  assert.equal(result.gis_status, 'unknown');
  assert.equal(result.reason, 'not_a_street_address');
});
