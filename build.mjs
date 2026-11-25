// Build the static map from ../data/*.json into docs/. No dependencies.
// Usage: node build.mjs [--data ../data] [--out docs] [--base https://.../]
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
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
function entryHTML(e) {
  const os = e.open_source === true ? '<span class="tag tag-os">Open source</span>' : e.open_source === false ? '<span class="tag">Not open source</span>' : '';
  const text = [e.name, e.description, e.kind, CAT_LABEL[e.category], e.note || '', verLabel(e.verification)].join(' ').toLowerCase();
  const recentable = e.source_date && e.source_date.length === 10 ? e.source_date : '';
  return `<li class="entry c-${CAT_KEY[e.category]}" id="e-${esc(e.id)}" data-cat="${esc(e.category)}" data-os="${e.open_source === true ? 1 : 0}" data-day="${recentable}" data-text="${esc(text)}">
<details><summary><span class="e-name">${esc(e.name)}</span> <span class="e-kind">${esc(e.kind)}</span></summary>
<div class="e-body"><p>${esc(e.description)}</p>${e.note ? `<p class="e-note"><b>Note.</b> ${esc(e.note)}</p>` : ''}
<p class="e-links">${e.url && e.url !== e.source_url ? `<a href="${esc(e.url)}" rel="noopener">Project page (${esc(host(e.url))})</a> · ` : ''}<a href="#e-${esc(e.id)}" class="permalink" data-id="${esc(e.id)}">Link to this entry</a></p></div></details>
<p class="e-meta"><span class="${e.source_date ? '' : 'nodate'}">${e.source_date ? 'Dated ' : ''}${esc(fmtDate(e.source_date))}</span> · <span>checked ${esc(fmtDate(e.last_checked))}</span> · <a class="src" href="${esc(e.source_url)}" rel="noopener">${esc(verLabel(e.verification))}<span class="vh">, source on ${esc(host(e.source_url))}</span></a>${os ? ' · ' + os : ''}</p></li>`;
}
const listHTML = (list, cls = '') => `<ol class="entries ${cls}">${sortEntries(list).map(entryHTML).join('\n')}</ol>`;
const emptyHTML = `<p class="empty" hidden>No entries here match. <button type="button" class="linkbtn js-clear">Clear filters</button></p>`;

function gateHTML(g) {
  const list = entries.filter((e) => e.category === g.cat);
  return `<section class="gate c-${g.key}" id="gate-${g.n}" data-gate="${g.n}" aria-labelledby="gate-${g.n}-h">
<div class="gate-head"><p class="gate-num" aria-hidden="true">${g.n}</p><div><h2 id="gate-${g.n}-h">${esc(g.q)}</h2>
<p class="gate-sub">${esc(g.plain)}. The request now carries ${esc(g.carries)}. Examples: ${g.ex.map(([id, label]) => `<a href="#e-${id}">${esc(label)}</a>`).join(', ')}.</p>
<p class="count" aria-live="polite"><span class="shown">${list.length}</span> of ${list.length} entries</p></div></div>
${listHTML(list, 'cloud')}${emptyHTML}</section>`;
}

