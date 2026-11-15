// Web Companion account, sync and repair. Talks to the backend at config.js > apiBase.
(function () {
  const cfg = window.WEB_COMPANION_CONFIG || {};
  const BASE = (cfg.apiBase || '').replace(/\/$/, '');
  const TOKEN = 'wc.token';
  const st = { user: null, reachable: null, pending: false, msg: '', timer: null };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const setMsg = m => { st.msg = m; const el = document.getElementById('syncmsg'); if (el) el.textContent = m; };
  const active = () => (localStorage.getItem('wc.active') || 'p1') === 'p1';
  const clock = () => new Date().toLocaleTimeString();
  const OFFLINE = "Can't reach the server. Changes stay on this device and sync when it's back.";

  function idleMsg() {
    if (!BASE) return 'Accounts are not set up. Your data saves on this device.';
    if (st.reachable === false) return OFFLINE;
    return st.user ? 'Signed in as ' + st.user.email + '.' : 'Sign in to keep your data on every device.';
  }

  // Retries network and server errors with backoff. 4xx answers are final and are not retried.
  async function api(method, path, body, tries = 3) {
    const headers = {};
    const tok = localStorage.getItem(TOKEN);
    if (tok) headers.Authorization = 'Bearer ' + tok;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let last = new Error('Server unavailable.');
    for (let i = 0; i < tries; i++) {
      try {
        const r = await fetch(BASE + path, { method, headers, cache: 'no-store', body: body === undefined ? undefined : JSON.stringify(body) });
        let j = {};
        try { j = await r.json(); } catch (e) {}
        if (r.ok) { st.reachable = true; return j; }
        const err = new Error(j.error || 'Request failed (' + r.status + ').');
        err.status = r.status;
        if (r.status < 500) { st.reachable = true; throw err; }
        last = err;
      } catch (e) {
        if (e.status && e.status < 500) throw e;
        last = e;
      }
      if (i < tries - 1) await new Promise(res => setTimeout(res, 500 * 2 ** i));
    }
    st.reachable = false;
    last.offline = true;
    throw last;
  }

  function fail(e, prefix) {
    if (e.status === 401) { st.user = null; localStorage.removeItem(TOKEN); return setMsg('Your session ended. Sign in again.'); }
    setMsg(e.offline ? OFFLINE : (prefix || 'Sync failed: ') + e.message);
  }

  async function refresh() {
    if (!localStorage.getItem(TOKEN)) return;
    try { st.user = await api('GET', '/api/me', undefined, 2); }
    catch (e) { if (e.status === 401) { st.user = null; localStorage.removeItem(TOKEN); } }
  }

  async function push() {
    await api('PUT', '/api/state', { data: S, updatedAt: S.updatedAt || Date.now() });
    st.pending = false;
  }

  async function syncNow() {
    if (!st.user || !active()) return;
    try {
      const remote = await api('GET', '/api/state');
      if (remote.data && remote.updatedAt > (S.updatedAt || 0)) {
        S = Object.assign(blank(), remote.data, { updatedAt: remote.updatedAt, onboarded: true });
        localStorage.setItem(KEY, JSON.stringify(S));
        st.pending = false;
        setMsg('Loaded your latest data.');
        if (window.render) render();
      } else {
        await push();
        setMsg('Synced ' + clock() + '.');
      }
    } catch (e) { fail(e); }
  }

  // Changes are queued while offline and sent when the server is reachable again.
  function schedule() {
    if (!st.user || !active()) return;
    st.pending = true;
    clearTimeout(st.timer);
    st.timer = setTimeout(flush, 1500);
  }
  async function flush() {
    if (!st.pending || !st.user) return;
    try { await push(); setMsg('Synced ' + clock() + '.'); }
    catch (e) { fail(e); }
  }
  setInterval(flush, 30000);
  window.addEventListener('online', flush);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && st.user) syncNow(); });

  // Repair: fixes unreadable saved data using the backup kept by the last good save.
  function repairLocal() {
    const report = [];
    const valid = raw => { if (raw === null) return false; try { const v = JSON.parse(raw); return !!v && typeof v === 'object'; } catch (e) { return false; } };
    if (!valid(localStorage.getItem(PKEY)) && localStorage.getItem(PKEY) !== null) {
      localStorage.setItem(PKEY, JSON.stringify([{ id: 'p1', name: 'Me', avatar: '\u{1F33F}' }]));
      report.push('rebuilt the profile list');
    }
    [...new Set([KEY, ...profiles.map(p => keyOf(p.id))])].forEach(k => {
      const raw = localStorage.getItem(k);
      if (raw === null || valid(raw)) return;
      if (valid(localStorage.getItem(k + '.bak'))) { localStorage.setItem(k, localStorage.getItem(k + '.bak')); report.push('restored a profile from its backup'); }
      else { localStorage.removeItem(k); report.push('removed unreadable profile data'); }
    });
    S = load(curId);
    if (report.length) schedule();
    return report.length ? 'Repaired: ' + report.join(', ') + '. Check your data.' : 'No problems found. Your data looks healthy.';
  }

  function removeBanner() { const b = document.getElementById('wc-banner'); if (b) b.remove(); }

  // Self-healing: the first error reloads the page once (repairing data first). Repeats show a Repair banner.
  function showProblem(text) {
    const last = Number(localStorage.getItem('wc.lastRecover') || 0);
    if (Date.now() - last > 60000) {
      localStorage.setItem('wc.lastRecover', String(Date.now()));
      try { repairLocal(); } catch (e) {}
      location.reload();
      return;
    }
    let b = document.getElementById('wc-banner');
    if (!b) {
      b = document.createElement('div');
      b.id = 'wc-banner';
      b.setAttribute('role', 'alert');
      b.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;z-index:99;padding:14px 16px;border-radius:16px;background:#2a1f18;color:#F3EEE6;border:1px solid #B8694F;font:14px Manrope,sans-serif;display:flex;gap:12px;align-items:center';
      b.innerHTML = '<span style="flex:1"></span><button type="button" class="btn" data-sync="repair">Repair</button>';
      document.body.appendChild(b);
    }
    b.firstChild.textContent = text + ' Your data is saved on this device.';
  }
  window.addEventListener('error', () => showProblem('Something went wrong on this page.'));
  window.addEventListener('unhandledrejection', () => showProblem('A background task failed.'));

  window.syncCard = function () {
    let body = '';
    if (!BASE) body = '';
    else if (st.user) body = `<div class="row"><span class="muted" style="flex:1;font-size:13px">${esc(st.user.email)}</span><button type="button" class="btn ghost" data-sync="now">Sync now</button><button type="button" class="btn ghost" data-sync="out">Sign out</button></div>`;
    else body = `<div class="grid2"><label>Email<input id="syncmail" type="email" autocomplete="email"></label><label>Password<input id="syncpw" type="password" autocomplete="current-password" minlength="8"></label></div><div class="row" style="margin-top:12px"><button type="button" class="btn" data-sync="in">Sign in</button><button type="button" class="btn ghost" data-sync="up">Create account</button></div><p class="muted" style="font-size:12px;margin-top:10px">Passwords must be at least 8 characters.</p>`;
    return `<div class="card w6" style="margin-bottom:16px"><h3>Account, sync and repair</h3><p class="muted" id="syncmsg" style="margin:10px 0;font-size:13px">${esc(st.msg || idleMsg())}</p>${body}<div class="row" style="margin-top:14px"><button type="button" class="btn ghost" data-sync="repair">Check and repair local data</button></div></div>`;
  };

  document.addEventListener('click', async e => {
    const b = e.target.closest('[data-sync]');
    if (!b) return;
    const a = b.dataset.sync;
    try {
      if (a === 'in' || a === 'up') {
        const email = document.getElementById('syncmail').value.trim();
        const password = document.getElementById('syncpw').value;
        if (!email || !password) setMsg('Enter your email and password.');
        else {
          const r = await api('POST', a === 'up' ? '/api/signup' : '/api/login', { email, password });
          localStorage.setItem(TOKEN, r.token);
          st.user = { email: r.email };
          setMsg('Signed in as ' + r.email + '.');
          await syncNow();
        }
      } else if (a === 'out') {
        try { await api('POST', '/api/logout', {}); } catch (err) {}
        localStorage.removeItem(TOKEN);
        st.user = null;
        setMsg('Signed out. Your data stays on this device.');
      } else if (a === 'now') {
        await syncNow();
      } else if (a === 'repair') {
        setMsg(repairLocal());
        removeBanner();
      }
    } catch (err) { fail(err, ''); }
    if (window.render) render();
  });

  window.webCompanionSync = { schedule };

  (async function init() {
    if (!BASE) { setMsg(idleMsg()); if (window.render) render(); return; }
    await refresh();
    if (st.user) await syncNow(); else setMsg(idleMsg());
    if (window.render) render();
  })();
})();
