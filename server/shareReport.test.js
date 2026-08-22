import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { renderShareReport } from './shareReport.js';

const sampleReportPayload = {
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
};

test('renders a standalone report with safely embedded data', () => {
  const html = renderShareReport(sampleReportPayload);

  assert.match(html, /<!doctype html>/);
  assert.match(html, /House Hunter Report/);
  assert.match(html, /report-data/);
  assert.match(html, /2026-08-22T12:00:00.000Z/);
  assert.match(html, /Price changed/);
  assert.match(html, /https:\/\/www\.redfin\.com\/example/);
  assert.doesNotMatch(html, /<\/script><strong>Safe House/);
  assert.doesNotMatch(html, /should/);
});

test('standalone report script renders listings on initial load', () => {
  const html = renderShareReport(sampleReportPayload);
  const { document, elements } = createFakeDocument(html);
  const script = extractReportScript(html);

  assert.doesNotThrow(() => {
    vm.runInNewContext(script, {
      document,
      JSON,
      Date,
      Number,
      String,
    });
  });

  assert.match(elements.get('result-count').textContent, /1 of 1 listings/);
  assert.match(elements.get('listing-list').innerHTML, /Safe House/);
  assert.match(elements.get('notification-list').innerHTML, /Price changed/);
});

function extractReportScript(html) {
  const match = html.match(/<script id="report-data" type="application\/json">[\s\S]*?<\/script>\s*<script>([\s\S]*?)<\/script>/);
  assert.ok(match, 'expected report script');
  return match[1];
}

function createFakeDocument(html) {
  const dataMatch = html.match(/<script id="report-data" type="application\/json">([\s\S]*?)<\/script>/);
  assert.ok(dataMatch, 'expected embedded report data');
  const elements = new Map();
  for (const id of [
    'report-data',
    'generated-at',
    'summary',
    'city-options',
    'facing-options',
    'search',
    'commute',
    'sort',
    'city-summary',
    'facing-summary',
    'notification-list',
    'result-count',
    'listing-list',
  ]) {
    elements.set(id, new FakeElement(id));
  }
  elements.get('report-data').textContent = dataMatch[1];

  return {
    elements,
    document: {
      getElementById(id) {
        return elements.get(id);
      },
      querySelectorAll() {
        return [];
      },
    },
  };
}

class FakeElement {
  constructor(id) {
    this.id = id;
    this.textContent = '';
    this.value = '';
    this.checked = false;
    this.listeners = {};
    this._innerHTML = '';
  }

  get innerHTML() {
    return this._innerHTML;
  }

  set innerHTML(value) {
    this._innerHTML = String(value);
  }

  addEventListener(type, handler) {
    this.listeners[type] = handler;
  }

  querySelectorAll() {
    return [];
  }
}