function ribbonHTML() {
  const rows = specs.map(({ e, gates }) => `<tr class="c-${CAT_KEY[e.category]}" data-id="${esc(e.id)}"><th scope="row"><a href="#e-${esc(e.id)}">${esc(e.name)}</a></th>${gates.map((g, i) => `<td class="${[g.hit && 'hit', g.home && 'home', g.hit && (gates[i - 1]?.hit || gates[i + 1]?.hit) && 'join'].filter(Boolean).join(' ')}">${g.hit ? `<span class="dot" aria-hidden="true"></span><span class="vh">${g.home ? 'listed here' : 'mentioned'}</span>` : '<span class="vh">no</span>'}</td>`).join('')}</tr>`).join('');
  return `<div class="ribbon-wrap"><table class="ribbon"><caption class="vh">Which specs touch which gate</caption><thead><tr><th scope="col">Spec or protocol</th>${GATES.map((g) => `<th scope="col" class="c-${g.key}"><span class="gn">${g.n}</span> ${esc(g.plain.split(' ')[0])}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

// Deal tape: one column per month, empty months kept so the gaps are honest.
function tapeHTML() {
  const months = [];
  const asc = [...events].sort((a, b) => a.date.localeCompare(b.date));
  let [y, m] = asc[0].date.split('-').map(Number);
  const [ly, lm] = asc.at(-1).date.split('-').map(Number);
  while (y < ly || (y === ly && m <= lm)) { months.push(`${y}-${String(m).padStart(2, '0')}`); m++; if (m > 12) { m = 1; y++; } }
  const cols = months.map((mo) => {
    const evs = asc.filter((e) => e.date.startsWith(mo));
    const [yy, mm] = mo.split('-').map(Number);
    return `<li class="month${evs.length ? '' : ' quiet'}"><p class="mo">${MON[mm - 1]} ${yy}</p>${evs.length ? `<ol>${evs.map((ev) => {
      const mg = mergeFor(ev);
      return `<li class="ev c-${EVENT_KEY[ev.type]}"><p class="ev-d">${esc(fmtDate(ev.date))} · ${EVENT_LABEL[ev.type]}</p>${mg ? `<p class="merge" aria-label="${esc(mg.fromFull)} joins ${esc(mg.to)}"><span class="from">${esc(mg.fromFull)}</span><span class="arrow" aria-hidden="true">into</span><span class="to">${esc(mg.to)}</span></p>` : ''}<p class="ev-t"><a href="${esc(ev.source_url)}" rel="noopener">${esc(ev.title)}</a></p></li>`;
    }).join('')}</ol>` : '<p class="none">No dated events</p>'}</li>`;
  }).join('');
  return `<ol class="tape" style="--months:${months.length}">${cols}</ol>`;
}

// Week strip: one column per week, one square per dated event.
function weeksHTML() {
  const DAY = 864e5;
  const end = Date.parse(generated + 'T12:00:00Z');
  const asc = [...events].sort((a, b) => a.date.localeCompare(b.date));
  const start = Date.parse(asc[0].date + 'T12:00:00Z');
  const nWeeks = Math.floor((end - start) / (7 * DAY)) + 1;
  const weeks = Array.from({ length: nWeeks }, () => []);
  for (const ev of asc) weeks[nWeeks - 1 - Math.floor((end - Date.parse(ev.date + 'T12:00:00Z')) / (7 * DAY))].push(ev);
  const busy = weeks.filter((w) => w.length).length;
  return { nWeeks, busy, html: `<ol class="weeks" aria-hidden="true">${weeks.map((w) => `<li>${w.map((ev) => `<span class="sq c-${EVENT_KEY[ev.type]}" title="${esc(fmtDate(ev.date) + ': ' + ev.title)}"></span>`).join('')}</li>`).join('')}</ol>` };
}

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
<title>Agent Trust Layer: a living map of AI agent identity, permissions, payments and proof</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:title" content="Agent Trust Layer: a living map">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${esc(BASE)}">
<meta property="og:image" content="${esc(BASE)}og.png">
<meta property="og:image:alt" content="The four gates an AI agent request passes: who are you, what may you do, can you pay, can we prove what you did.">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#0d1321">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' rx='3' fill='%230d1321'/%3E%3Ccircle cx='8' cy='8' r='3' fill='%23ffffff'/%3E%3C/svg%3E">
<link rel="alternate" type="application/json" href="data/entries.json" title="Map entries">
<link rel="stylesheet" href="style.css">
<script>document.documentElement.classList.add('js');</script>
</head>
<body>
<a class="skip" href="#map">Skip to the map</a>
<header class="top">
<nav class="wrap bar" aria-label="Sections"><a class="brand" href="./">Agent Trust Layer</a><span class="navlinks"><a href="#gate-1">Gates</a><a href="#specs">Specs</a><a href="#deals">Deals</a><a href="#about">About</a></span></nav>
<div class="wrap hero">
<div class="hero-text">
<h1>How an AI agent gets trusted, one gate at a time</h1>
<p class="dek">When an AI agent shows up at a website, an API or a checkout, four questions come up. Who are you? What may you do? Can you pay? Can we prove what you did? This map lists the standards, products, open-source projects and deals working on each question. Every entry has a date and a link to its source.</p>
<p class="facts"><b>${entries.length}</b> entries · <b>${osCount}</b> open source · <b>${events.length}</b> dated events · last checked <b>${esc(fmtDate(generated))}</b></p>
</div>
<div class="hero-side">
<div class="pace">
<p class="pace-h"><b>${events.length} dated events in ${W.nWeeks} weeks.</b> Each square is one event. Each column is one week, oldest on the left.</p>
${W.html}
<p class="legend"><span class="sq c-std"></span> Standard <span class="sq c-deal"></span> Deal <span class="sq c-prod"></span> Product</p>
</div>
<div class="week">
<h2 class="small-h">What changed in the 7 days to ${esc(fmtDate(generated))}</h2>
<ul class="week-list">${thisWeek.map((ev) => `<li class="c-${EVENT_KEY[ev.type]}"><span class="wd">${esc(fmtDate(ev.date).replace(/, \d{4}$/, ''))}</span> <a href="${esc(ev.source_url)}" rel="noopener">${esc(ev.title)}</a></li>`).join('')}</ul>
</div>
</div>
</div>
</header>

<main id="map">
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
<p class="status"><span id="status" aria-live="polite">Showing all ${entries.length} entries.</span> <button type="button" class="linkbtn" id="share">Copy link to this view</button> <button type="button" class="linkbtn js-clear" hidden>Clear filters</button></p>
<p class="none-all" id="none-all" hidden>Nothing matches <b id="none-q"></b>. Check the spelling or <button type="button" class="linkbtn js-clear">clear filters</button>.</p>
</form>

<div class="wrap journey">
<aside class="rail" aria-label="The request, gate by gate">
<div class="packet" id="packet">
<p class="pk-h">One agent request</p>
<ol class="pk-lines">
${GATES.map((g) => `<li class="c-${g.key}" data-gate="${g.n}"><span class="pin" aria-hidden="true">${g.n}</span><span class="pk-k">${esc(g.line)}</span><span class="pk-v">${g.ex.map(([, l]) => esc(l)).join(' / ')}</span></li>`).join('')}
</ol>
<p class="pk-now" id="pk-now" aria-hidden="true"></p>
<p class="pk-foot">An illustration, not a real header format. Names are examples from the map.</p>
</div>
</aside>
<div class="gates">
${GATES.map(gateHTML).join('\n')}
</div>
</div>

<section class="wrap block" id="specs" aria-labelledby="specs-h">
<h2 id="specs-h">The specs underneath</h2>
<p class="lede">Standards and protocols often reach past one gate. A filled dot marks the gate where the map lists the spec. A ring marks another gate that the spec's own one-line description names, by words such as "identity", "authorization", "payments" or "verify". The rule is mechanical, so read each spec before you rely on it.</p>
${ribbonHTML()}
<div class="std-list c-std" data-gate="std"><h3>Cross-gate standards (${entries.filter((e) => e.category === 'standards').length})</h3><p class="count"><span class="shown"></span></p>${listHTML(entries.filter((e) => e.category === 'standards'))}${emptyHTML}</div>
</section>

<section class="wrap block" id="deals" aria-labelledby="deals-h">
<h2 id="deals-h">The deal tape</h2>
<p class="lede">Every dated event in the map, by month. Months with no event stay on the tape, so the gaps are real. When a buyer closes an acquisition, the bought company merges into the buyer.</p>
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
<dt>Vendor's own claim / reported by the vendor</dt><dd>The company describes itself. Nobody else checked it.</dd>
<dt>GitHub repo data</dt><dd>License, stars and last push come from the GitHub API. For these entries the date is the last push, in UTC, so it can read one day after the check date. Stars are a count, not a score.</dd>
<dt>Date not captured</dt><dd>The source had no date we could confirm.</dd>
</dl>
</div>
<div>
<h3>What this map is not</h3>
<p>It does not rank, rate, certify or recommend anything. Order inside a gate is newest first. Nobody paid to be listed. Leads that could not be confirmed from a source are left out.</p>
<h3>About the phrase "trust layer"</h3>
<p>Several vendors and projects describe themselves this way, for example ${trustLayerSelf.map((e) => `<a href="#e-${esc(e.id)}">${esc(e.name)}</a>`).join(', ')}. Salesforce uses <a href="#e-salesforce-einstein-trust-layer">Einstein Trust Layer</a> for something else: protecting data sent to language models. This site is not connected to any of them.</p>
<h3>Read the data yourself</h3>
<p>The map is built from two files: <a href="data/entries.json">entries.json</a> and <a href="data/changelog.json">changelog.json</a>. Agents can start at <a href="llms.txt">llms.txt</a>.</p>
</div>
</div>
</section>
</main>

<footer class="foot"><div class="wrap">
<p>Data last checked ${esc(fmtDate(generated))} (US Central time). Found a mistake? Every entry links its source so you can check it.</p>
<p class="sale"><a href="https://www.afternic.com/domain/agenttrustlayer.com" rel="noopener">This domain is available.</a></p>
</div></footer>
<script src="app.js" defer></script>
</body>
</html>
`;

mkdirSync(join(OUT, 'data'), { recursive: true });
writeFileSync(join(OUT, 'index.html'), html);
copyFileSync(join(here, 'src', 'style.css'), join(OUT, 'style.css'));
copyFileSync(join(here, 'src', 'app.js'), join(OUT, 'app.js'));
copyFileSync(join(here, 'src', 'og.png'), join(OUT, 'og.png'));
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
console.log(`built ${OUT}: ${entries.length} entries, ${events.length} events, ${specs.length} specs, ${merges.length} merges, ${thisWeek.length} this week`);
