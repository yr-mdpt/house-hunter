import test from 'node:test';
import assert from 'node:assert/strict';
import { renderShareReport } from './shareReport.js';

test('renders a standalone report with safely embedded data', () => {
  const html = renderShareReport({
    generatedAt: '2026-08-22T12:00:00.000Z',
    stats: {
      total: 1,
      within: 1,
      facingKnown: 1,
      facingNeedsReview: 0,
      unread: 2,
      sources: 1,
      roadCacheReady: 4,
      roadCacheTotal: 4,
    },
    cities: [{ value: 'city:Durham', label: 'Durham', count: 1 }],
    listings: [{
      id: 1,
      address: '</script><strong>Safe House</strong>',
      city: 'Durham',
      state: 'NC',
      zip: '27703',
      price: 425000,
      beds: 3,
      baths: 2.5,
      sqft: 1980,
      year_built: 2018,
      commute_minutes: 20,
      distance_miles: 12,
      commute_status: 'within_30_min',
      facing_label: 'NE',
      facing_degrees: 45,
      facing_review_status: 'reviewed',
      listing_type: 'regular_sale',
      status: 'Active',
      is_favorite: true,
      url: 'https://www.redfin.com/example',
      source_refs: [{ source: 'redfin_export', label: 'Redfin Export' }],
      raw_payloads: [{ should: 'not be exported' }],
    }],
    notifications: [{
      id: 5,
      type: 'price_change',
      title: 'Price changed',
      message: 'Safe House: $450,000 -> $425,000',
      created_at: '2026-08-22 12:00:00',
      read_at: null,
      url: 'https://www.redfin.com/example',
    }],
  });

  assert.match(html, /<!doctype html>/);
  assert.match(html, /House Hunter Report/);
  assert.match(html, /report-data/);
  assert.match(html, /2026-08-22T12:00:00.000Z/);
  assert.match(html, /Price changed/);
  assert.match(html, /https:\/\/www\.redfin\.com\/example/);
  assert.doesNotMatch(html, /<\/script><strong>Safe House/);
  assert.doesNotMatch(html, /should/);
});
