import readXlsxFile from 'read-excel-file/node';
import { compactListing } from '../normalize.js';

const HEADER_ALIASES = {
  address: ['address', 'street address', 'property address', 'location'],
  city: ['city'],
  state: ['state', 'state or province'],
  zip: ['zip', 'zip code', 'postal code', 'zip or postal code'],
  price: ['price', 'sale price', 'list price'],
  beds: ['beds', 'bedrooms'],
  baths: ['baths', 'bathrooms'],
  sqft: ['sq ft', 'sqft', 'square feet', 'home size'],
  lot: ['lot size', 'lot'],
  year_built: ['year built', 'year'],
  property_type: ['property type', 'home type', 'type'],
  status: ['status'],
  listed_at: ['listed on', 'listed date', 'date listed'],
  url: ['url', 'link', 'redfin url', 'property url'],
  hoa: ['hoa/month', 'hoa'],
  latitude: ['latitude', 'lat'],
  longitude: ['longitude', 'lng', 'lon'],
};

export async function parseRedfinWorkbook(buffer, filename = 'redfin-upload') {
  const rows = await parseRows(buffer, filename);
  return rows.map((row, index) => {
    const normalized = normalizeRow(row);
    const address = normalized.address || combineAddress(normalized);
    return compactListing({
      source: 'redfin_export',
      source_label: 'Redfin Export',
      external_id: normalized.url || `${filename}:${index}`,
      url: normalized.url,
      address,
      city: normalized.city,
      state: normalized.state,
      zip: normalized.zip,
      price: normalized.price,
      beds: normalized.beds,
      baths: normalized.baths,
      sqft: normalized.sqft,
      lot: normalized.lot,
      year_built: normalized.year_built,
      property_type: normalized.property_type,
      listing_type: 'regular_sale',
      status: normalized.status || 'active',
      listed_at: normalized.listed_at,
      latitude: normalized.latitude,
      longitude: normalized.longitude,
      notes: normalized.hoa ? `HOA: ${normalized.hoa}` : '',
      raw: row,
    });
  }).filter((listing) => listing.address || listing.url);
}

async function parseRows(buffer, filename) {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
    const rows = await readXlsxFile(buffer);
    return tableToObjects(rows);
  }
  return parseCsv(buffer.toString('utf8'));
}

function tableToObjects(rows) {
  const [headers = [], ...body] = rows;
  return body
    .filter((row) => row.some((cell) => cell !== null && cell !== undefined && cell !== ''))
    .map((row) => Object.fromEntries(headers.map((header, index) => [String(header ?? '').trim(), row[index] ?? ''])));
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(cell);
      cell = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(cell);
      if (row.some((value) => value.trim() !== '')) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }

  row.push(cell);
  if (row.some((value) => value.trim() !== '')) rows.push(row);
  return tableToObjects(rows);
}

function normalizeRow(row) {
  const lowered = Object.fromEntries(
    Object.entries(row).map(([key, value]) => [String(key).trim().toLowerCase(), value]),
  );
  const output = {};
  for (const [target, aliases] of Object.entries(HEADER_ALIASES)) {
    const alias = aliases.find((name) => Object.prototype.hasOwnProperty.call(lowered, name))
      ?? findLooseHeader(lowered, target);
    output[target] = alias ? lowered[alias] : '';
  }
  return output;
}

function findLooseHeader(row, target) {
  if (target === 'url') {
    return Object.keys(row).find((key) => key === 'url' || key.startsWith('url '));
  }
  return undefined;
}

function combineAddress(row) {
  return [row.address, row.city, row.state, row.zip].filter(Boolean).join(', ');
}
