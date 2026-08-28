import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { openDatabase, upsertListing, listListings, listCities, listHomeTypes, listNotifications, clearNotifications, updateCommute, updateFacing, setListingFavorite, getStats } from './db.js';
import { classifyCityArea } from './cityArea.js';
import { compactListing } from './normalize.js';

test('dedupes by normalized address and emits one new-listing notification per day', () => {
  const dir = mkdtempSync(join(tmpdir(), 'house-hunter-'));
  const db = openDatabase(join(dir, 'test.sqlite'));

  const first = compactListing({
    source: 'redfin_export',
    address: '123 Main Street, Durham, NC 27703',
    city: 'Durham',
    price: '$500,000',
    sqft: '1,980',
    status: 'active',
  });
  const second = compactListing({
    source: 'zillow_email',
    address: '123 Main St Durham NC 27703',
    city: 'Durham',
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
  const newListingNotifications = notifications.filter((item) => item.type === 'new_listing');
  assert.equal(newListingNotifications.length, 1);
  assert.match(newListingNotifications[0].message, /123 Main St/);
  assert.match(newListingNotifications[0].message, /\$475,000/);
  assert.match(newListingNotifications[0].message, /1,980 sqft/);
  assert.match(newListingNotifications[0].message, /Durham/);
  assert.match(newListingNotifications[0].message, /Facing unknown/);
  assert.equal(notifications.some((item) => item.type === 'price_change'), false);
  assert.equal(notifications.some((item) => item.type === 'status_change'), false);

  const cleared = clearNotifications(db);
  assert.equal(cleared, notifications.length);
  assert.equal(listNotifications(db).length, 0);
});

test('enriches existing new-listing notification messages from listing facts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'house-hunter-'));
  const db = openDatabase(join(dir, 'test.sqlite'));

  upsertListing(db, compactListing({
    source: 'redfin_export',
    address: '456 Legacy Notice Dr',
    city: 'Cary',
    state: 'NC',
    price: '$425,000',
    sqft: '2,120',
  }));
  db.prepare("UPDATE notifications SET message = '456 Legacy Notice Dr'").run();

  const notification = listNotifications(db).find((item) => item.type === 'new_listing');
  assert.match(notification.message, /456 Legacy Notice Dr/);
  assert.match(notification.message, /\$425,000/);
  assert.match(notification.message, /2,120 sqft/);
  assert.match(notification.message, /Cary/);
  assert.match(notification.message, /Facing unknown/);
});

test('uses Raleigh quadrant in new-listing notification location', () => {
  const dir = mkdtempSync(join(tmpdir(), 'house-hunter-'));
  const db = openDatabase(join(dir, 'test.sqlite'));

  const listing = upsertListing(db, compactListing({
    source: 'redfin_export',
    address: '789 Quadrant Ave',
    city: 'Raleigh',
    state: 'NC',
    price: '$410,000',
    sqft: '1,900',
    latitude: 35.79,
    longitude: -78.63,
  }));
  updateFacing(db, listing.id, {
    facing_degrees: 45,
    facing_label: 'NE',
    facing_confidence: 'high',
    facing_source: 'test',
    facing_reason: 'test road',
  });

  const notification = listNotifications(db).find((item) => item.type === 'new_listing');
  assert.match(notification.message, /789 Quadrant Ave/);
  assert.match(notification.message, /\$410,000/);
  assert.match(notification.message, /1,900 sqft/);
  assert.match(notification.message, /Raleigh NE/);
  assert.match(notification.message, /Facing NE/);
});

test('emits one daily price-change notification for previous-day listings', () => {
  const dir = mkdtempSync(join(tmpdir(), 'house-hunter-'));
  const db = openDatabase(join(dir, 'test.sqlite'));

  const previousDay = db.prepare("SELECT DATETIME('now', 'localtime', '-1 day') AS value").get().value;
  upsertListing(db, compactListing({
    source: 'redfin_export',
    address: '123 Price Change St',
    city: 'Durham',
    state: 'NC',
    price: '$500,000',
    sqft: '2,240',
    url: 'https://www.redfin.com/old-price',
  }));
  const listing = listListings(db)[0];
  updateFacing(db, listing.id, {
    facing_degrees: 135,
    facing_label: 'SE',
    facing_confidence: 'high',
    facing_source: 'test',
    facing_reason: 'test road',
  });
  clearNotifications(db);
  db.prepare('UPDATE listings SET first_seen_at = ?, last_seen_at = ?, updated_at = ?').run(previousDay, previousDay, previousDay);

  upsertListing(db, compactListing({
    source: 'redfin_export',
    address: '123 Price Change St',
    city: 'Durham',
    state: 'NC',
    price: '$475,000',
    sqft: '2,240',
    url: 'https://www.redfin.com/new-price',
  }));
  upsertListing(db, compactListing({
    source: 'redfin_export',
    address: '123 Price Change St',
    city: 'Durham',
    state: 'NC',
    price: '$450,000',
    sqft: '2,240',
    url: 'https://www.redfin.com/newer-price',
  }));

  const notifications = listNotifications(db);
  assert.equal(notifications.filter((item) => item.type === 'price_change').length, 1);
  assert.equal(notifications[0].title, 'Price changed');
  assert.match(notifications[0].message, /123 Price Change St/);
  assert.match(notifications[0].message, /\$500,000 -> \$475,000/);
  assert.match(notifications[0].message, /2,240 sqft/);
  assert.match(notifications[0].message, /Durham/);
  assert.match(notifications[0].message, /Facing SE/);
  assert.equal(notifications[0].url, 'https://www.redfin.com/newer-price');
});

test('does not show older notifications in today-focused list', () => {
  const dir = mkdtempSync(join(tmpdir(), 'house-hunter-'));
  const db = openDatabase(join(dir, 'test.sqlite'));

  upsertListing(db, compactListing({
    source: 'redfin_export',
    address: '200 Old Alert St',
    city: 'Durham',
    state: 'NC',
  }));
  db.prepare("UPDATE notifications SET created_at = DATETIME('now', '-1 day')").run();

  assert.equal(listNotifications(db).length, 0);
  assert.equal(listNotifications(db, { all: true }).length, 1);
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
    property_type: 'Townhouse',
  }));
  const apex = upsertListing(db, compactListing({
    source: 'redfin_export',
    address: '20 Main St',
    city: 'Apex',
    state: 'NC',
    price: 350000,
    property_type: 'Single Family Residential',
  }));

  updateCommute(db, durham.id, { lat: 35.9, lon: -78.8, minutes: 20, distance_miles: 12.5 });
  updateCommute(db, apex.id, { lat: 35.7, lon: -78.9, minutes: 30, distance_miles: 18.2 });

  assert.deepEqual(listCities(db).map((item) => item.label), ['Apex', 'Durham']);
  assert.equal(listListings(db, { city: 'Apex' }).length, 1);
  assert.equal(listListings(db, { city: 'city:Apex' }).length, 1);
  assert.equal(listListings(db, { city: ['city:Apex', 'city:Durham'] }).length, 2);
  assert.deepEqual(listHomeTypes(db).map((item) => ({ ...item })), [
    { value: 'Single Family Residential', label: 'Single Family Residential', count: 1 },
    { value: 'Townhouse', label: 'Townhouse', count: 1 },
  ]);
  assert.equal(listListings(db, { homeType: 'Townhouse' }).length, 1);
  assert.equal(listListings(db, { homeType: ['Townhouse', 'Single Family Residential'] }).length, 2);
  assert.equal(listListings(db, { city: 'city:Durham', homeType: 'Townhouse' }).length, 1);
  assert.equal(listListings(db, { query: 'Single Family' }).length, 1);
  assert.equal(listListings(db, { sort: 'price_asc' })[0].city, 'Apex');
  assert.equal(listListings(db, { sort: 'commute_asc' })[0].city, 'Durham');
  assert.equal(listListings(db, { sort: 'distance_asc' })[0].distance_miles, 12.5);
});

