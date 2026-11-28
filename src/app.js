// Filters, search, shareable state. The page works without this file.
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const form = $('.tools');
  const q = $('#q');
  const entries = $$('li.entry');
  const groups = $$('.gate, .std-list');
  const total = entries.length;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const DAY = 864e5;

  // ---- public URL (share links) ----
  // Switch to the custom domain at go-live.
  const CANONICAL = 'https://agenttrustlayer.com/';
  const isLocalPage = () => location.protocol === 'file:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  const publicPage = () => (isLocalPage() ? CANONICAL : `${location.origin}${location.pathname}`).replace(/index\.html$/, '').replace(/\/?$/, '/');
  const publicLink = (suffix) => `${publicPage().replace(/\/$/, '/')}${String(suffix || '').replace(/^\//, '')}`;

  // ---- state <-> URL ----
  const readURL = () => {
    const p = new URLSearchParams(location.search);
    return { q: p.get('q') || '', cat: p.get('cat') || '', os: p.get('os') === '1', recent: p.get('recent') === '1', week: p.get('week') === '1' };
  };
  const readForm = () => ({ q: q.value.trim(), cat: form.cat.value, os: form.os.checked, recent: form.recent.checked, week: form.week.checked });
  const writeForm = (s) => {
    q.value = s.q;
    const r = $$('input[name=cat]').find((i) => i.value === s.cat) || $('input[name=cat][value=""]');
    r.checked = true;
    form.os.checked = s.os;
    form.recent.checked = s.recent;
    form.week.checked = s.week;
  };
  const toQuery = (s) => {
    const p = new URLSearchParams();
    if (s.q) p.set('q', s.q);
    if (s.cat) p.set('cat', s.cat);
    if (s.os) p.set('os', '1');
    if (s.recent) p.set('recent', '1');
    if (s.week) p.set('week', '1');
    const str = p.toString();
    return str ? '?' + str : '';
  };

  // ---- long lists: show the first few, the rest behind a button ----
  // A list is open when the visitor opened it, or when any filter is on (so a match is never hidden).
  const lists = $$('[data-cap]');
  const moreBtn = (ol) => $(`button.more[aria-controls="${ol.id}"]`);
  function syncList(ol, filtered) {
    const btn = moreBtn(ol);
    const plain = ol.dataset.plain === '1';   // the spec table and the month tape take no filter
    const open = (!plain && filtered) || ol.dataset.user === '1';
    ol.classList.toggle('open', open);
    if (!btn) return;
    const matches = plain ? Infinity : $$('li.entry', ol).filter((li) => !li.hidden).length;
    btn.parentElement.hidden = (!plain && filtered) || matches <= +ol.dataset.cap;
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    btn.textContent = open ? 'Show fewer' : `Show ${btn.dataset.n} ${btn.dataset.noun}`;
  }
  document.addEventListener('click', (ev) => {
    const b = ev.target.closest('button.more');
    if (!b) return;
    const ol = document.getElementById(b.getAttribute('aria-controls'));
    ol.dataset.user = ol.dataset.user === '1' ? '0' : '1';
    syncList(ol, false);
  });
  const openList = (li) => { const ol = li.closest('ol[data-cap]:not([data-plain])'); if (ol && ol.dataset.user !== '1') { ol.dataset.user = '1'; syncList(ol, readFilteredState()); } };
  const readFilteredState = () => { const f = readForm(); return !!(f.q || f.cat || f.os || f.recent || f.week); };

  // ---- filtering ----
  const today = Date.now();
  function apply(s, push = true) {
    $$('.chip').forEach((c) => c.classList.toggle('on', c.querySelector('input').checked));
    const words = s.q.toLowerCase().split(/\s+/).filter(Boolean);
    let shown = 0;
    for (const li of entries) {
      const d = li.dataset.day ? Date.parse(li.dataset.day + 'T12:00:00Z') : NaN;
      const ok = (!s.cat || li.dataset.cat === s.cat)
        && (!s.os || li.dataset.os === '1')
        && (!s.recent || (d && today - d <= 30 * DAY))
        && (!s.week || (d && today - d <= 7 * DAY))
        && words.every((w) => li.dataset.text.includes(w));
      li.hidden = !ok;
      if (ok) shown++;
    }
    for (const g of groups) {
      const all = $$('li.entry', g);
      const vis = all.filter((li) => !li.hidden).length;
      const c = $('.count .shown', g);
      const filteredNow = vis !== all.length;
      if (c) c.textContent = g.classList.contains('std-list') ? (filteredNow ? `${vis} of ${all.length} shown` : '') : vis;
      const cn = $('.count', g);
      if (cn && !g.classList.contains('std-list')) cn.innerHTML = `<span class="shown">${vis}</span> ${filteredNow ? `of ${all.length} match` : 'entries'}`;
      $('.empty', g).hidden = vis > 0;
      g.classList.toggle('dim', vis === 0);
    }
    const filtered = s.q || s.cat || s.os || s.recent || s.week;
    lists.forEach((ol) => syncList(ol, !!filtered));
    $('#status').textContent = filtered ? `Showing ${shown} of ${total} entries.` : `Showing all ${total} entries.`;
    $$('.tools .js-clear').forEach((b) => (b.hidden = !filtered));
    const none = $('#none-all');
    none.hidden = shown > 0;
    $('#none-q').textContent = s.q ? `"${s.q}"` : 'these filters';
    if (push) history.replaceState(null, '', location.pathname + toQuery(s) + location.hash);
  }

  form.addEventListener('input', () => apply(readForm()));
  form.addEventListener('change', () => apply(readForm()));
  document.addEventListener('click', (ev) => {
    const t = ev.target.closest('.js-clear');
    if (!t) return;
    const s = { q: '', cat: '', os: false, recent: false, week: false };
    writeForm(s);
    apply(s);
    q.focus();
  });

  // ---- sharing ----
  async function copy(url, btn, done) {
    const old = btn.textContent;
    try { await navigator.clipboard.writeText(url); btn.textContent = done; }
    catch { prompt('Copy this link:', url); }
    setTimeout(() => (btn.textContent = old), 1800);
  }
  $('#share').addEventListener('click', (ev) => copy(publicLink(toQuery(readForm())), ev.currentTarget, 'Link copied'));

  // ---- share card: a 1080x1350 PNG of the map, or of the current view ----
  const CD = JSON.parse($('#card-data').textContent);
  const loadImg = (src) => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });
  function lines(g, text, maxW, maxLines) {
    const words = String(text).split(/\s+/).filter(Boolean), out = [];
    let cur = '';
    for (const w of words) {
      const t = cur ? cur + ' ' + w : w;
      if (g.measureText(t).width <= maxW || !cur) cur = t; else { out.push(cur); cur = w; }
    }
    if (cur) out.push(cur);
    if (out.length > maxLines) { out.length = maxLines; let l = out[maxLines - 1]; while (l && g.measureText(l + '…').width > maxW) l = l.slice(0, -1); out[maxLines - 1] = l.replace(/\s+$/, '') + '…'; }
    return out;
  }
  const fit = (g, text, maxW) => { let t = String(text); if (g.measureText(t).width <= maxW) return t; while (t && g.measureText(t + '…').width > maxW) t = t.slice(0, -1); return t + '…'; };
  function viewOf(s) {
    const shown = entries.filter((li) => !li.hidden);
    const filtered = !!(s.q || s.cat || s.os || s.recent || s.week);
    if (!filtered || !shown.length) return { all: true, shown: entries, s: { q: '', cat: '', os: false, recent: false, week: false } };
    return { all: false, shown, s };
  }
  async function drawCard(scope) {
    const s0 = readForm();
    const v = scope === 'all' ? { all: true, shown: entries, s: { q: '', cat: '', os: false, recent: false, week: false } } : viewOf(s0);
    const W = 1080, H = 1350, c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    try { await Promise.all([document.fonts.load('800 80px Bricolage'), document.fonts.load('400 30px Atkinson'), document.fonts.load('700 30px Atkinson')]); } catch { /* fallback fonts */ }
    const seals = await Promise.all(CD.gates.map((x) => loadImg(`img/seal-${x.seal}.webp`).catch(() => null)));
    const D = 'Bricolage, "Arial Narrow", Arial, sans-serif', T = 'Atkinson, Arial, sans-serif';
    const HUE = { id: '#d7ff3c', auth: '#5cf2c0', pay: '#ffc23d', ver: '#ff9cc0' };
    const INK = { id: '#4b6400', auth: '#00735a', pay: '#8a5700', ver: '#b0245e' };
    g.fillStyle = '#1f2bd1'; g.fillRect(0, 0, W, H);
    // brand row
    g.fillStyle = '#d7ff3c'; g.beginPath(); g.roundRect(72, 76, 56, 26, 13); g.fill();
    g.fillStyle = '#ffffff'; g.font = `800 34px ${D}`; g.textBaseline = 'alphabetic'; g.fillText('Agent Trust Layer', 146, 100);
    g.fillStyle = '#dfe3ff'; g.font = `400 26px ${T}`; g.textAlign = 'right'; g.fillText(`Checked ${CD.checked}`, W - 72, 99); g.textAlign = 'left';
    // headline
    const sh = v.s;
    let head, sub;
    if (v.all) { head = 'How an AI agent gets trusted'; sub = `${CD.total} standards, products and deals, sorted by the four checks an agent's request meets.`; }
    else {
      const bits = [];
      if (sh.q) bits.push(`“${sh.q.length > 26 ? sh.q.slice(0, 25) + '…' : sh.q}”`);
      if (sh.cat) bits.push((CD.gates.find((x) => x.cat === sh.cat) || {}).short || CD.cats[sh.cat] || sh.cat);
      head = `${bits.length ? bits.join(' in ') : 'This view'} on the agent trust map`;
      const extra = [sh.os && 'open source only', sh.recent && 'dated in the last 30 days', sh.week && 'dated in the last 7 days'].filter(Boolean).join(', ');
      sub = `${v.shown.length} of ${CD.total} entries match${extra ? ` (${extra})` : ''}.`;
    }
    g.fillStyle = '#ffffff'; g.font = `800 96px ${D}`;
    const hl = lines(g, head, W - 144, 3);
    let y = 238;
    for (const l of hl) { g.fillText(l, 72, y); y += 96; }
    g.fillStyle = '#dfe3ff'; g.font = `400 34px ${T}`;
    y += 6;
    for (const l of lines(g, sub, W - 144, 2)) { g.fillText(l, 72, y); y += 46; }
    // the ticket: four checks, with counts for this view
    const ty = Math.max(y + 22, 520), th = 300;
    g.fillStyle = '#f4ecd8'; g.beginPath(); g.roundRect(56, ty, W - 112, th, 20); g.fill();
    g.strokeStyle = '#b9a77e'; g.setLineDash([6, 8]); g.lineWidth = 2; g.beginPath(); g.roundRect(72, ty + 16, W - 144, th - 32, 14); g.stroke(); g.setLineDash([]);
    g.fillStyle = '#0e1116'; g.beginPath(); g.roundRect(100, ty + 36, 128, 40, 8); g.fill();
    g.fillStyle = '#d7ff3c'; g.font = `700 24px ${T}`; g.fillText('Request', 120, ty + 64);
    g.fillStyle = '#3d4651'; g.font = `400 24px ${T}`; g.fillText('agent → shop.example  ·  four checks', 246, ty + 64);
    const colW = (W - 200) / 4;
    CD.gates.forEach((x, i) => {
      const cx = 100 + colW * i + colW / 2;
      const n = v.shown.filter((li) => li.dataset.cat === x.cat).length;
      if (seals[i]) { g.globalAlpha = n ? 1 : 0.35; g.drawImage(seals[i], cx - 52, ty + 92, 104, 104); g.globalAlpha = 1; }
      g.textAlign = 'center';
      g.fillStyle = INK[x.key]; g.font = `800 44px ${D}`; g.fillText(String(n), cx, ty + 238);
      g.fillStyle = '#0e1116'; g.font = `700 24px ${T}`; g.fillText(`${x.n}. ${x.short}`, cx, ty + 270);
      g.textAlign = 'left';
    });
    // bottom list
    let ly = ty + th + 70;
    g.fillStyle = '#d7ff3c'; g.font = `700 26px ${T}`;
    if (v.all) {
      g.fillText('WHO BUYS WHOM', 72, ly); ly += 54;
      const rows = [...CD.merges.map((m) => [m.from, m.to, m.date]), ...CD.pending.map((m) => [m.from, m.to, `${m.date}, announced, not closed`])].slice(0, 4);
      for (const [a, b, d] of rows) {
        g.fillStyle = '#ffffff'; g.font = `800 40px ${D}`; const t = `${a} → ${b}`; g.fillText(t, 72, ly);
        const tw = g.measureText(t).width;
        g.fillStyle = '#dfe3ff'; g.font = `400 26px ${T}`; g.fillText(fit(g, d, W - 144 - tw - 24), 72 + tw + 24, ly);
        ly += 58;
      }
    } else {
      g.fillText('ON THE MAP', 72, ly); ly += 54;
      const label = (cat) => (CD.gates.find((x) => x.cat === cat) || {}).short || CD.cats[cat] || cat;
      const room = Math.floor((H - 176 - ly) / 54) + 1;
      const rows = v.shown.slice(0, v.shown.length > room ? Math.max(1, room - 1) : room);
      for (const li of rows) {
        const nm = $('.e-name', li).textContent, meta = `${label(li.dataset.cat)} · ${$('.when', li).textContent.replace(/^Dated /, '')}`;
        g.fillStyle = '#ffffff'; g.font = `800 36px ${D}`; const t = fit(g, nm, 640); g.fillText(t, 72, ly);
        const tw = g.measureText(t).width;
        g.fillStyle = '#dfe3ff'; g.font = `400 24px ${T}`; g.fillText(fit(g, meta, W - 144 - tw - 24), 72 + tw + 24, ly);
        ly += 54;
      }
      if (v.shown.length > rows.length) { g.fillStyle = '#dfe3ff'; g.font = `400 26px ${T}`; g.fillText(`+${v.shown.length - rows.length} more`, 72, ly); }
    }
    // footer: honest, and where every source is
    g.fillStyle = '#1824b4'; g.fillRect(0, H - 150, W, 150);
    g.fillStyle = '#dfe3ff'; g.font = `400 26px ${T}`;
    g.fillText('Not a ranking. Every entry links its source at', 72, H - 92);
    const url = publicLink(v.all ? '' : toQuery(v.s)).replace(/^https?:\/\//, '').replace(/%2F/gi, '/');
    g.fillStyle = '#d7ff3c'; g.font = `700 28px ${T}`; g.fillText(fit(g, url, W - 144), 72, H - 50);
    return c;
  }
  window.__atlcard = (scope) => drawCard(scope);
  document.addEventListener('click', async (ev) => {
    const b = ev.target.closest('.js-card');
    if (!b) return;
    const old = b.textContent;
    b.disabled = true; b.textContent = 'Drawing…';
    try {
      const c = await drawCard(b.dataset.scope);
      const blob = await new Promise((ok) => c.toBlob(ok, 'image/png'));
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'agent-trust-map.png';
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      b.textContent = 'Saved';
    } catch { b.textContent = 'Could not draw the image'; }
    setTimeout(() => { b.textContent = old; b.disabled = false; }, 1800);
  });

  // ---- open an entry from its link ----
  function openFromHash() {
    const id = decodeURIComponent(location.hash.slice(1));
    if (!id.startsWith('e-')) return;
    const li = document.getElementById(id);
    if (!li) return;
    if (li.hidden) { const s = { q: '', cat: '', os: false, recent: false, week: false }; writeForm(s); apply(s); }
    li.classList.add('seen');
    openList(li);
    $('details', li).open = true;
    $$('.entry.target').forEach((x) => x.classList.remove('target'));
    li.classList.add('target');
    li.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
  }
  window.addEventListener('hashchange', openFromHash);

  // ---- start ----
  lists.filter((l) => l.dataset.plain === '1').forEach((l) => syncList(l, false));
  const s0 = readURL();
  writeForm(s0);
  apply(s0, false);
  if (location.hash) openFromHash();
})();

// Phone: "How to read this map" starts closed unless the link points inside it.
(() => {
  const d = document.getElementById('about-d');
  if (d && !matchMedia('(min-width: 960px)').matches && !/^#(about|e-)/.test(location.hash)) d.open = false;
})();
