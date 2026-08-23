import express from 'express';
import multer from 'multer';
import {
  openDatabase,
  getStats,
  listListings,
  listCities,
  listHomeTypes,
  listNotifications,
  markNotificationsRead,
  clearNotifications,
  upsertListing,
  updateCommute,
  updateFacing,
  setListingFavorite,
  listRoadCacheStatuses,
  upsertRoadCacheStatus,
  replaceRoadSegmentsForCounty,
  getReadyRoadSegmentsByCounty,
} from './db.js';
import { parseRedfinWorkbook } from './importers/redfin.js';
import { parseListingEmail } from './importers/email.js';
import { collectPublicSaleSources } from './importers/publicSales.js';
import { compactListing } from './normalize.js';
import { classifyCommute } from './geo.js';
import { classifyListingFromRoadCache, fetchCountyRoads } from './roadCache.js';
import { ROAD_CACHE_COUNTIES } from './roadCacheConfig.js';
import { renderShareReport } from './shareReport.js';

const PORT = Number(process.env.PORT ?? 4242);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024 } });
const db = openDatabase();
const app = express();
let nextJobId = 1;
let activeJob = null;

app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, stats: getStats(db) });
});

app.get('/api/stats', (_req, res) => {
  res.json(getStats(db));
});

app.get('/api/listings', (req, res) => {
  res.json(listListings(db, {
    commute: req.query.commute,
    query: req.query.query,
    city: req.query.city,
    facing: req.query.facing,
    homeType: req.query.homeType,
    sort: req.query.sort,
  }));
});

app.patch('/api/listings/:id/favorite', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid listing id' });
  const changes = setListingFavorite(db, id, req.body?.favorite === true);
  if (changes === 0) return res.status(404).json({ error: 'Listing not found' });
  const listing = listListings(db, {}).find((item) => item.id === id);
  res.json({ ok: true, listing });
});

app.get('/api/cities', (_req, res) => {
  res.json(listCities(db));
});

app.get('/api/home-types', (_req, res) => {
  res.json(listHomeTypes(db));
});

app.get('/api/notifications', (_req, res) => {
  res.json(listNotifications(db));
});