test('supports uncapped internal listing queries', () => {
  const dir = mkdtempSync(join(tmpdir(), 'house-hunter-'));
  const db = openDatabase(join(dir, 'test.sqlite'));

  for (let index = 0; index < 505; index += 1) {
    upsertListing(db, compactListing({
      source: 'redfin_export',
      address: `${1000 + index} Limit Test Dr`,
      city: 'Durham',
      state: 'NC',
      price: 300000 + index,
    }));
  }

  assert.equal(listListings(db).length, 500);
  assert.equal(listListings(db, { limit: 'all' }).length, 505);
});

test('stores and backfills year built from Redfin raw payloads', () => {
  const dir = mkdtempSync(join(tmpdir(), 'house-hunter-'));
  const path = join(dir, 'test.sqlite');
  const db = openDatabase(path);

  const listing = upsertListing(db, compactListing({
    source: 'redfin_export',
    address: '50 Year Built Way',
    city: 'Durham',
    state: 'NC',
    year_built: '2019',
    raw: { 'YEAR BUILT': '2019' },
  }));

  assert.equal(listListings(db)[0].year_built, 2019);
  db.prepare('UPDATE listings SET year_built = NULL WHERE id = ?').run(listing.id);
  db.close();

  const reopened = openDatabase(path);
  assert.equal(listListings(reopened)[0].year_built, 2019);
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
  assert.equal(listListings(db, { city: ['area:Raleigh NE', 'city:Durham'] }).length, 2);
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
  upsertListing(db, compactListing({
    source: 'redfin_export',
    address: '123 Unknown Facing St',
    city: 'Durham',
    state: 'NC',
    price: 370000,
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
  assert.equal(listListings(db, { facing: ['NE', 'S'] }).length, 2);
  assert.equal(listListings(db, { facing: 'unknown' }).length, 1);
  assert.equal(listListings(db, { city: 'city:Durham', facing: ['NE', 'S'] }).length, 1);
  assert.equal(listListings(db, { facing: ['bad-value'] }).length, 0);
  assert.equal(listListings(db, { sort: 'facing_direction' })[0].address, '720 Keystone Park Dr');
});

test('persists listing favorites', () => {
  const dir = mkdtempSync(join(tmpdir(), 'house-hunter-'));
  const db = openDatabase(join(dir, 'test.sqlite'));

  const listing = upsertListing(db, compactListing({
    source: 'redfin_export',
    address: '500 Favorite Way',
    city: 'Durham',
    state: 'NC',
  }));

  assert.equal(listListings(db)[0].is_favorite, false);
  assert.equal(setListingFavorite(db, listing.id, true), 1);
  assert.equal(listListings(db)[0].is_favorite, true);
  assert.equal(setListingFavorite(db, listing.id, false), 1);
  assert.equal(listListings(db)[0].is_favorite, false);
  assert.equal(setListingFavorite(db, 999999, true), 0);
});

test('stores manual facing labels without degrees', () => {
  const dir = mkdtempSync(join(tmpdir(), 'house-hunter-'));
  const db = openDatabase(join(dir, 'test.sqlite'));

  const listing = upsertListing(db, compactListing({
    source: 'redfin_export',
    address: '600 Manual Facing Way',
    city: 'Durham',
    state: 'NC',
  }));

  assert.equal(updateFacing(db, listing.id, {
    facing_degrees: null,
    facing_label: 'N',
    facing_confidence: 'manual',
    facing_source: 'manual',
    facing_reason: 'manual_entry',
    facing_review_status: 'reviewed',
  }), 1);

  const saved = listListings(db)[0];
  assert.equal(saved.facing_degrees, null);
  assert.equal(saved.facing_label, 'N');
  assert.equal(saved.facing_status, 'known');
  assert.equal(saved.facing_confidence, 'manual');
  assert.equal(saved.facing_reason, 'manual_entry');
  assert.equal(saved.facing_review_status, 'reviewed');
  assert.equal(getStats(db).facingKnown, 1);
  assert.equal(listListings(db, { facing: 'N' }).length, 1);
  assert.equal(listListings(db, { facing: 'unknown' }).length, 0);
});
