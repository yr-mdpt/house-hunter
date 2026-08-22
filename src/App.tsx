import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent, ReactNode } from 'react'
import {
  Bell,
  CheckCircle2,
  Clock3,
  Database,
  FileSpreadsheet,
  Mail,
  MapPin,
  Plus,
  RefreshCw,
  Search,
  Upload,
} from 'lucide-react'
import './App.css'

type Listing = {
  id: number
  address: string
  city: string
  city_area: string | null
  state: string
  zip: string
  price: number | null
  beds: number | null
  baths: number | null
  sqft: number | null
  lot: string
  property_type: string
  listing_type: string
  status: string
  auction_at: string
  commute_minutes: number | null
  distance_miles: number | null
  commute_status: 'within_30_min' | 'outside_30_min' | 'unknown_commute'
  facing_degrees: number | null
  facing_label: string
  facing_status: 'known' | 'unknown'
  facing_confidence: string
  facing_reason: string
  facing_review_status: 'unreviewed' | 'needs_review' | 'reviewed'
  url: string
  notes: string
  source_refs: Array<{ source: string; label: string; url: string }>
  updated_at: string
}

type Notification = {
  id: number
  type: string
  title: string
  message: string
  created_at: string
  read_at: string | null
}

type Stats = {
  total: number
  within: number
  facingKnown: number
  facingNeedsReview: number
  unread: number
  sources: number
  roadCacheReady: number
  roadCacheTotal: number
  cachedRoads: number
}

type CityOption = {
  value: string
  label: string
  city: string
  count: number
}

type MultiSelectOption = {
  value: string
  label: string
  count?: number
}

type Job = {
  id?: number
  type?: string
  label?: string
  status: 'idle' | 'running' | 'complete' | 'cancelled' | 'failed'
  total?: number
  completed?: number
  failed?: number
  message?: string
}

type RoadCacheStatus = {
  county: string
  source_key: string
  source_url: string
  status: 'missing' | 'refreshing' | 'ready' | 'partial' | 'failed'
  records_downloaded: number
  pages_downloaded: number
  last_error: string
  refreshed_at: string | null
}

const emptyStats: Stats = {
  total: 0,
  within: 0,
  facingKnown: 0,
  facingNeedsReview: 0,
  unread: 0,
  sources: 0,
  roadCacheReady: 0,
  roadCacheTotal: 4,
  cachedRoads: 0,
}

const facingOptions: MultiSelectOption[] = [
  { value: 'N', label: 'North' },
  { value: 'NE', label: 'Northeast' },
  { value: 'E', label: 'East' },
  { value: 'SE', label: 'Southeast' },
  { value: 'S', label: 'South' },
  { value: 'SW', label: 'Southwest' },
  { value: 'W', label: 'West' },
  { value: 'NW', label: 'Northwest' },
  { value: 'unknown', label: 'Facing unknown' },
  { value: 'needs_review', label: 'Needs review' },
]

