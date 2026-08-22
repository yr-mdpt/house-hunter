import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRedfinWorkbook } from './redfin.js';

test('parses a Redfin CSV export without the vulnerable xlsx package', async () => {
  const csv = [
    'SALE TYPE,SOLD DATE,PROPERTY TYPE,ADDRESS,CITY,STATE OR PROVINCE,ZIP OR POSTAL CODE,PRICE,BEDS,BATHS,SQUARE FEET,LOT SIZE,URL (SEE https://www.redfin.com/buy-a-home/comparative-market-analysis FOR INFO ON PRICING),LATITUDE,LONGITUDE',
    'MLS Listing,,Single Family Residential,"123 Main St",Durham,NC,27703,"$425,000",3,2.5,"1,980","6,534 sqft",https://www.redfin.com/NC/Durham/example,35.911,-78.876',
  ].join('\n');

  const listings = await parseRedfinWorkbook(Buffer.from(csv), 'redfin.csv');

  assert.equal(listings.length, 1);
  assert.equal(listings[0].address, '123 Main St');
  assert.equal(listings[0].city, 'Durham');
  assert.equal(listings[0].state, 'NC');
  assert.equal(listings[0].zip, '27703');
  assert.equal(listings[0].price, 425000);
  assert.equal(listings[0].beds, 3);
  assert.equal(listings[0].baths, 2.5);
  assert.equal(listings[0].latitude, 35.911);
  assert.equal(listings[0].longitude, -78.876);
});
