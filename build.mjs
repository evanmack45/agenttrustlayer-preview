// Build the static map from ../data/*.json into docs/. No dependencies.
// Usage: node build.mjs [--data ../data] [--out docs] [--base https://.../]
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const DATA = arg('--data', join(here, '..', 'data'));
const OUT = arg('--out', join(here, 'docs'));
const BASE = arg('--base', 'https://evanmack45.github.io/agenttrustlayer-preview/');

const entriesDoc = JSON.parse(readFileSync(join(DATA, 'entries.json'), 'utf8'));
const changelogDoc = JSON.parse(readFileSync(join(DATA, 'changelog.json'), 'utf8'));
const entries = entriesDoc.entries;
const events = [...changelogDoc.events].sort((a, b) => b.date.localeCompare(a.date));
const generated = entriesDoc.generated;

// ---------- boundary checks: fail the build on bad data ----------
const REQUIRED = ['id', 'name', 'category', 'kind', 'description', 'source_url', 'verification', 'last_checked'];
const ids = new Set();
for (const e of entries) {
  for (const k of REQUIRED) if (!e[k]) throw new Error(`entry ${e.id || e.name}: missing ${k}`);
  if (ids.has(e.id)) throw new Error(`duplicate id ${e.id}`);
  ids.add(e.id);
  if (!/^https?:\/\//.test(e.source_url)) throw new Error(`entry ${e.id}: bad source_url`);
  if (e.source_date && !/^\d{4}-\d{2}(-\d{2})?$/.test(e.source_date)) throw new Error(`entry ${e.id}: bad source_date`);
}
for (const ev of events) if (!ev.date || !ev.title || !/^https?:\/\//.test(ev.source_url || '')) throw new Error(`event bad: ${ev.title}`);

// ---------- domain model ----------
const SEAL = { id: 'identity', auth: 'grant', pay: 'payment', ver: 'receipt' };
const GATES = [
  { n: 1, cat: 'identity', key: 'id', q: 'Who are you?', plain: 'Identity', carries: 'a signed key that names the agent and its operator',
    ex: [['web-bot-auth', 'Web Bot Auth'], ['agent-name-service-ans', 'ANS']], line: 'signed identity',
    re: /identit|naming|name serv|registr|discover|know your agent/i },
  { n: 2, cat: 'auth/permissions', key: 'auth', q: 'What may you do?', plain: 'Auth and permissions', carries: 'a scoped grant that says what the agent may do, for whom',
    ex: [['oauth-identity-assertion-jwt-authorization-grant-id-jag', 'ID-JAG']], line: 'scoped grant',
    re: /authori[sz]|permission|delegat|grant|access|polic/i },
  { n: 3, cat: 'payments/commerce', key: 'pay', q: 'Can you pay?', plain: 'Payments and commerce', carries: 'a payment token the merchant can check',
    ex: [['x402-and-the-x402-foundation', 'x402'], ['agent-payments-protocol-ap2', 'AP2']], line: 'payment token',
    re: /pay|commerce|checkout|transaction|merchant|shopping/i },
  { n: 4, cat: 'verification', key: 'ver', q: 'Can we prove what you did?', plain: 'Verification and records', carries: 'a signed receipt of what happened',
    ex: [['agent-execution-receipts-aer-1', 'AER-1'], ['verifiable-intent', 'Verifiable Intent']], line: 'signed receipt',
    re: /verif|receipt|audit|prove|proof|attest|record/i },
];
const CAT_KEY = { identity: 'id', 'auth/permissions': 'auth', 'payments/commerce': 'pay', verification: 'ver', standards: 'std', deals: 'deal' };
const CAT_LABEL = { identity: 'Identity', 'auth/permissions': 'Auth and permissions', 'payments/commerce': 'Payments and commerce', verification: 'Verification', standards: 'Standards', deals: 'Deals' };
const EVENT_KEY = { standard: 'std', deal: 'deal', product: 'prod' };
const EVENT_LABEL = { standard: 'Standard', deal: 'Deal', product: 'Product' };

const VER_BASE = {
  primary: 'Primary source', secondary: 'Secondary source', 'vendor-claim': "Vendor's own claim",
  'vendor-reported': 'Reported by the vendor', 'github-api': 'GitHub repo data',
};
function verLabel(v) {
  const key = v.match(/^[a-z-]+/i)[0];
  if (!VER_BASE[key]) console.warn(`unknown verification value: ${v}`);
  const rest = v.slice(key.length).trim().replace(/[()]/g, '');
  return (VER_BASE[key] || v) + (rest ? `, ${rest}` : '');
}
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtDate(d) {
  if (!d) return 'date not captured';
  const [y, m, day] = d.split('-').map(Number);
  return day ? `${MON[m - 1]} ${day}, ${y}` : `${MON[m - 1]} ${y}`;
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const host = (u) => new URL(u).hostname.replace(/^www\./, '');
const byId = Object.fromEntries(entries.map((e) => [e.id, e]));
const sortEntries = (list) => [...list].sort((a, b) => (b.source_date || '').localeCompare(a.source_date || '') || a.name.localeCompare(b.name));

// Acquisitions come from entry names like "AuthMind (now part of IBM)".
const merges = entries.map((e) => e.name.match(/^(.+?) \(now part of (.+)\)$/)).filter(Boolean).map((m) => ({ from: m[1].replace(/ Security$/, ''), fromFull: m[1], to: m[2] }));
function mergeFor(ev) {
  if (ev.type !== 'deal') return null;
  return merges.find((m) => ev.title.includes(m.to) && (ev.title.includes(m.fromFull) || ev.title.includes(m.from))) || null;
}

// Spec ribbon: home gate from category; other gates from words in the entry's own description.
const specs = entries.filter((e) => e.kind === 'standard' || e.kind === 'protocol').map((e) => {
  const home = GATES.find((g) => g.cat === e.category);
  const gates = GATES.map((g) => ({ n: g.n, hit: (home && home.n === g.n) || g.re.test(e.description), home: home && home.n === g.n }));
  return { e, gates };
});

// ---------- rendering ----------
const SHORT = { identity: 'Identity', 'auth/permissions': 'Permissions', 'payments/commerce': 'Payments', verification: 'Proof' };
function entryHTML(e) {
  const os = e.open_source === true ? '<span class="tag tag-os">Open source</span>' : e.open_source === false ? '<span class="tag">Not open source</span>' : '';
  const text = [e.name, e.description, e.kind, CAT_LABEL[e.category], e.note || '', verLabel(e.verification)].join(' ').toLowerCase();
  const recentable = e.source_date && e.source_date.length === 10 ? e.source_date : '';
  return `<li class="entry c-${CAT_KEY[e.category]}" id="e-${esc(e.id)}" data-cat="${esc(e.category)}" data-os="${e.open_source === true ? 1 : 0}" data-day="${recentable}" data-text="${esc(text)}">
<details><summary><span class="e-name">${esc(e.name)}</span> <span class="e-kind">${esc(e.kind)}</span></summary>
<div class="e-body"><p>${esc(e.description)}</p>${e.note ? `<p class="e-note"><b>Note.</b> ${esc(e.note)}</p>` : ''}
<p class="e-links">${e.url && e.url !== e.source_url ? `<a href="${esc(e.url)}" rel="noopener">Project page (${esc(host(e.url))})</a> <span class="sep" aria-hidden="true">/</span> ` : ''}<a href="#e-${esc(e.id)}" class="permalink" data-id="${esc(e.id)}">Link to this entry</a></p></div></details>
<p class="e-meta"><span class="${e.source_date ? 'when' : 'when nodate'}">${e.source_date ? 'Dated ' : ''}${esc(fmtDate(e.source_date))}</span><span>checked ${esc(fmtDate(e.last_checked))}</span><a class="src" href="${esc(e.source_url)}" rel="noopener">${esc(verLabel(e.verification))}<span class="vh">, source on ${esc(host(e.source_url))}</span></a>${os}</p></li>`;
}
const listHTML = (list, cls = '') => `<ol class="entries ${cls}">${sortEntries(list).map(entryHTML).join('\n')}</ol>`;
const emptyHTML = `<p class="empty" hidden><img class="empty-mini" src="img/empty-chart-440.webp" width="72" height="72" alt="" decoding="async"> No entries here match. <button type="button" class="linkbtn js-clear">Clear filters</button></p>`;

function gateHTML(g) {
  const list = entries.filter((e) => e.category === g.cat);
  return `<section class="gate c-${g.key}" id="gate-${g.n}" data-gate="${g.n}" aria-labelledby="gate-${g.n}-h">
<div class="gate-head"><p class="gate-num" aria-hidden="true">${g.n}</p><img class="gate-emblem" src="img/emblem-${({ identity: 'identity', 'auth/permissions': 'permissions', 'payments/commerce': 'payments', verification: 'verification' })[g.cat]}.webp" width="72" height="74" alt="" decoding="async"><div><h2 id="gate-${g.n}-h">${esc(g.plain)}</h2>
<p class="gate-sub">${esc(g.q)} The request carries ${esc(g.carries)}.</p>
<p class="count" aria-live="polite"><span class="shown">${list.length}</span> of ${list.length} shown</p></div></div>
${listHTML(list)}${emptyHTML}</section>`;
}

function ribbonHTML() {
  const rows = specs.map(({ e, gates }) => `<tr data-id="${esc(e.id)}"><th scope="row"><a href="#e-${esc(e.id)}">${esc(e.name)}</a></th>${gates.map((g, i) => `<td class="${[g.hit && 'hit', g.home && 'home', g.hit && (gates[i - 1]?.hit || gates[i + 1]?.hit) && 'join'].filter(Boolean).join(' ')}">${g.hit ? `<span class="dot" aria-hidden="true"></span><span class="vh">${g.home ? 'listed here' : 'mentioned'}</span>` : '<span class="vh">no</span>'}</td>`).join('')}</tr>`).join('');
  return `<div class="ribbon-wrap"><table class="ribbon"><caption class="vh">Which specs touch which gate</caption><thead><tr><th scope="col">Spec or protocol</th>${GATES.map((g) => `<th scope="col" class="c-${g.key}">${g.n} ${esc(SHORT[g.cat])}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

function tapeHTML() {
  const months = [];
  const asc = [...events].sort((a, b) => a.date.localeCompare(b.date));
  let [y, m] = asc[0].date.split('-').map(Number);
  const [ly, lm] = asc.at(-1).date.split('-').map(Number);
  while (y < ly || (y === ly && m <= lm)) { months.push(`${y}-${String(m).padStart(2, '0')}`); m++; if (m > 12) { m = 1; y++; } }
  return `<ol class="tape">${months.map((mo) => {
    const evs = asc.filter((e) => e.date.startsWith(mo));
    const [yy, mm] = mo.split('-').map(Number);
    return `<li class="month${evs.length ? '' : ' quiet'}"><p class="mo">${MON[mm - 1]} ${yy}</p>${evs.length ? `<ol>${evs.map((ev) => {
      const mg = mergeFor(ev);
      return `<li class="ev c-${EVENT_KEY[ev.type]}"><p class="ev-d"><span class="ev-type">${EVENT_LABEL[ev.type]}</span> ${esc(fmtDate(ev.date))}</p>${mg ? `<p class="merge-static"><span class="from">${esc(mg.fromFull)}</span> is now part of <span class="to">${esc(mg.to)}</span></p>` : ''}<p class="ev-t"><a href="${esc(ev.source_url)}" rel="noopener">${esc(ev.title)}</a></p></li>`;
    }).join('')}</ol>` : '<p class="none">No dated events</p>'}</li>`;
  }).join('')}</ol>`;
}

function weeksHTML() {
  const DAY = 864e5;
  const end = Date.parse(generated + 'T12:00:00Z');
  const asc = [...events].sort((a, b) => a.date.localeCompare(b.date));
  const start = Date.parse(asc[0].date + 'T12:00:00Z');
  const nWeeks = Math.floor((end - start) / (7 * DAY)) + 1;
  const weeks = Array.from({ length: nWeeks }, () => []);
  for (const ev of asc) weeks[nWeeks - 1 - Math.floor((end - Date.parse(ev.date + 'T12:00:00Z')) / (7 * DAY))].push(ev);
  return { nWeeks, html: `<ol class="weeks" aria-hidden="true">${weeks.map((w) => `<li>${w.map((ev) => `<span class="sq c-${EVENT_KEY[ev.type]}"></span>`).join('')}</li>`).join('')}</ol>` };
}

// ---------- the hero: "The Request" ----------
const stampText = (g) => g.ex.map(([id, l]) => l).join(' / ');
function heroGate(g) {
  const list = sortEntries(entries.filter((e) => e.category === g.cat));
  return `<li class="g c-${g.key}" data-g="${g.n}">
<div class="g-head"><span class="g-n" aria-hidden="true">${g.n}</span><img class="g-emblem" src="img/emblem-${({ identity: 'identity', 'auth/permissions': 'permissions', 'payments/commerce': 'payments', verification: 'verification' })[g.cat]}.webp" width="48" height="50" alt="" decoding="async"><h2 class="g-q">${esc(g.q)}</h2><span class="g-count"><b>${list.length}</b> <span>${esc(SHORT[g.cat].toLowerCase())}</span></span></div>
<ul class="g-dots" aria-hidden="true">${list.map(() => '<li></li>').join('')}</ul>
<div class="g-more"><div class="g-inner">
<p class="g-carry">The request now carries ${esc(g.carries)}, for example ${g.ex.map(([id, l]) => `<a href="#e-${id}">${esc(l)}</a>`).join(' or ')}.</p>
<ul class="g-names">${list.map((e, i) => `<li style="--i:${i}"><a href="#e-${esc(e.id)}">${esc(e.name.replace(/ \(now part of .+\)$/, ''))}</a></li>`).join('')}</ul>
</div></div></li>`;
}
const dealEvents = events.filter((e) => e.type === 'deal');
const mergeRows = dealEvents.map((ev) => ({ ev, mg: mergeFor(ev) })).filter((x) => x.mg);
const pending = dealEvents.filter((ev) => !mergeFor(ev) && /acquire/i.test(ev.title));
const heroDeals = `<li class="g g-deal" data-g="5">
<div class="g-head"><span class="g-n" aria-hidden="true">5</span><img class="g-emblem" src="img/emblem-deals.webp" width="48" height="50" alt="" decoding="async"><h2 class="g-q">Who buys whom?</h2><span class="g-count"><b>${mergeRows.length}</b> <span>closed</span></span></div>
<ul class="g-dots" aria-hidden="true">${mergeRows.map(() => '<li></li>').join('')}</ul>
<div class="g-more"><div class="g-inner">
<p class="g-carry">Big platforms are buying the companies that check agents. Each line links its source.</p>
<ol class="merges">${mergeRows.map(({ ev, mg }, i) => `<li style="--i:${i}"><span class="m-pair"><span class="m-from">${esc(mg.from)}</span><span class="m-to">${esc(mg.to)}</span></span><a class="m-src" href="${esc(ev.source_url)}" rel="noopener">${esc(fmtDate(ev.date))}<span class="vh">: ${esc(ev.title)}</span></a></li>`).join('')}
${pending.map((ev) => `<li class="pending"><span class="m-pair"><span class="m-from">${esc(ev.title.match(/acquire (\w+)/i)?.[1] || '')}</span><span class="m-to">${esc(ev.title.split(' ')[0])}</span></span><a class="m-src" href="${esc(ev.source_url)}" rel="noopener">Announced ${esc(fmtDate(ev.date))}, not closed<span class="vh">: ${esc(ev.title)}</span></a></li>`).join('')}</ol>
</div></div></li>`;

const weekCut = new Date(Date.parse(generated + 'T12:00:00Z') - 7 * 864e5).toISOString().slice(0, 10);
const thisWeek = events.filter((e) => e.date >= weekCut);
const W = weeksHTML();
const catCounts = Object.keys(CAT_LABEL).map((c) => [c, entries.filter((e) => e.category === c).length]);
const osCount = entries.filter((e) => e.open_source === true).length;
// Entries whose own name or self-description uses the phrase. Salesforce is shown separately.
const trustLayerSelf = entries.filter((e) => e.id !== 'salesforce-einstein-trust-layer' && (/trust layer/i.test(e.name) || /describ\w* itself as [^.]*trust layer/i.test(e.description)));

const desc = `A sourced, dated map of ${entries.length} standards, products, open-source projects and deals for AI agent identity, permissions, payments and verification. Every entry links its source.`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Agent Trust Layer: how an AI agent gets trusted, gate by gate</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:title" content="Agent Trust Layer: how an AI agent gets trusted">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${esc(BASE)}">
<meta property="og:image" content="${esc(BASE)}og.jpg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="A large ornate brass key lying across a compass rose over a faint chart grid with dotted routes and beacon points.">
<link rel="preload" as="image" href="img/hero.webp" imagesrcset="img/hero-800.webp 800w, img/hero.webp 1280w, img/hero-1920.webp 1920w" imagesizes="100vw">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#1f2bd1">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' rx='3' fill='%231f2bd1'/%3E%3Crect x='4' y='6' width='8' height='4' rx='2' fill='%23d7ff3c'/%3E%3C/svg%3E">
<link rel="preload" href="fonts/bricolage.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="fonts/atkinson-regular.woff2" as="font" type="font/woff2" crossorigin>
<link rel="alternate" type="application/json" href="data/entries.json" title="Map entries">
<link rel="stylesheet" href="style.css">
<script>document.documentElement.classList.add('js');</script>
</head>
<body>
<a class="skip" href="#map">Skip to the full map</a>
<header class="hero">
<nav class="wrap bar" aria-label="Sections"><a class="brand" href="./">Agent Trust Layer</a><span class="navlinks"><a href="#map">Map</a><a href="#deals">Deals</a><a href="#about">About</a></span></nav>
<div class="intro">
<img class="intro-art" src="img/hero.webp" srcset="img/hero-800.webp 800w, img/hero.webp 1280w, img/hero-1920.webp 1920w" sizes="100vw" width="1280" height="714" alt="Antique star-and-sea chart with islands of contour lines, brass keys, wax seals and lighthouses linked by dotted and gold routes, an armillary sphere and compass rose at right." fetchpriority="high" decoding="async">
<div class="wrap intro-copy">
<h1>How an AI agent gets trusted</h1>
<p class="dek">${entries.length} standards, products and deals, sorted by the four checks an agent's request meets. Every name links its source.</p>
<p class="hero-cta"><button type="button" class="cardbtn js-card" data-scope="all">Save the map as an image</button></p>
</div>
</div>
<section class="request" id="request" aria-label="One agent request, gate by gate">
<div class="stage" id="stage" data-step="all">
<div class="wrap stage-in">
<div class="ticket" aria-hidden="true">
<p class="t-h"><span class="t-chip">Request</span> <span class="t-path">agent → shop.example</span></p>
<ol class="stamps">${GATES.map((g) => `<li class="c-${g.key}" data-g="${g.n}"><img class="s-seal" src="img/seal-${SEAL[g.key]}.webp" width="144" height="144" alt="" decoding="async"><span class="s-k">${esc(g.line)}</span><span class="s-v">${esc(stampText(g))}</span></li>`).join('')}</ol>
<p class="t-note">Illustration. Real requests use different header names.</p>
</div>
<ol class="track">
${GATES.map(heroGate).join('\n')}
${heroDeals}
</ol>
<div class="meter" aria-hidden="true"><span></span></div>
</div>
</div>
<div class="steps" aria-hidden="true">${[1, 2, 3, 4, 5].map((n) => `<div class="step" data-step="${n}"></div>`).join('')}</div>
</section>
</header>

<div class="map-banner-wrap">
<img class="map-banner" src="img/banner.webp" srcset="img/banner-800.webp 800w, img/banner.webp 1280w, img/banner-1600.webp 1584w" sizes="100vw" width="1280" height="364" alt="A ribbon of dotted sea routes winding past tiny lighthouses, brass keys and anchor wax seals on cream vellum." loading="lazy" decoding="async">
</div>

<main id="map">
<section class="wrap week" aria-labelledby="week-h">
<div class="week-grid">
<div>
<h2 id="week-h">This week</h2>
<p class="lede">Dated events in the 7 days to ${esc(fmtDate(generated))}.</p>
<ul class="week-list">${thisWeek.map((ev) => `<li class="c-${EVENT_KEY[ev.type]}"><span class="wd">${esc(fmtDate(ev.date).replace(/, \d{4}$/, ''))}</span><a href="${esc(ev.source_url)}" rel="noopener">${esc(ev.title)}</a></li>`).join('')}</ul>
</div>
<figure class="pace">
${W.html}
<figcaption><b>${events.length} dated events in ${W.nWeeks} weeks.</b> One square per event, one column per week, oldest on the left. <span class="legend"><span class="sq c-std"></span>Standard <span class="sq c-deal"></span>Deal <span class="sq c-prod"></span>Product</span></figcaption>
</figure>
</div>
</section>

<div class="wrap full-h"><h2>The full map</h2><p class="lede">${entries.length} entries. ${osCount} are open source. Inside each gate, the order is by date, newest first.</p></div>
<form class="wrap tools" role="search" aria-label="Filter the map" onsubmit="return false">
<div class="search"><label for="q">Search the map</label><input id="q" name="q" type="search" autocomplete="off" placeholder="Try x402, Okta, receipts"></div>
<fieldset class="chips"><legend>Category</legend>
<label class="chip on"><input type="radio" name="cat" value="" checked> All</label>
${catCounts.map(([c, n]) => `<label class="chip c-${CAT_KEY[c]}"><input type="radio" name="cat" value="${esc(c)}"> ${esc(CAT_LABEL[c])} <span class="n">${n}</span></label>`).join('\n')}
</fieldset>
<div class="toggles">
<label class="tog"><input type="checkbox" name="os" value="1"> Open source only</label>
<label class="tog"><input type="checkbox" name="recent" value="1"> Dated in the last 30 days</label>
</div>
<p class="status"><span id="status" aria-live="polite">Showing all ${entries.length} entries.</span> <button type="button" class="linkbtn" id="share">Copy link to this view</button> <button type="button" class="linkbtn js-card" data-scope="view">Save this view as an image</button> <button type="button" class="linkbtn js-clear" hidden>Clear filters</button></p>
<div class="none-all" id="none-all" hidden><img class="empty-chart" src="img/empty-chart-440.webp" srcset="img/empty-chart-440.webp 440w, img/empty-chart-1024.webp 1024w" sizes="(min-width: 700px) 160px, 30vw" width="1024" height="1024" alt="A small compass at rest on a cream chart, with a dotted course and no compass letters." decoding="async"><p>Nothing matches <b id="none-q"></b>. Check the spelling or <button type="button" class="linkbtn js-clear">clear filters</button>.</p></div>
</form>

<div class="wrap gates">
${GATES.map(gateHTML).join('\n')}
</div>

<section class="wrap block" id="specs" aria-labelledby="specs-h">
<h2 id="specs-h"><img class="sec-emblem" src="img/emblem-standards.webp" width="48" height="50" alt="" decoding="async"> The specs underneath</h2>
<p class="lede">Standards and protocols often reach past one gate. A filled dot marks the gate where the map lists the spec. A ring marks another gate that the spec's own one-line description names, by words such as "identity", "authorization", "payments" or "verify". The rule is mechanical, so read each spec before you rely on it.</p>
${ribbonHTML()}
<div class="std-list c-std" data-gate="std"><h3>Cross-gate standards (${entries.filter((e) => e.category === 'standards').length})</h3><p class="count"><span class="shown"></span></p>${listHTML(entries.filter((e) => e.category === 'standards'))}${emptyHTML}</div>
</section>

<section class="wrap block" id="deals" aria-labelledby="deals-h">
<h2 id="deals-h"><img class="sec-emblem" src="img/emblem-deals.webp" width="48" height="50" alt="" decoding="async"> The deal tape</h2>
<p class="lede">Every dated event in the map, by month. Months with no event stay on the tape, so the gaps are real.</p>
${tapeHTML()}
<div class="std-list c-deal" data-gate="deal"><h3>Deals in the map (${entries.filter((e) => e.category === 'deals').length})</h3><p class="count"><span class="shown"></span></p>${listHTML(entries.filter((e) => e.category === 'deals'))}${emptyHTML}</div>
</section>

<section class="wrap block about" id="about" aria-labelledby="about-h">
<h2 id="about-h">How to read this map</h2>
<div class="cols">
<div>
<h3>What each label means</h3>
<dl class="labels">
<dt>Primary source</dt><dd>The standards body, project or company that did the thing published it.</dd>
<dt>Secondary source</dt><dd>A news site or other third party reported it.</dd>
<dt>Vendor's own claim, or reported by the vendor</dt><dd>The company describes itself. Nobody else checked it.</dd>
<dt>GitHub repo data</dt><dd>License, stars and last push come from the GitHub API. For these entries the date is the last push, in UTC, so it can read one day after the check date. Stars are a count, not a score.</dd>
<dt>Date not captured</dt><dd>The source had no date we could confirm.</dd>
</dl>
</div>
<div>
<h3>What this map is not</h3>
<p>It does not rank, rate, certify or recommend anything. Nobody paid to be listed. Leads that could not be confirmed from a source are left out.</p>
<h3>About the phrase "trust layer"</h3>
<p>Several vendors and projects describe themselves this way, for example ${trustLayerSelf.map((e) => `<a href="#e-${esc(e.id)}">${esc(e.name)}</a>`).join(', ')}. Salesforce uses <a href="#e-salesforce-einstein-trust-layer">Einstein Trust Layer</a> for something else. It means protecting data sent to language models. This site is not connected to any of them.</p>
<h3>Read the data yourself</h3>
<p>The map is built from two files, <a href="data/entries.json">entries.json</a> and <a href="data/changelog.json">changelog.json</a>. Agents can start at <a href="llms.txt">llms.txt</a>.</p>
</div>
</div>
</section>
</main>

<footer class="foot"><div class="wrap">
<p>Data last checked ${esc(fmtDate(generated))} (US Central time). Found a mistake? Every entry links its source so you can check it.</p>
<p class="sale"><a href="https://www.afternic.com/domain/agenttrustlayer.com" rel="noopener">This domain is available.</a></p>
</div></footer>
<script type="application/json" id="card-data">${JSON.stringify({ total: entries.length, checked: fmtDate(generated), gates: GATES.map((g) => ({ n: g.n, cat: g.cat, line: g.line, short: SHORT[g.cat], seal: SEAL[g.key], key: g.key, count: entries.filter((e) => e.category === g.cat).length })), cats: CAT_LABEL, merges: mergeRows.map(({ ev, mg }) => ({ from: mg.from, to: mg.to, date: fmtDate(ev.date) })), pending: pending.map((ev) => ({ from: ev.title.match(/acquire (\w+)/i)?.[1] || '', to: ev.title.split(' ')[0], date: fmtDate(ev.date) })) }).replace(/</g, '\\u003c')}</script>
<script src="app.js" defer></script>
</body>
</html>
`;

mkdirSync(join(OUT, 'data'), { recursive: true });
mkdirSync(join(OUT, 'fonts'), { recursive: true });
writeFileSync(join(OUT, 'index.html'), html);
for (const f of ['style.css', 'app.js']) copyFileSync(join(here, 'src', f), join(OUT, f));
mkdirSync(join(OUT, 'img'), { recursive: true });
for (const f of readdirSync(join(here, 'src', 'img'))) copyFileSync(join(here, 'src', 'img', f), join(OUT, 'img', f));
copyFileSync(join(here, 'src', 'img', 'og.jpg'), join(OUT, 'og.jpg'));
for (const f of readdirSync(join(here, 'src', 'fonts'))) copyFileSync(join(here, 'src', 'fonts', f), join(OUT, 'fonts', f));
writeFileSync(join(OUT, 'data', 'entries.json'), JSON.stringify(entriesDoc, null, 2) + '\n');
// Publish the changelog without the unverified leads.
const { unverified_leads_not_published, ...publicLog } = changelogDoc;
writeFileSync(join(OUT, 'data', 'changelog.json'), JSON.stringify(publicLog, null, 2) + '\n');
writeFileSync(join(OUT, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
writeFileSync(join(OUT, '.nojekyll'), '');
writeFileSync(join(OUT, 'llms.txt'), `# Agent Trust Layer: a living map

> ${desc} Data last checked ${generated} (America/Chicago). Preview build, not indexed.

The map groups entries by four questions an AI agent request meets: who are you (identity), what may you do (auth/permissions), can you pay (payments/commerce), can we prove what you did (verification). Standards and deals are listed separately. Nothing is ranked or recommended.

## Data
- [entries.json](${BASE}data/entries.json): ${entries.length} entries. Fields: id, name, category, kind, description, url, source_url, source_date (null = not captured), source_date_precision, open_source (null = unknown), verification, last_checked, note.
- [changelog.json](${BASE}data/changelog.json): ${events.length} dated events with source links.

## Entries by category
${catCounts.map(([c, n]) => `- ${c}: ${n}`).join('\n')}
`);
console.log(`built ${OUT}: ${entries.length} entries, ${events.length} events, ${specs.length} specs, ${mergeRows.length} merges, ${pending.length} pending, ${thisWeek.length} this week`);