app.get('/api/export/report', (_req, res) => {
  const generatedAt = new Date().toISOString();
  const html = renderShareReport({
    generatedAt,
    listings: listListings(db, { limit: 'all' }),
    notifications: listNotifications(db),
    stats: getStats(db),
    cities: listCities(db),
    homeTypes: listHomeTypes(db),
  });
  const date = generatedAt.slice(0, 10);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="house-hunter-report-${date}.html"`);
  res.send(html);
});

app.get('/api/jobs/current', (_req, res) => {
  res.json(activeJob ? publicJob(activeJob) : { status: 'idle' });
});

app.get('/api/road-cache/status', (_req, res) => {
  res.json(listRoadCacheStatuses(db));
});

app.post('/api/notifications/read', (_req, res) => {
  markNotificationsRead(db);
  res.json({ ok: true });
});

app.delete('/api/notifications', (_req, res) => {
  const cleared = clearNotifications(db);
  res.json({ ok: true, cleared });
});

app.post('/api/import/redfin', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Missing file' });
    const listings = await parseRedfinWorkbook(req.file.buffer, req.file.originalname);
    const result = await saveListings(listings, { classify: false });
    const job = startListingJob('commute', result.ids, 'Calculating commutes for Redfin import');
    res.json({ ...result, parsed: listings.length, job });
  } catch (error) {
    next(error);
  }
});

app.post('/api/import/email', async (req, res, next) => {
  try {
    const listings = parseListingEmail(req.body.text ?? '', req.body.source ?? 'email_alert');
    const result = await saveListings(listings);
    res.json({ ...result, parsed: listings.length });
  } catch (error) {
    next(error);
  }
});

app.post('/api/import/manual', async (req, res, next) => {
  try {
    const listing = compactListing({
      ...req.body,
      source: 'manual',
      source_label: 'Manual Save',
      raw: req.body,
    });
    const result = await saveListings([listing]);
    res.json({ ...result, parsed: 1 });
  } catch (error) {
    next(error);
  }
});

app.post('/api/sync/public-sales', async (_req, res, next) => {
  try {
    const listings = await collectPublicSaleSources();
    const result = await saveListings(listings, { classify: false });
    res.json({ ...result, parsed: listings.length });
  } catch (error) {
    next(error);
  }
});

app.post('/api/commutes/refresh', async (_req, res, next) => {
  try {
    const rows = listListings(db, {});
    const job = startListingJob('commute', rows.map((row) => row.id), 'Refreshing all commutes');
    res.json({ job, refreshed: 0 });
  } catch (error) {
    next(error);
  }
});

app.post('/api/road-cache/refresh', async (_req, res, next) => {
  try {
    const job = startRoadCacheRefreshJob();
    res.json({ job, refreshed: 0 });
  } catch (error) {
    next(error);
  }
});

app.post('/api/facing/county-cache', async (req, res, next) => {
  try {
    const rows = listListings(db, {});
    const force = req.body?.force === true;
    const ids = rows
      .filter((row) => force || needsCountyRoadFacing(row))
      .map((row) => row.id);
    const label = force ? 'Refreshing all facing from county road cache' : 'Classifying facing from county road cache';
    const job = startListingJob('county_facing', ids, label);
    res.json({ job, refreshed: 0 });
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: error.message || 'Unexpected server error' });
});

async function saveListings(listings, options = { classify: true }) {
  const summary = { created: 0, updated: 0, ids: [] };
  for (const listing of listings) {
    const saved = upsertListing(db, listing);
    summary.ids.push(saved.id);
    summary[saved.action] += 1;
    if (options.classify !== false) {
      const row = listListings(db, {}).find((item) => item.id === saved.id);
      if (row) {
        const commute = await classifyCommute(db, row);
        updateCommute(db, saved.id, commute);
      }
    }
  }
  return summary;
}

function startListingJob(type, ids, label) {
  if (activeJob?.status === 'running') {
    activeJob.cancelled = true;
  }

  const uniqueIds = [...new Set(ids)].filter((id) => Number.isFinite(Number(id)));
  const job = {
    id: nextJobId,
    type,
    label,
    status: 'running',
    total: uniqueIds.length,
    completed: 0,
    failed: 0,
    started_at: new Date().toISOString(),
    finished_at: null,
    message: uniqueIds.length ? `Starting ${type} checks` : 'No listings to check',
    cancelled: false,
  };
  nextJobId += 1;
  activeJob = job;

  void runListingJob(job, uniqueIds);
  return publicJob(job);
}

async function runListingJob(job, ids) {
  if (ids.length === 0) {
    finishJob(job, 'complete', `No listings needed ${job.type} checks`);
    return;
  }

  const countyRoadsByCounty = job.type === 'county_facing'
    ? getReadyRoadSegmentsByCounty(db, ROAD_CACHE_COUNTIES)
    : null;

  for (const id of ids) {
    if (job.cancelled) {
      finishJob(job, 'cancelled', 'Cancelled by a newer job');
      return;
    }

    try {
      const row = listListings(db, {}).find((item) => item.id === id);
      if (row) {
        job.message = `Checking ${job.completed + 1} of ${ids.length}: ${row.address || 'listing ' + id}`;
        if (job.type === 'county_facing') {
          const facing = classifyListingFromRoadCache(row, countyRoadsByCounty);
          updateFacing(db, id, facing);
        } else {
          const commute = await classifyCommute(db, row);
          updateCommute(db, id, commute);
        }
      }
    } catch (error) {
      job.failed += 1;
      job.message = error.message || `${job.type} check failed`;
    } finally {
      job.completed += 1;
    }

    if (!job.cancelled && job.completed < ids.length) {
      await yieldToEventLoop();
    }
  }

  finishJob(job, 'complete', `Finished ${job.completed} ${job.type} checks`);
}

function startRoadCacheRefreshJob() {
  if (activeJob?.status === 'running') {
    activeJob.cancelled = true;
  }

  const job = {
    id: nextJobId,
    type: 'road_cache',
    label: 'Refreshing county road cache',
    status: 'running',
    total: ROAD_CACHE_COUNTIES.length,
    completed: 0,
    failed: 0,
    started_at: new Date().toISOString(),
    finished_at: null,
    message: 'Starting road cache refresh',
    cancelled: false,
  };
  nextJobId += 1;
  activeJob = job;

  void runRoadCacheRefreshJob(job);
  return publicJob(job);
}

async function runRoadCacheRefreshJob(job) {
  for (const county of ROAD_CACHE_COUNTIES) {
    if (job.cancelled) {
      finishJob(job, 'cancelled', 'Cancelled by a newer job');
      return;
    }

    try {
      upsertRoadCacheStatus(db, {
        county,
        status: 'refreshing',
        records_downloaded: 0,
        pages_downloaded: 0,
        last_error: '',
      });
      job.message = `Fetching ${county} County roads`;
      const result = await fetchCountyRoads(county, ({ pages, roads }) => {
        job.message = `${county} County: fetched ${roads.toLocaleString()} roads across ${pages} page${pages === 1 ? '' : 's'}`;
      });

      if (result.status === 'ready' || result.status === 'partial') {
        replaceRoadSegmentsForCounty(db, county, result.roads);
      }
      upsertRoadCacheStatus(db, {
        county,
        source_key: result.source?.key ?? '',
        source_url: result.source?.url ?? '',
        status: result.status,
        records_downloaded: result.roads.length,
        pages_downloaded: result.pages,
        last_error: result.error,
      });
      if (result.status !== 'ready') job.failed += 1;
    } catch (error) {
      job.failed += 1;
      upsertRoadCacheStatus(db, {
        county,
        status: 'failed',
        records_downloaded: 0,
        pages_downloaded: 0,
        last_error: error.message || String(error),
      });
      job.message = `${county} County road cache failed`;
    } finally {
      job.completed += 1;
    }
  }

  finishJob(job, job.failed ? 'complete' : 'complete', `Finished road cache refresh for ${job.completed} counties`);
}

function finishJob(job, status, message) {
  job.status = status;
  job.message = message;
  job.finished_at = new Date().toISOString();
}

function publicJob(job) {
  const rest = { ...job };
  delete rest.cancelled;
  return rest;
}

function needsCountyRoadFacing(row) {
  if (row.facing_review_status === 'needs_review') return true;
  return row.facing_status === null || row.facing_status === undefined || row.facing_status === '' || row.facing_status === 'unknown';
}

function yieldToEventLoop() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

app.listen(PORT, '127.0.0.1', () => {
  console.log(`House Hunter API running at http://127.0.0.1:${PORT}`);
});