function App() {
  const [listings, setListings] = useState<Listing[]>([])
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [stats, setStats] = useState<Stats>(emptyStats)
  const [cities, setCities] = useState<CityOption[]>([])
  const [roadCache, setRoadCache] = useState<RoadCacheStatus[]>([])
  const [job, setJob] = useState<Job>({ status: 'idle' })
  const previousJobStatus = useRef<Job['status']>('idle')
  const [commuteFilter, setCommuteFilter] = useState('all')
  const [cityFilter, setCityFilter] = useState<string[]>([])
  const [facingFilter, setFacingFilter] = useState<string[]>([])
  const [sort, setSort] = useState('commute_asc')
  const [query, setQuery] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [emailText, setEmailText] = useState('')
  const [emailSource, setEmailSource] = useState('zillow_email')
  const [manual, setManual] = useState({
    address: '',
    url: '',
    price: '',
    beds: '',
    baths: '',
    sqft: '',
    listing_type: 'regular_sale',
    notes: '',
  })

  const sortedNotifications = useMemo(
    () => notifications.slice(0, 6),
    [notifications],
  )
  const cityOptions = useMemo(
    () => cities.map((item) => ({
      value: item.value ?? item.city,
      label: item.label ?? item.city,
      count: item.count,
    })),
    [cities],
  )
  const isWorking = busy || job.status === 'running'

  const refresh = useCallback(async () => {
    const params = new URLSearchParams()
    if (commuteFilter !== 'all') params.set('commute', commuteFilter)
    for (const city of cityFilter) params.append('city', city)
    for (const facing of facingFilter) params.append('facing', facing)
    if (sort !== 'commute_asc') params.set('sort', sort)
    if (query) params.set('query', query)
    const [listingRes, statsRes, notificationRes, citiesRes, roadCacheRes] = await Promise.all([
      fetch(`/api/listings?${params}`),
      fetch('/api/stats'),
      fetch('/api/notifications'),
      fetch('/api/cities'),
      fetch('/api/road-cache/status'),
    ])
    setListings(await listingRes.json())
    setStats(await statsRes.json())
    setNotifications(await notificationRes.json())
    setCities(await citiesRes.json())
    setRoadCache(await roadCacheRes.json())
  }, [commuteFilter, cityFilter, facingFilter, sort, query])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    let cancelled = false;
  async function pollJob() {
      const response = await fetch('/api/jobs/current')
      const payload = await response.json()
      if (cancelled) return
      const shouldRefresh = payload.status === 'running'
        || (previousJobStatus.current === 'running' && payload.status !== 'running')
      const shouldUpdateMessage = payload.status === 'running'
        || (previousJobStatus.current === 'running' && payload.status !== 'running')
      previousJobStatus.current = payload.status
      setJob(payload)
      if (shouldUpdateMessage) {
        setMessage(formatJobNotice(payload))
      }
      if (shouldRefresh) {
        await refresh()
      }
    }

    void pollJob()
    const timer = window.setInterval(() => {
      void pollJob()
    }, job.status === 'running' ? 1000 : 5000)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [job.status, refresh])

  async function runAction(label: string, action: () => Promise<unknown>) {
    setBusy(true)
    setMessage(`${label}: working...`)
    try {
      const result = await action()
      const resultJob = jobFromResult(result)
      if (resultJob) {
        previousJobStatus.current = resultJob.status
        setJob(resultJob)
      }
      setMessage(formatResult(label, result))
      await refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  async function uploadRedfin(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    await runAction('Redfin import', async () => {
      const form = new FormData()
      form.append('file', file)
      return postForm('/api/import/redfin', form)
    })
    event.target.value = ''
  }

  async function importEmail(event: FormEvent) {
    event.preventDefault()
    await runAction('Email import', () => postJson('/api/import/email', { text: emailText, source: emailSource }))
    setEmailText('')
  }

  async function addManual(event: FormEvent) {
    event.preventDefault()
    await runAction('Manual save', () => postJson('/api/import/manual', manual))
    setManual({
      address: '',
      url: '',
      price: '',
      beds: '',
      baths: '',
      sqft: '',
      listing_type: 'regular_sale',
      notes: '',
    })
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Private RTP collector</p>
          <h1>House Hunter</h1>
          <p className="subtle">
            Collect listings and public-sale leads, then screen them against a 30 minute drive to 100 New Millennium Way.
          </p>
        </div>
        <div className="header-actions">
          <button
            className="primary"
            type="button"
            disabled={isWorking}
            onClick={() => runAction('Road cache refresh', () => postJson('/api/road-cache/refresh', {}))}
          >
            <RefreshCw size={17} />
            Refresh Road Cache
          </button>
          <button
            type="button"
            disabled={isWorking || stats.roadCacheReady === 0}
            onClick={() => runAction('County road facing', () => postJson('/api/facing/county-cache', {}))}
          >
            <RefreshCw size={17} />
            Classify From Road Cache
          </button>
          <button
            type="button"
            disabled={isWorking}
            onClick={() => runAction('Commute refresh', () => postJson('/api/commutes/refresh', {}))}
          >
            <RefreshCw size={17} />
            Refresh Commutes
          </button>
        </div>
      </header>

      <section className="metrics" aria-label="Listing metrics">
        <Metric icon={<Database size={20} />} label="Listings" value={stats.total} />
        <Metric icon={<Clock3 size={20} />} label="Within 30 min" value={stats.within} />
        <Metric icon={<CheckCircle2 size={20} />} label="Facing Known" value={stats.facingKnown} />
        <Metric icon={<CheckCircle2 size={20} />} label="Needs Review" value={stats.facingNeedsReview} />
        <Metric icon={<Bell size={20} />} label="Unread alerts" value={stats.unread} />
        <Metric icon={<Database size={20} />} label="Road Cache" value={`${stats.roadCacheReady}/${stats.roadCacheTotal}`} />
      </section>

      {message && <div className="notice">{message}</div>}
      {job.status === 'running' && <JobProgress job={job} />}
      <RoadCachePanel statuses={roadCache} cachedRoads={stats.cachedRoads} />

      <section className="workspace">
        <div className="imports">
          <div className="panel">
            <div className="panel-title">
              <FileSpreadsheet size={18} />
              <h2>Redfin Export</h2>
            </div>
            <label className="file-drop">
              <Upload size={18} />
              <span>Upload CSV or XLSX</span>
              <input type="file" accept=".csv,.xlsx,.xls" onChange={uploadRedfin} disabled={isWorking} />
            </label>
          </div>

          <form className="panel" onSubmit={importEmail}>
            <div className="panel-title">
              <Mail size={18} />
              <h2>Email Alert</h2>
            </div>
            <select value={emailSource} onChange={(event) => setEmailSource(event.target.value)}>
              <option value="zillow_email">Zillow email</option>
              <option value="redfin_email">Redfin email</option>
              <option value="realtor_email">Realtor email</option>
              <option value="auction_email">Auction email</option>
            </select>
            <textarea
              value={emailText}
              onChange={(event) => setEmailText(event.target.value)}
              placeholder="Paste an alert email or .eml text here"
              rows={6}
            />
            <button type="submit" disabled={isWorking || !emailText.trim()}>
              <Plus size={16} />
              Import Alert
            </button>
          </form>

          <form className="panel" onSubmit={addManual}>
            <div className="panel-title">
              <MapPin size={18} />
              <h2>Manual Save</h2>
            </div>
            <input
              value={manual.address}
              onChange={(event) => setManual({ ...manual, address: event.target.value })}
              placeholder="Address"
            />
            <input
              value={manual.url}
              onChange={(event) => setManual({ ...manual, url: event.target.value })}
              placeholder="Listing URL"
            />
            <div className="grid-two">
              <input value={manual.price} onChange={(event) => setManual({ ...manual, price: event.target.value })} placeholder="Price" />
              <input value={manual.beds} onChange={(event) => setManual({ ...manual, beds: event.target.value })} placeholder="Beds" />
              <input value={manual.baths} onChange={(event) => setManual({ ...manual, baths: event.target.value })} placeholder="Baths" />
              <input value={manual.sqft} onChange={(event) => setManual({ ...manual, sqft: event.target.value })} placeholder="Sqft" />
            </div>
            <select
              value={manual.listing_type}
              onChange={(event) => setManual({ ...manual, listing_type: event.target.value })}
            >
              <option value="regular_sale">Regular sale</option>
              <option value="foreclosure">Foreclosure</option>
              <option value="auction">Auction</option>
              <option value="county_tax_sale">County tax sale</option>
              <option value="reo">REO</option>
            </select>
            <textarea
              value={manual.notes}
              onChange={(event) => setManual({ ...manual, notes: event.target.value })}
              placeholder="Notes"
              rows={3}
            />
            <button type="submit" disabled={isWorking || (!manual.address.trim() && !manual.url.trim())}>
              <Plus size={16} />
              Save Listing
            </button>
          </form>

          <div className="panel">
            <div className="panel-title">
              <RefreshCw size={18} />
              <h2>Public Sales</h2>
            </div>
            <p className="small">
              Checks Durham, Wake-area references, Orange, Chatham, Doug Davis, and Auction.com entry points without scraping consumer portal result pages.
            </p>
            <button
              type="button"
              disabled={isWorking}
              onClick={() => runAction('Public sale sync', () => postJson('/api/sync/public-sales', {}))}
            >
              <RefreshCw size={16} />
              Check Sources
            </button>
          </div>
        </div>

        <section className="results">
          <div className="results-header">
            <div>
              <h2>Listings</h2>
              <p className="small">Everything is retained; filters only change what you see here.</p>
            </div>
            <div className="filters">
              <label className="searchbox">
                <Search size={16} />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search" />
              </label>
              <select value={commuteFilter} onChange={(event) => setCommuteFilter(event.target.value)}>
                <option value="all">All commute states</option>
                <option value="within_30_min">Within 30 min</option>
                <option value="outside_30_min">Outside 30 min</option>
                <option value="unknown_commute">Unknown commute</option>
              </select>
              <MultiSelectFilter
                label="Cities"
                options={cityOptions}
                selected={cityFilter}
                onChange={setCityFilter}
              />
              <MultiSelectFilter
                label="Facings"
                options={facingOptions}
                selected={facingFilter}
                onChange={setFacingFilter}
              />
              <select value={sort} onChange={(event) => setSort(event.target.value)}>
                <option value="commute_asc">Drive time</option>
                <option value="distance_asc">Distance</option>
                <option value="price_asc">Price low to high</option>
                <option value="price_desc">Price high to low</option>
                <option value="facing_direction">Facing direction</option>
                <option value="updated_desc">Recently updated</option>
              </select>
            </div>
          </div>

          <div className="listing-list">
            {listings.map((listing) => <ListingRow key={listing.id} listing={listing} />)}
            {listings.length === 0 && (
              <div className="empty">
                <Database size={22} />
                <p>No listings yet. Import a Redfin export, paste an alert, or save a listing manually.</p>
              </div>
            )}
          </div>
        </section>

        <aside className="notifications">
          <div className="panel-title">
            <Bell size={18} />
            <h2>Notifications</h2>
          </div>
          <button
            className="quiet"
            type="button"
            disabled={isWorking || notifications.every((item) => item.read_at)}
            onClick={() => runAction('Notifications', () => postJson('/api/notifications/read', {}))}
          >
            Mark Read
          </button>
          <button
            className="quiet danger"
            type="button"
            disabled={isWorking || notifications.length === 0}
            onClick={() => runAction('Notifications', () => deleteJson('/api/notifications'))}
          >
            Clear All
          </button>
          {sortedNotifications.map((item) => (
            <article className={item.read_at ? 'notification' : 'notification unread'} key={item.id}>
              <strong>{item.title}</strong>
              <p>{item.message}</p>
              <span>{new Date(item.created_at).toLocaleString()}</span>
            </article>
          ))}
          {sortedNotifications.length === 0 && <p className="small">New listings and material changes will land here.</p>}
        </aside>
      </section>
    </main>
  )
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
  return (
    <div className="metric">
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function MultiSelectFilter({
  label,
  options,
  selected,
  onChange,
}: {
  label: string
  options: MultiSelectOption[]
  selected: string[]
  onChange: (values: string[]) => void
}) {
  function toggle(value: string) {
    onChange(
      selected.includes(value)
        ? selected.filter((item) => item !== value)
        : [...selected, value],
    )
  }

  return (
    <details className="multi-filter">
      <summary>{multiSelectSummary(label, selected, options)}</summary>
      <div className="multi-filter-menu">
        <div className="multi-filter-header">
          <strong>{label}</strong>
          <button
            className="quiet compact"
            type="button"
            disabled={selected.length === 0}
            onClick={() => onChange([])}
          >
            Clear
          </button>
        </div>
        <div className="multi-filter-options">
          {options.map((option) => (
            <label className="multi-filter-option" key={option.value}>
              <input
                type="checkbox"
                checked={selected.includes(option.value)}
                onChange={() => toggle(option.value)}
              />
              <span>
                {option.label}
                {option.count !== undefined && ` (${option.count})`}
              </span>
            </label>
          ))}
        </div>
      </div>
    </details>
  )
}

function RoadCachePanel({ statuses, cachedRoads }: { statuses: RoadCacheStatus[]; cachedRoads: number }) {
  return (
    <section className="road-cache" aria-label="Road cache status">
      <div>
        <strong>County Road Cache</strong>
        <span>{cachedRoads.toLocaleString()} cached road segments</span>
      </div>
      <div className="cache-counties">
        {statuses.map((item) => (
          <span className={`cache-pill ${item.status}`} key={item.county} title={item.last_error || item.source_key || 'No cache details yet'}>
            {item.county}: {formatCacheStatus(item)}
          </span>
        ))}
      </div>
    </section>
  )
}

function multiSelectSummary(label: string, selected: string[], options: MultiSelectOption[]) {
  if (selected.length === 0) return `All ${label.toLowerCase()}`
  if (selected.length === 1) {
    return options.find((option) => option.value === selected[0])?.label ?? selected[0]
  }
  return `${label}: ${selected.length} selected`
}

function JobProgress({ job }: { job: Job }) {
  const total = job.total ?? 0
  const completed = job.completed ?? 0
  const percent = total ? Math.round((completed / total) * 100) : 0
  const failed = job.failed ?? 0
  const unit = jobUnitLabel(job.type)

  return (
    <section className="job-progress" aria-live="polite">
      <div>
        <strong>{job.label ?? 'Working'}</strong>
        <span className={`job-status ${job.status}`}>{jobStatusLabel(job.status)}</span>
      </div>
      <div className="job-progress-meta">
        <span>{completed.toLocaleString()} / {total.toLocaleString()} {unit}</span>
        <span>{percent}%</span>
        {failed > 0 && <span>{failed.toLocaleString()} failed</span>}
      </div>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${percent}%` }} />
      </div>
      <p>{job.message ?? 'Processing listings'}</p>
    </section>
  )
}

function ListingRow({ listing }: { listing: Listing }) {
  return (
    <article className="listing">
      <div className="listing-main">
        <div>
          <div className="badges">
            <span className={`badge ${listing.commute_status}`}>{commuteLabel(listing)}</span>
            <span className={`badge ${facingBadgeClass(listing)}`}>{facingLabel(listing)}</span>
            <span className="badge">{formatType(listing.listing_type)}</span>
            <span className="badge">{listing.status || 'active'}</span>
          </div>
          <h3>{listing.address || 'Address not detected'}</h3>
          <p className="small">
            {[listing.city_area || listing.city, listing.state, listing.zip].filter(Boolean).join(', ')}
          </p>
        </div>
        <div className="price">{formatMoney(listing.price)}</div>
      </div>
      <div className="facts">
        <span>{formatFact(listing.beds, 'bd')}</span>
        <span>{formatFact(listing.baths, 'ba')}</span>
        <span>{formatFact(listing.sqft, 'sqft')}</span>
        <span>{distanceLabel(listing.distance_miles)}</span>
        <span>{facingDetail(listing)}</span>
        <span>{listing.property_type || 'type unknown'}</span>
      </div>
      {listing.facing_reason && <p className="small">Facing source: {facingReasonLabel(listing.facing_reason)}</p>}
      {listing.auction_at && <p className="small">Auction: {listing.auction_at}</p>}
      {listing.notes && <p className="notes">{listing.notes}</p>}
      <div className="listing-footer">
        <span>{listing.source_refs.map((ref) => ref.label || ref.source).join(', ') || 'Unknown source'}</span>
        {listing.url && <a href={listing.url} target="_blank" rel="noreferrer">Open source</a>}
      </div>
    </article>
  )
}

async function postJson(path: string, body: unknown) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return readResponse(response)
}

async function postForm(path: string, body: FormData) {
  const response = await fetch(path, { method: 'POST', body })
  return readResponse(response)
}

async function deleteJson(path: string) {
  const response = await fetch(path, { method: 'DELETE' })
  return readResponse(response)
}

async function readResponse(response: Response) {
  const contentType = response.headers.get('content-type') ?? ''
  const payload = contentType.includes('application/json') ? await response.json() : null
  if (!response.ok) {
    const fallback = response.status === 404
      ? 'API route was not found. Restart the app so the server picks up the latest code.'
      : `Request failed with HTTP ${response.status}`
    throw new Error(payload?.error ?? fallback)
  }
  return payload
}

function formatResult(label: string, result: unknown) {
  if (!result || typeof result !== 'object') return `${label} finished`
  const value = result as { parsed?: number; created?: number; updated?: number; refreshed?: number; job?: Job }
  if (value.job) {
    const importSummary = typeof value.parsed === 'number'
      ? `${label}: parsed ${value.parsed}, saved ${value.created ?? 0} new and ${value.updated ?? 0} existing listings. `
      : ''
    return `${importSummary}${formatJobNotice(value.job)}`
  }
  if (typeof value.refreshed === 'number') return `${label}: checks started`
  return `${label}: parsed ${value.parsed ?? 0}, created ${value.created ?? 0}, updated ${value.updated ?? 0}`
}

function jobFromResult(result: unknown) {
  if (!result || typeof result !== 'object') return null
  const value = result as { job?: Job }
  return value.job ?? null
}

function formatJobNotice(job: Job) {
  const label = jobTypeLabel(job.type)
  const total = job.total ?? 0
  const completed = job.completed ?? 0
  const failed = job.failed ?? 0
  const unit = jobUnitLabel(job.type)
  const progress = total ? `${completed.toLocaleString()} / ${total.toLocaleString()} ${unit}` : 'no work queued'
  const failedText = failed ? `, ${failed.toLocaleString()} failed` : ''

  if (job.status === 'running') return `${label}: ${progress}${failedText}`
  if (job.status === 'complete') return `${label} complete: ${progress}${failedText}`
  if (job.status === 'failed') return `${label} failed: ${progress}${failedText}`
  if (job.status === 'cancelled') return `${label} cancelled: ${progress}${failedText}`
  return `${label}: idle`
}

function formatMoney(value: number | null) {
  return value ? `$${value.toLocaleString()}` : 'Price TBD'
}

function formatFact(value: number | null, label: string) {
  return value ? `${value.toLocaleString()} ${label}` : `${label} unknown`
}

function commuteLabel(listing: Listing) {
  if (listing.commute_status === 'within_30_min') return `${Math.round(listing.commute_minutes ?? 0)} min`
  if (listing.commute_status === 'outside_30_min') return `${Math.round(listing.commute_minutes ?? 0)} min`
  return 'commute unknown'
}

function distanceLabel(value: number | null) {
  return value === null || value === undefined ? 'distance unknown' : `${value.toFixed(1)} mi`
}

function facingLabel(listing: Listing) {
  if (listing.facing_review_status === 'needs_review' && listing.facing_label) return `Facing ${listing.facing_label}, review`
  if (listing.facing_label) return `Facing ${listing.facing_label}`
  if (listing.facing_review_status === 'needs_review') return 'Facing needs review'
  return 'facing unknown'
}

function facingBadgeClass(listing: Listing) {
  if (listing.facing_review_status === 'needs_review') return 'facing-review'
  return listing.facing_label ? 'facing-known' : 'facing-unknown'
}

function facingDetail(listing: Listing) {
  if (listing.facing_degrees === null || listing.facing_degrees === undefined) return 'facing unknown'
  const confidence = listing.facing_confidence && listing.facing_confidence !== 'unknown'
    ? `, ${listing.facing_confidence}`
    : ''
  return `${Math.round(listing.facing_degrees)} deg ${listing.facing_label}${confidence}`
}

function facingReasonLabel(reason: string) {
  const street = reason.includes(';') ? reason.split(';')[0].trim() : ''
  const prefix = street ? `${street}: ` : ''
  if (reason.includes('map_lookup_failed')) return `${prefix}Map lookup failed, retry later`
  if (reason.includes('named_street_not_found')) return `${prefix}Named street not found in map data`
  if (reason.includes('road_cache_unavailable')) return `${prefix}Road cache unavailable`
  if (reason.includes('named_road_not_found')) return `${prefix}Named road not found in county road cache`
  if (reason.includes('low_confidence_needs_review')) return `${prefix}Low confidence, needs review`
  if (reason.includes('auto_county_roads_high_confidence')) return `${prefix}County road cache, high confidence`
  if (reason.includes('not_a_street_address')) return `${prefix}Not a street address`
  if (reason.includes('missing_coordinates')) return 'Missing coordinates'
  return reason
}

function jobTypeLabel(type: string | undefined) {
  if (type === 'county_facing') return 'County road facing'
  if (type === 'road_cache') return 'Road cache'
  if (type === 'commute') return 'Commute'
  return 'Background'
}

function jobUnitLabel(type: string | undefined) {
  if (type === 'road_cache') return 'counties'
  return 'checked'
}

function jobStatusLabel(status: Job['status']) {
  if (status === 'complete') return 'complete'
  if (status === 'cancelled') return 'cancelled'
  if (status === 'failed') return 'failed'
  if (status === 'running') return 'running'
  return 'idle'
}

function formatCacheStatus(item: RoadCacheStatus) {
  if (item.status === 'ready') return `${item.records_downloaded.toLocaleString()} roads`
  if (item.status === 'partial') return `partial, ${item.records_downloaded.toLocaleString()} roads`
  return item.status.replace(/_/g, ' ')
}

function formatType(value: string) {
  return value.replace(/_/g, ' ')
}

export default App
