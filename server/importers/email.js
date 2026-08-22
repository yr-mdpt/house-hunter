import { compactListing, moneyToNumber, normalizeText } from '../normalize.js';

const ADDRESS_RE = /\b\d{1,6}\s+[A-Za-z0-9.' -]+?\s+(?:St|Street|Rd|Road|Ave|Avenue|Dr|Drive|Ln|Lane|Ct|Court|Way|Blvd|Boulevard|Cir|Circle|Pl|Place|Pkwy|Parkway|Ter|Terrace)\b(?:[, ]+[A-Za-z .'-]+)?(?:,\s*(?:NC|North Carolina))?(?:\s+\d{5})?/gi;
const URL_RE = /https?:\/\/[^\s<>"')]+/gi;
const PRICE_RE = /\$\s?\d[\d,]*(?:\.\d+)?\s?[kKmM]?/;
const BEDS_RE = /(\d+(?:\.\d+)?)\s*(?:bd|bed|beds|bedrooms?)\b/i;
const BATHS_RE = /(\d+(?:\.\d+)?)\s*(?:ba|bath|baths|bathrooms?)\b/i;
const SQFT_RE = /([\d,]+)\s*(?:sq\.?\s*ft|sqft|square feet)\b/i;

export function parseListingEmail(text, sourceHint = 'email_alert') {
  const clean = stripEmailNoise(text);
  const urls = [...clean.matchAll(URL_RE)].map((match) => match[0]);
  const addresses = unique([...clean.matchAll(ADDRESS_RE)].map((match) => normalizeText(match[0])));

  if (addresses.length === 0 && urls.length > 0) {
    return urls.slice(0, 5).map((url, index) => compactListing({
      source: sourceHint,
      source_label: sourceLabel(sourceHint),
      external_id: url,
      url,
      listing_type: inferListingType(clean),
      status: 'active',
      notes: 'Imported from alert email; address not detected automatically.',
      raw: { text: clean.slice(0, 4000), url, index },
    }));
  }

  return addresses.map((address, index) => {
    const context = textAround(clean, address, 700);
    const url = bestUrlForSource(urls, sourceHint);
    return compactListing({
      source: sourceHint,
      source_label: sourceLabel(sourceHint),
      external_id: `${address}:${url}`,
      url,
      address,
      price: extract(PRICE_RE, context, 0),
      beds: extract(BEDS_RE, context, 1),
      baths: extract(BATHS_RE, context, 1),
      sqft: extract(SQFT_RE, context, 1),
      listing_type: inferListingType(context),
      status: inferStatus(context),
      auction_at: inferAuctionDate(context),
      raw: { text: context, index },
    });
  });
}

function stripEmailNoise(text) {
  return String(text ?? '')
    .replace(/=\r?\n/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extract(regex, text, group) {
  const match = text.match(regex);
  return match ? moneyOrRaw(match[group]) : null;
}

function moneyOrRaw(value) {
  return String(value).includes('$') ? moneyToNumber(value) : value;
}

function textAround(text, needle, size) {
  const index = text.toLowerCase().indexOf(needle.toLowerCase());
  if (index === -1) return text.slice(0, size * 2);
  return text.slice(Math.max(0, index - size), Math.min(text.length, index + needle.length + size));
}

function bestUrlForSource(urls, sourceHint) {
  const hint = sourceHint.toLowerCase();
  if (hint.includes('zillow')) return urls.find((url) => url.includes('zillow.com')) ?? urls[0] ?? '';
  if (hint.includes('redfin')) return urls.find((url) => url.includes('redfin.com')) ?? urls[0] ?? '';
  if (hint.includes('realtor')) return urls.find((url) => url.includes('realtor.com')) ?? urls[0] ?? '';
  if (hint.includes('auction')) return urls.find((url) => url.includes('auction.com')) ?? urls[0] ?? '';
  return urls[0] ?? '';
}

function inferListingType(text) {
  const lower = text.toLowerCase();
  if (lower.includes('foreclosure')) return 'foreclosure';
  if (lower.includes('auction') || lower.includes('bid')) return 'auction';
  if (lower.includes('bank-owned') || lower.includes('reo')) return 'reo';
  if (lower.includes('tax sale') || lower.includes('tax foreclosure')) return 'county_tax_sale';
  return 'regular_sale';
}

function inferStatus(text) {
  const lower = text.toLowerCase();
  if (lower.includes('pending')) return 'pending';
  if (lower.includes('sold')) return 'sold';
  if (lower.includes('coming soon')) return 'coming_soon';
  return 'active';
}

function inferAuctionDate(text) {
  const match = text.match(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}\b/i);
  return match ? match[0] : '';
}

function sourceLabel(sourceHint) {
  return sourceHint
    .split(/[_-]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function unique(values) {
  return [...new Set(values)];
}
