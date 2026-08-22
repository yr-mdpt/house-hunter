export function normalizeText(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

export function normalizeAddress(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[.,#]/g, '')
    .replace(/\b(north carolina|nc)\b/g, 'nc')
    .replace(/\b(street)\b/g, 'st')
    .replace(/\b(road)\b/g, 'rd')
    .replace(/\b(avenue)\b/g, 'ave')
    .replace(/\b(drive)\b/g, 'dr')
    .replace(/\b(lane)\b/g, 'ln')
    .replace(/\b(court)\b/g, 'ct')
    .replace(/\s+/g, ' ')
    .trim();
}

export function moneyToNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
  const text = String(value).toLowerCase().replace(/[$,\s]/g, '');
  if (!text) return null;
  const multiplier = text.endsWith('m') ? 1_000_000 : text.endsWith('k') ? 1_000 : 1;
  const numeric = Number.parseFloat(text.replace(/[mk]$/, ''));
  return Number.isFinite(numeric) ? Math.round(numeric * multiplier) : null;
}

export function numberFrom(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const match = String(value).replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : null;
}

export function titleCase(value) {
  return normalizeText(value).replace(/\w\S*/g, (word) => {
    if (/^[A-Z]{2}$/.test(word)) return word;
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  });
}

export function makeDedupeKey(listing) {
  const address = normalizeAddress(listing.address);
  if (address) return `addr:${address}`;
  const url = normalizeText(listing.url).toLowerCase();
  if (url) return `url:${url}`;
  const externalId = normalizeText(listing.external_id).toLowerCase();
  if (externalId) return `${listing.source ?? 'source'}:${externalId}`;
  return `raw:${JSON.stringify(listing).slice(0, 180).toLowerCase()}`;
}

export function compactListing(input) {
  const listing = {
    source: normalizeText(input.source) || 'manual',
    source_label: normalizeText(input.source_label),
    external_id: normalizeText(input.external_id),
    url: normalizeText(input.url),
    address: titleCase(input.address),
    city: titleCase(input.city),
    state: normalizeText(input.state).toUpperCase(),
    zip: normalizeText(input.zip),
    price: moneyToNumber(input.price),
    beds: numberFrom(input.beds),
    baths: numberFrom(input.baths),
    sqft: numberFrom(input.sqft),
    lot: normalizeText(input.lot),
    year_built: numberFrom(input.year_built),
    property_type: normalizeText(input.property_type),
    listing_type: normalizeText(input.listing_type) || 'regular_sale',
    status: normalizeText(input.status) || 'active',
    listed_at: normalizeText(input.listed_at),
    auction_at: normalizeText(input.auction_at),
    latitude: numberFrom(input.latitude),
    longitude: numberFrom(input.longitude),
    photo_url: normalizeText(input.photo_url),
    notes: normalizeText(input.notes),
    raw: input.raw ?? input,
  };
  listing.dedupe_key = makeDedupeKey(listing);
  return listing;
}
