import test from 'node:test';
import assert from 'node:assert/strict';
import { parseListingEmail } from './email.js';

test('parses listing details from an alert email', () => {
  const listings = parseListingEmail(`
    New home near RTP
    123 Main St, Durham, NC 27703
    $425,000
    3 beds 2.5 baths 1,980 sqft
    https://www.zillow.com/homedetails/example
  `, 'zillow_email');

  assert.equal(listings.length, 1);
  assert.equal(listings[0].address, '123 Main St, Durham, NC 27703');
  assert.equal(listings[0].price, 425000);
  assert.equal(listings[0].beds, 3);
  assert.equal(listings[0].baths, 2.5);
  assert.equal(listings[0].sqft, 1980);
  assert.equal(listings[0].listing_type, 'regular_sale');
});

test('classifies auction and foreclosure language', () => {
  const listings = parseListingEmail(`
    Foreclosure Sale
    1155 Harp Street Raleigh NC 27604
    Auction Date Jul 27, 2026
    $797,046 3 bd 3.5 ba 2,311 sqft
  `, 'auction_email');

  assert.equal(listings.length, 1);
  assert.equal(listings[0].listing_type, 'foreclosure');
  assert.equal(listings[0].auction_at, 'Jul 27, 2026');
});
