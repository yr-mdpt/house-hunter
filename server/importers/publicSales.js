import { PUBLIC_SALE_SOURCES } from '../config.js';
import { compactListing } from '../normalize.js';
import { parseListingEmail } from './email.js';

export async function collectPublicSaleSources(fetchImpl = fetch) {
  const results = [];
  for (const source of PUBLIC_SALE_SOURCES) {
    try {
      const response = await fetchImpl(source.url, {
        headers: {
          'User-Agent': 'HouseHunterPersonalCollector/1.0 (manual private research)',
          'Accept': 'text/html,text/plain;q=0.9,*/*;q=0.8',
        },
      });
      const text = await response.text();
      const parsedListings = parseListingEmail(text, source.key).map((listing) => ({
        ...listing,
        source: source.key,
        source_label: source.label,
        listing_type: source.kind,
        url: listing.url || source.url,
      }));

      if (parsedListings.length > 0) {
        results.push(...parsedListings);
      } else {
        results.push(compactListing({
          source: source.key,
          source_label: source.label,
          external_id: source.url,
          url: source.url,
          listing_type: source.kind,
          status: 'source_checked',
          notes: 'Source checked. No individual property address detected automatically.',
          raw: { checked_at: new Date().toISOString(), sample: text.slice(0, 1500) },
        }));
      }
    } catch (error) {
      results.push(compactListing({
        source: source.key,
        source_label: source.label,
        external_id: `${source.url}:error`,
        url: source.url,
        listing_type: source.kind,
        status: 'source_error',
        notes: `Could not check source: ${error.message}`,
        raw: { error: error.message, checked_at: new Date().toISOString() },
      }));
    }
  }
  return results;
}
