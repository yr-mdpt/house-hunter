import test from 'node:test';
import assert from 'node:assert/strict';
import { hasStreetNumber, isLikelyNonStreetName, streetNameFromAddress } from './addressParsing.js';

test('extracts named street from listing address', () => {
  assert.equal(streetNameFromAddress('720 Keystone Park Dr'), 'Keystone Park Dr');
  assert.equal(streetNameFromAddress('2340 Stevens Pass Sta #2340'), 'Stevens Pass Sta');
  assert.equal(streetNameFromAddress('1417 Merrion Ave, Durham, NC'), 'Merrion Ave');
});

test('detects street-address-like listings', () => {
  assert.equal(hasStreetNumber('720 Keystone Park Dr'), true);
  assert.equal(hasStreetNumber('Westmore Plan'), false);
});

test('detects plan and community-style street names', () => {
  assert.equal(isLikelyNonStreetName('Westmore Plan'), true);
  assert.equal(isLikelyNonStreetName('Keystone Park Dr'), false);
});
