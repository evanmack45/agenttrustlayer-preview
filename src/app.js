// Filters, search, shareable state and the scroll story. The page works without this file.
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

  // ---- state <-> URL ----
  const readURL = () => {
    const p = new URLSearchParams(location.search);
    return { q: p.get('q') || '', cat: p.get('cat') || '', os: p.get('os') === '1', recent: p.get('recent') === '1' };
  };
  const readForm = () => ({ q: q.value.trim(), cat: form.cat.value, os: form.os.checked, recent: form.recent.checked });
  const writeForm = (s) => {
    q.value = s.q;
    const r = $$('input[name=cat]').find((i) => i.value === s.cat) || $('input[name=cat][value=""]');
    r.checked = true;
    form.os.checked = s.os;
    form.recent.checked = s.recent;
  };
  const toQuery = (s) => {
    const p = new URLSearchParams();
    if (s.q) p.set('q', s.q);
    if (s.cat) p.set('cat', s.cat);
    if (s.os) p.set('os', '1');
    if (s.recent) p.set('recent', '1');
    const str = p.toString();
    return str ? '?' + str : '';
  };

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
        && words.every((w) => li.dataset.text.includes(w));
      li.hidden = !ok;
      if (ok) shown++;
    }
    for (const g of groups) {
      const all = $$('li.entry', g);
      const vis = all.filter((li) => !li.hidden).length;
      const c = $('.count .shown', g);
      if (c) c.textContent = g.classList.contains('std-list') ? (vis === all.length ? '' : `${vis} of ${all.length} shown`) : vis;
      $('.empty', g).hidden = vis > 0;
      g.classList.toggle('dim', vis === 0);
    }
    const filtered = s.q || s.cat || s.os || s.recent;
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
    const s = { q: '', cat: '', os: false, recent: false };
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
  $('#share').addEventListener('click', (ev) => copy(location.origin + location.pathname + toQuery(readForm()), ev.currentTarget, 'Link copied'));

  // ---- open an entry from its link ----
  function openFromHash() {
    const id = decodeURIComponent(location.hash.slice(1));
    if (!id.startsWith('e-')) return;
    const li = document.getElementById(id);
    if (!li) return;
    if (li.hidden) { const s = { q: '', cat: '', os: false, recent: false }; writeForm(s); apply(s); }
    li.classList.add('seen');
    $('details', li).open = true;
    $$('.entry.target').forEach((x) => x.classList.remove('target'));
    li.classList.add('target');
    li.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
  }
  window.addEventListener('hashchange', openFromHash);

  // ---- the hero story: one request, step by step ----
  const stage = $('#stage');
  const gs = $$('.track .g');
  const stamps = $$('.stamps li');
  function setStep(n) {
    if (stage.dataset.step === String(n)) return;
    stage.dataset.step = n;
    gs.forEach((g) => {
      const k = +g.dataset.g;
      g.classList.toggle('is-active', k === n);
      g.classList.toggle('is-passed', k < n);
    });
    stamps.forEach((s) => {
      const on = +s.dataset.g <= n;
      if (on && !s.classList.contains('on')) { s.classList.add('stamp'); setTimeout(() => s.classList.remove('stamp'), 600); }
      s.classList.toggle('on', on);
    });
  }
  if (!reduce && 'IntersectionObserver' in window) {
    document.documentElement.classList.add('story');
    setStep(1);
    const io = new IntersectionObserver((items) => {
      for (const it of items) if (it.isIntersecting) setStep(+it.target.dataset.step);
    }, { rootMargin: '-50% 0px -50% 0px' });
    $$('.steps .step').forEach((s) => io.observe(s));
    const req = $('#request');
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const r = req.getBoundingClientRect();
        const p = Math.min(1, Math.max(0, -r.top / (r.height - innerHeight)));
        stage.style.setProperty('--p', p.toFixed(3));
        ticking = false;
      });
    };
    addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // ---- start ----
  const s0 = readURL();
  writeForm(s0);
  apply(s0, false);
  if (location.hash) openFromHash();
})();
