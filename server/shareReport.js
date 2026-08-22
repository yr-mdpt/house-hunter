const FACING_OPTIONS = [
  ['N', 'North'],
  ['NE', 'Northeast'],
  ['E', 'East'],
  ['SE', 'Southeast'],
  ['S', 'South'],
  ['SW', 'Southwest'],
  ['W', 'West'],
  ['NW', 'Northwest'],
  ['unknown', 'Facing unknown'],
  ['needs_review', 'Needs review'],
];

export function renderShareReport({ listings, notifications, stats, cities, generatedAt = new Date().toISOString() }) {
  const data = {
    generatedAt,
    stats,
    cities,
    facingOptions: FACING_OPTIONS.map(([value, label]) => ({ value, label })),
    listings: listings.map(reportListing),
    notifications,
  };

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>House Hunter Report</title>
  <style>${REPORT_CSS}</style>
</head>
<body>
  <main class="shell">
    <header class="topbar">
      <div>
        <p class="eyebrow">Private RTP collector</p>
        <h1>House Hunter Report</h1>
        <p class="subtle">Snapshot generated <span id="generated-at"></span></p>
      </div>
      <div class="summary" id="summary"></div>
    </header>

    <section class="toolbar" aria-label="Report filters">
      <label class="searchbox">
        <span>Search</span>
        <input id="search" type="search" placeholder="Address, city, zip, type">
      </label>
      <label>
        <span>Commute</span>
        <select id="commute">
          <option value="all">All commute states</option>
          <option value="within_30_min">Within 30 min</option>
          <option value="outside_30_min">Outside 30 min</option>
          <option value="unknown_commute">Unknown commute</option>
        </select>
      </label>
      <label>
        <span>Sort</span>
        <select id="sort">
          <option value="commute_asc">Drive time</option>
          <option value="distance_asc">Distance</option>
          <option value="price_asc">Price low to high</option>
          <option value="price_desc">Price high to low</option>
          <option value="facing_direction">Facing direction</option>
          <option value="updated_desc">Recently updated</option>
        </select>
      </label>
      <details class="multi-filter">
        <summary id="city-summary">All cities</summary>
        <div class="multi-menu">
          <div class="multi-head"><strong>Cities</strong><button type="button" data-clear="city">Clear</button></div>
          <div id="city-options"></div>
        </div>
      </details>
      <details class="multi-filter">
        <summary id="facing-summary">All facings</summary>
        <div class="multi-menu">
          <div class="multi-head"><strong>Facings</strong><button type="button" data-clear="facing">Clear</button></div>
          <div id="facing-options"></div>
        </div>
      </details>
    </section>

    <section class="layout">
      <section class="results">
        <div class="section-head">
          <div>
            <h2>Listings</h2>
            <p id="result-count" class="small"></p>
          </div>
        </div>
        <div id="listing-list" class="listing-list"></div>
      </section>
      <aside class="notifications">
        <h2>Notifications</h2>
        <div id="notification-list"></div>
      </aside>
    </section>
  </main>
  <script id="report-data" type="application/json">${safeJsonScript(data)}</script>
  <script>${REPORT_JS}</script>
</body>
</html>`;
}

function reportListing(listing) {
  const {
    raw_payloads: _rawPayloads,
    dedupe_key: _dedupeKey,
    ...rest
  } = listing;
  return rest;
}

function safeJsonScript(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

const REPORT_CSS = `
:root{font-family:Inter,Segoe UI,Arial,sans-serif;color:#18201d;background:#f6f7f2}
*{box-sizing:border-box}body{margin:0}.shell{min-height:100vh}.topbar{display:flex;justify-content:space-between;gap:24px;padding:28px clamp(18px,4vw,48px);background:#fff;border-bottom:1px solid #dfe3d7}.eyebrow{margin:0 0 6px;color:#25635b;font-size:13px;font-weight:700;text-transform:uppercase}h1,h2,h3,p{margin:0}h1{font-size:34px;line-height:1.1}h2{font-size:16px}.subtle,.small{color:#68746f}.subtle{margin-top:8px}.summary{display:grid;grid-template-columns:repeat(3,minmax(90px,1fr));gap:1px;background:#dfe3d7;border:1px solid #dfe3d7;align-self:start}.metric{background:#fff;padding:10px 12px}.metric span{display:block;color:#68746f;font-size:12px}.metric strong{font-size:20px}.toolbar{display:grid;grid-template-columns:repeat(5,minmax(150px,1fr));gap:10px;padding:16px clamp(18px,4vw,48px);background:#fff;border-bottom:1px solid #dfe3d7;position:sticky;top:0;z-index:5}.toolbar label{display:flex;flex-direction:column;gap:5px;color:#68746f;font-size:12px}input,select,button,.multi-filter summary{font:inherit;border:1px solid #cfd6ca;border-radius:7px;background:#fff;color:#18201d;min-height:38px;padding:8px 10px}button{cursor:pointer}.multi-filter{position:relative}.multi-filter summary{list-style:none;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.multi-filter summary::-webkit-details-marker{display:none}.multi-menu{position:absolute;top:calc(100% + 5px);left:0;right:0;z-index:10;min-width:220px;max-height:280px;overflow:auto;background:#fff;border:1px solid #cfd6ca;border-radius:7px;box-shadow:0 12px 26px rgba(24,32,29,.14);padding:8px}.multi-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding-bottom:8px}.multi-head button{min-height:30px;padding:5px 8px}.option{display:flex;align-items:center;gap:8px;padding:7px 6px;border-radius:6px;color:#34403a;font-size:13px}.option:hover{background:#f6f7f2}.option input{width:auto}.layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(250px,320px);gap:18px;padding:20px clamp(18px,4vw,48px) 42px}.results,.notifications{background:#fff;border:1px solid #dfe3d7;border-radius:8px}.section-head{padding:16px;border-bottom:1px solid #dfe3d7}.listing{padding:16px;border-bottom:1px solid #e8ebe2}.listing-main,.listing-footer{display:flex;justify-content:space-between;gap:16px}.badges,.facts{display:flex;flex-wrap:wrap;gap:7px}.badge,.facts span{border-radius:999px;background:#eef2ea;color:#34403a;font-size:12px;line-height:1;padding:6px 8px}.badge.favorite{background:#fff6dc;color:#a66a00}.within_30_min{background:#dff3e7!important;color:#17623a!important}.outside_30_min{background:#f7e1df!important;color:#8b2e22!important}.unknown_commute{background:#f2ecd4!important;color:#6f5314!important}.facing-review{background:#e3e7f7!important;color:#2b3a79!important}.facing-unknown{background:#f2ecd4!important;color:#6f5314!important}.price{font-size:20px;font-weight:800;white-space:nowrap}.facts{margin:12px 0}.notes{color:#3d4843;font-size:13px;margin-top:10px}.listing-footer{color:#68746f;font-size:13px;margin-top:12px}.notifications{padding:14px;align-self:start}.notification{padding:12px 0;border-top:1px solid #e8ebe2}.notification p{color:#3d4843;font-size:13px;line-height:1.4;margin-top:5px}.notification-footer{display:flex;justify-content:space-between;gap:10px;margin-top:6px;color:#68746f;font-size:12px}a{color:#1a5fb4;font-weight:700;text-decoration:none}a:hover{text-decoration:underline}.empty{min-height:180px;display:grid;place-items:center;color:#68746f;text-align:center;padding:24px}@media(max-width:980px){.topbar,.layout{grid-template-columns:1fr}.topbar{flex-direction:column}.toolbar{grid-template-columns:1fr 1fr}.layout{display:block}.notifications{margin-top:18px}.summary{grid-template-columns:repeat(2,minmax(90px,1fr))}}@media(max-width:640px){.toolbar,.listing-main,.listing-footer{grid-template-columns:1fr;flex-direction:column}.price{font-size:18px}}
`;

const REPORT_JS = `
const data=JSON.parse(document.getElementById('report-data').textContent);
const state={query:'',commute:'all',sort:'commute_asc',cities:new Set(),facings:new Set()};
const directionOrder={N:1,NE:2,E:3,SE:4,S:5,SW:6,W:7,NW:8};
document.getElementById('generated-at').textContent=new Date(data.generatedAt).toLocaleString();
document.getElementById('summary').innerHTML=[
  ['Listings',data.stats.total],['Within 30 min',data.stats.within],['Facing known',data.stats.facingKnown],
  ['Unread alerts',data.stats.unread],['Sources',data.stats.sources],['Road cache',data.stats.roadCacheReady+'/'+data.stats.roadCacheTotal]
].map(([label,value])=>'<div class="metric"><span>'+escapeHtml(label)+'</span><strong>'+escapeHtml(value)+'</strong></div>').join('');
renderOptions('city',data.cities.map(item=>({value:item.value,label:item.label,count:item.count})));
renderOptions('facing',data.facingOptions);
document.getElementById('search').addEventListener('input',event=>{state.query=event.target.value.toLowerCase();renderListings();});
document.getElementById('commute').addEventListener('change',event=>{state.commute=event.target.value;renderListings();});
document.getElementById('sort').addEventListener('change',event=>{state.sort=event.target.value;renderListings();});
document.querySelectorAll('[data-clear]').forEach(button=>button.addEventListener('click',()=>{filterSet(button.dataset.clear).clear();document.querySelectorAll('[data-filter="'+button.dataset.clear+'"]').forEach(input=>input.checked=false);updateSummaries();renderListings();}));
renderNotifications();
updateSummaries();
renderListings();

function renderOptions(kind,options){
  const target=document.getElementById(kind+'-options');
  target.innerHTML=options.map(option=>'<label class="option"><input type="checkbox" data-filter="'+kind+'" value="'+escapeAttr(option.value)+'"><span>'+escapeHtml(option.label)+(option.count!==undefined?' ('+escapeHtml(option.count)+')':'')+'</span></label>').join('');
  target.querySelectorAll('input').forEach(input=>input.addEventListener('change',()=>{const set=filterSet(kind);input.checked?set.add(input.value):set.delete(input.value);updateSummaries();renderListings();}));
}
function filterSet(kind){return kind==='city'?state.cities:state.facings;}
function updateSummaries(){
  summary('city','Cities',data.cities);
  summary('facing','Facings',data.facingOptions);
}
function summary(kind,label,options){
  const selected=[...state[kind+'s']];
  const el=document.getElementById(kind+'-summary');
  if(selected.length===0){el.textContent='All '+label.toLowerCase();return;}
  if(selected.length===1){const option=options.find(item=>item.value===selected[0]);el.textContent=option?option.label:selected[0];return;}
  el.textContent=label+': '+selected.length+' selected';
}
function renderListings(){
  const list=filteredListings().sort(compareListings);
  document.getElementById('result-count').textContent=list.length.toLocaleString()+' of '+data.listings.length.toLocaleString()+' listings';
  document.getElementById('listing-list').innerHTML=list.length?list.map(listingHtml).join(''):'<div class="empty">No listings match these filters.</div>';
}
function filteredListings(){
  return data.listings.filter(listing=>{
    if(state.commute!=='all'&&listing.commute_status!==state.commute)return false;
    if(state.cities.size&&![...state.cities].some(value=>matchesCity(listing,value)))return false;
    if(state.facings.size&&![...state.facings].some(value=>matchesFacing(listing,value)))return false;
    if(state.query){
      const text=[listing.address,listing.city,listing.city_area,listing.zip,listing.property_type,listing.listing_type].filter(Boolean).join(' ').toLowerCase();
      if(!text.includes(state.query))return false;
    }
    return true;
  });
}
function matchesCity(listing,value){
  if(value.startsWith('city:'))return listing.city===value.slice(5);
  if(value.startsWith('area:'))return listing.city_area===value.slice(5);
  return listing.city===value;
}
function matchesFacing(listing,value){
  if(value==='needs_review')return listing.facing_review_status==='needs_review';
  if(value==='unknown')return !listing.facing_label;
  return listing.facing_label===value;
}
function compareListings(a,b){
  if(state.sort==='price_asc')return nullLast(a.price,b.price)||commuteCompare(a,b);
  if(state.sort==='price_desc')return nullLast(b.price,a.price)||commuteCompare(a,b);
  if(state.sort==='distance_asc')return nullLast(a.distance_miles,b.distance_miles)||commuteCompare(a,b);
  if(state.sort==='facing_direction')return (directionOrder[a.facing_label]??99)-(directionOrder[b.facing_label]??99)||commuteCompare(a,b);
  if(state.sort==='updated_desc')return String(b.updated_at??'').localeCompare(String(a.updated_at??''));
  return commuteCompare(a,b);
}
function commuteCompare(a,b){return nullLast(a.commute_minutes,b.commute_minutes)||nullLast(a.distance_miles,b.distance_miles)||String(b.updated_at??'').localeCompare(String(a.updated_at??''));}
function nullLast(a,b){const av=a===null||a===undefined;const bv=b===null||b===undefined;if(av&&bv)return 0;if(av)return 1;if(bv)return -1;return a-b;}
function listingHtml(listing){
  const location=[listing.city_area||listing.city,listing.state,listing.zip].filter(Boolean).join(', ');
  return '<article class="listing"><div class="listing-main"><div><div class="badges">'+
    '<span class="badge '+escapeAttr(listing.commute_status)+'">'+escapeHtml(commuteLabel(listing))+'</span>'+
    '<span class="badge '+escapeAttr(facingClass(listing))+'">'+escapeHtml(facingLabel(listing))+'</span>'+
    (listing.is_favorite?'<span class="badge favorite">Favorite</span>':'')+
    '<span class="badge">'+escapeHtml(formatType(listing.listing_type))+'</span><span class="badge">'+escapeHtml(listing.status||'active')+'</span></div>'+
    '<h3>'+escapeHtml(listing.address||'Address not detected')+'</h3><p class="small">'+escapeHtml(location)+'</p></div>'+
    '<div class="price">'+escapeHtml(formatMoney(listing.price))+'</div></div>'+
    '<div class="facts"><span>'+escapeHtml(formatFact(listing.beds,'bd'))+'</span><span>'+escapeHtml(formatFact(listing.baths,'ba'))+'</span><span>'+escapeHtml(formatFact(listing.sqft,'sqft'))+'</span><span>'+escapeHtml(yearBuiltLabel(listing.year_built))+'</span><span>'+escapeHtml(distanceLabel(listing.distance_miles))+'</span><span>'+escapeHtml(facingDetail(listing))+'</span><span>'+escapeHtml(listing.property_type||'type unknown')+'</span></div>'+
    (listing.notes?'<p class="notes">'+escapeHtml(listing.notes)+'</p>':'')+
    '<div class="listing-footer"><span>'+escapeHtml(sourceLabel(listing))+'</span>'+(listing.url?'<a href="'+escapeAttr(listing.url)+'" target="_blank" rel="noreferrer">Open source</a>':'')+'</div></article>';
}
function renderNotifications(){
  const target=document.getElementById('notification-list');
  target.innerHTML=data.notifications.length?data.notifications.map(item=>'<article class="notification"><strong>'+escapeHtml(item.title)+'</strong><p>'+escapeHtml(item.message)+'</p><div class="notification-footer"><span>'+escapeHtml(new Date(item.created_at).toLocaleString())+'</span>'+(item.url?'<a href="'+escapeAttr(item.url)+'" target="_blank" rel="noreferrer">Open source</a>':'')+'</div></article>').join(''):'<p class="small">No notifications in this snapshot.</p>';
}
function sourceLabel(listing){return (listing.source_refs||[]).map(ref=>ref.label||ref.source).filter(Boolean).join(', ')||'Unknown source';}
function formatMoney(value){return value?'$'+Number(value).toLocaleString():'Price TBD';}
function formatFact(value,label){return value?Number(value).toLocaleString()+' '+label:label+' unknown';}
function yearBuiltLabel(value){return value?'built '+value:'year built unknown';}
function distanceLabel(value){return value===null||value===undefined?'distance unknown':Number(value).toFixed(1)+' mi';}
function commuteLabel(listing){return listing.commute_status==='unknown_commute'?'commute unknown':Math.round(listing.commute_minutes||0)+' min';}
function facingLabel(listing){if(listing.facing_review_status==='needs_review'&&listing.facing_label)return 'Facing '+listing.facing_label+', review';if(listing.facing_label)return 'Facing '+listing.facing_label;if(listing.facing_review_status==='needs_review')return 'Facing needs review';return 'facing unknown';}
function facingClass(listing){if(listing.facing_review_status==='needs_review')return 'facing-review';return listing.facing_label?'facing-known':'facing-unknown';}
function facingDetail(listing){if(listing.facing_degrees===null||listing.facing_degrees===undefined)return 'facing unknown';return Math.round(listing.facing_degrees)+' deg '+(listing.facing_label||'');}
function formatType(value){return String(value||'').replace(/_/g,' ');}
function escapeHtml(value){return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));}
function escapeAttr(value){return escapeHtml(value);}
`;
