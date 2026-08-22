# RTP House Listing Collector

Private local MVP for gathering home listings and public-sale leads near `100 New Millennium Way, Durham, NC 27709`.

## What It Does

- Imports Redfin CSV/XLSX exports.
- Parses pasted Zillow, Redfin, Realtor, and Auction.com alert emails.
- Saves manual listing URLs or addresses.
- Checks configured public-sale entry points for Durham, Orange, Chatham, Doug Davis, and Auction.com.
- Stores normalized listings in local SQLite at `data/house-hunter.sqlite`.
- Deduplicates by normalized address or URL.
- Creates notifications for new listings, price drops, status changes, and auction date changes.
- Geocodes with Nominatim and routes with OSRM for an any-time 30 minute commute screen. If remote routing is unavailable, it falls back to rough city-level estimates where possible.

## Run

```bash
npm install
npm run dev
```

Open the Vite URL shown in the terminal, usually `http://127.0.0.1:5173`.

## Notes

This app intentionally avoids automated scraping of Zillow, Redfin, Realtor.com consumer pages. Use exports, saved-search emails, manual saves, public county pages, and later licensed APIs.

Set `DISABLE_REMOTE_GEO=1` to skip Nominatim/OSRM network calls during local testing.
