export const WORK_ADDRESS = '100 New Millennium Way, Durham, NC 27709';
export const WORK_COORDS = { lat: 35.88719, lon: -78.8562 };
export const COMMUTE_LIMIT_MINUTES = 30;

export const PUBLIC_SALE_SOURCES = [
  {
    key: 'durham-county-tax-foreclosure',
    label: 'Durham County Tax Foreclosure',
    url: 'https://www.dconc.gov/i-want-to/tax-and-property-information/find-foreclosures',
    kind: 'county_foreclosure',
  },
  {
    key: 'doug-davis-durham-foreclosure',
    label: 'Doug Davis Durham Foreclosure Listings',
    url: 'https://www.davisrealtync.com/',
    kind: 'county_foreclosure',
  },
  {
    key: 'orange-county-tax-auctions',
    label: 'Orange County Tax Auctions',
    url: 'https://www.orangecountync.gov/902/Tax-Auctions',
    kind: 'county_tax_sale',
  },
  {
    key: 'chatham-county-tax-foreclosure',
    label: 'Chatham County Tax Foreclosure Sales',
    url: 'https://www.chathamcountync.gov/government/departments-programs-i-z/tax-administration/tax-foreclosure-sales',
    kind: 'county_tax_sale',
  },
  {
    key: 'auction-com-rtp',
    label: 'Auction.com RTP Area',
    url: 'https://www.auction.com/',
    kind: 'auction',
  },
];
