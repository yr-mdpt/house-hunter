import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { openDatabase, upsertListing, listListings, listCities, listNotifications, clearNotifications, updateCommute, updateFacing, getStats } from './db.js';
import { classifyCityArea } from './cityArea.js';
import { compactListing } from './normalize.js';

test('dedupes by normalized address and emits change notifications', () => {
  const dir = mkdtempSync(join(tmpdir(), 'house-hunter-'));
  const db = openDatabase(join(dir, 'test.sqlite'));

  const first = compactListing({
    source: 'redfin_export',
    address: '123 Main Street, Durham, NC 27703',
    price: '$500,000',
    status: 'active',
  });
  const second = compactListing({
    source: 'zillow_email',
    address: '123 Main St Durham NC 27703',
    price: '$475,000',
    status: 'pending',
  });

  assert.equal(upsertListing(db, first).action, 'created');
  assert.equal(upsertListing(db, second).action, 'updated');

  const listings = listListings(db);
  assert.equal(listings.length, 1);
  assert.equal(listings[0].price, 475000);
  assert.equal(listings[0].status, 'pending');

  const notifications = listNotifications(db);
  assert.equal(notifications.some((item) => item.type === 'new_listing'), true);
  assert.equal(notifications.some((item) => item.type === 'price_drop'), true);
  assert.equal(notifications.some((item) => item.type === 'status_change'), true);

  const cleared = clearNotifications(db);
  assert.equal(cleared, notifications.length);
  assert.equal(listNotifications(db).length, 0);
});

test('filters by city and sorts by price and commute distance', () => {
  const dir = mkdtempSync(join(tmpdir(), 'house-hunter-'));
  const db = openDatabase(join(dir, 'test.sqlite'));

  const durham = upsertListing(db, compactListing({
    source: 'redfin_export',
    address: '10 Main St',
    city: 'Durham',
    state: 'NC',
    price: 450000,
  }));
  const apex = upsertListing(db, compactListing({
    source: 'redfin_export',
    address: '20 Main St',
    city: 'Apex',
    state: 'NC',
    price: 350000,
  }));

  updateCommute(db, durham.id, { lat: 35.9, lon: -78.8, minutes: 20, distance_miles: 12.5 });
  updateCommute(db, apex.id, { lat: 35.7, lon: -78.9, minutes: 30, distance_miles: 18.2 });

  assert.deepEqual(listCities(db).map((item) => item.label), ['Apex', 'Durham']);
  assert.equal(listListings(db, { city: 'Apex' }).length, 1);
  assert.equal(listListings(db, { city: 'city:Apex' }).length, 1);
  assert.equal(listListings(db, { sort: 'price_asc' })[0].city, 'Apex');
  assert.equal(listListings(db, { sort: 'commute_asc' })[0].city, 'Durham');
  assert.equal(listListings(db, { sort: 'distance_asc' })[0].distance_miles, 12.5);
});

test('classifies Raleigh listings into quadrants around downtown', () => {
  assert.equal(classifyCityArea({ city: 'Raleigh', latitude: 35.79, longitude: -78.63 }), 'Raleigh NE');
  assert.equal(classifyCityArea({ city: 'Raleigh', latitude: 35.79, longitude: -78.65 }), 'Raleigh NW');
  assert.equal(classifyCityArea({ city: 'Raleigh', latitude: 35.77, longitude: -78.63 }), 'Raleigh SE');
  assert.equal(classifyCityArea({ city: 'Raleigh', latitude: 35.77, longitude: -78.65 }), 'Raleigh SW');
  assert.equal(classifyCityArea({ city: 'Raleigh', latitude: null, longitude: null }), 'Raleigh Unknown');
  assert.equal(classifyCityArea({ city: 'Durham', latitude: 35.79, longitude: -78.63 }), null);
});

test('adds Raleigh area options to city filter and filters by area', () => {
  const dir = mkdtempSync(join(tmpdir(), 'house-hunter-'));
  const db = openDatabase(join(dir, 'test.sqlite'));

  const ne = upsertListing(db, compactListing({
    source: 'redfin_export',
    address: '100 North East St',
    city: 'Raleigh',
    state: 'NC',
  }));
  const sw = upsertListing(db, compactListing({
    source: 'redfin_export',
    address: '200 South West St',
    city: 'Raleigh',
    state: 'NC',
  }));
  upsertListing(db, compactListing({
    source: 'redfin_export',
    address: '300 Main St',
    city: 'Durham',
    state: 'NC',
  }));

  updateCommute(db, ne.id, { lat: 35.79, lon: -78.63, minutes: 25, distance_miles: 12 });
  updateCommute(db, sw.id, { lat: 35.77, lon: -78.65, minutes: 28, distance_miles: 14 });

  const options = listCities(db).map((item) => item.label);
  assert.deepEqual(options, ['Durham', 'Raleigh', 'Raleigh NE', 'Raleigh SW']);
  assert.equal(listListings(db, { city: 'city:Raleigh' }).length, 2);
  assert.equal(listListings(db, { city: 'area:Raleigh NE' }).length, 1);
  assert.equal(listListings(db, { city: 'area:Raleigh NE' })[0].address, '100 North East St');
  assert.equal(listListings(db, { query: 'Raleigh SW' }).length, 1);
});

test('backfills city area for existing Raleigh rows on migration', () => {
  const dir = mkdtempSync(join(tmpdir(), 'house-hunter-'));
  const path = join(dir, 'test.sqlite');
  const db = openDatabase(path);
  const listing = upsertListing(db, compactListing({
    source: 'redfin_export',
    address: '400 Legacy St',
    city: 'Raleigh',
    state: 'NC',
    latitude: 35.79,
    longitude: -78.63,
  }));

  db.prepare('UPDATE listings SET city_area = NULL WHERE id = ?').run(listing.id);
  db.close();

  const reopened = openDatabase(path);
  assert.equal(listListings(reopened, { city: 'area:Raleigh NE' }).length, 1);
});

test('counts known facing labels and filters by direction', () => {
  const dir = mkdtempSync(join(tmpdir(), 'house-hunter-'));
  const db = openDatabase(join(dir, 'test.sqlite'));

  const northeast = upsertListing(db, compactListing({
    source: 'redfin_export',
    address: '720 Keystone Park Dr',
    city: 'Morrisville',
    state: 'NC',
    price: 410000,
  }));
  const south = upsertListing(db, compactListing({
    source: 'redfin_export',
    address: '1417 Merrion Ave',
    city: 'Durham',
    state: 'NC',
    price: 390000,
  }));

  updateFacing(db, northeast.id, {
    facing_degrees: 45,
    facing_label: 'NE',
    facing_status: 'known',
    facing_confidence: 'high',
    facing_source: 'test',
    facing_reason: 'test road',
  });
  updateFacing(db, south.id, {
    facing_degrees: 180,
    facing_label: 'S',
    facing_status: 'known',
    facing_confidence: 'high',
    facing_source: 'test',
    facing_reason: 'test road',
  });

  assert.equal(getStats(db).facingKnown, 2);
  assert.equal(listListings(db, { facing: 'NE' }).length, 1);
  assert.equal(listListings(db, { facing: 'S' }).length, 1);
  assert.equal(listListings(db, { facing: 'unknown' }).length, 0);
  assert.equal(listListings(db, { sort: 'facing_direction' })[0].address, '720 Keystone Park Dr');
});
