/*
 * Client Delivery Tracker
 * Plain JavaScript, no build step — works as-is on GitHub Pages or Netlify.
 * Live mode talks to Supabase (see supabase/schema.sql); without keys in
 * config.js it runs a demo that keeps data in this browser only.
 */
(() => {
  'use strict';

  const CFG = window.TRACKER_CONFIG || {};
  const STATUSES = ['Pending', 'In Progress', 'Waiting on Client', 'Done'];
  const STATUS_CLASS = { 'Pending': 'pending', 'In Progress': 'progress', 'Waiting on Client': 'waiting', 'Done': 'done' };
  const CUSTOM_SORT = 1000;
  const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js';
  const LIVE = Boolean(CFG.supabaseUrl && CFG.supabaseAnonKey);
  // Invite and password-reset links land here with this in the URL hash.
  // Read it before Supabase consumes the hash.
  let settingPassword = /type=(recovery|invite)/.test(location.hash);

  // ---------------------------------------------------------------- helpers
  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
  const nowISO = () => new Date().toISOString();
  const todayISO = () => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  };
  const fmtDate = (iso) => iso
    ? new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    : '';
  const fmtDateTime = (ts) => new Date(ts).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
  });
  const ago = (ts) => {
    if (!ts) return '';
    const s = Math.max(0, (Date.now() - new Date(ts).getTime()) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    if (s < 86400 * 30) return Math.floor(s / 86400) + 'd ago';
    return fmtDate(String(ts).slice(0, 10));
  };
  const initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2)
    .map((w) => w[0].toUpperCase()).join('') || '?';
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const isOverdue = (d) => d.status !== 'Done' && d.due_date && d.due_date < todayISO();
  const safeGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const safeSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } };

  const icon = {
    chev: '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M4 2l4 4-4 4" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    close: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
    lock: '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="5.5" width="8" height="5.5" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M4 5.5V4a2 2 0 014 0v1.5" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>',
    check: '<svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><path d="M5 10.5l3.2 3.2L15 7" stroke="#fff" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    plus: '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1.5v9M1.5 6h9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  };

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  function flattenCatalog(groups) {
    const out = [];
    let sort = 10;
    for (const g of groups || []) {
      for (const it of g.items || []) {
        out.push({ pillar: g.pillar, name: it.name, default_owner: it.owner || null, sort, active: true });
        sort += 10;
      }
    }
    return out;
  }

  // ------------------------------------------------------------ demo store
  // Same API as the live store, and the same permission rules as the
  // database, so the demo behaves the way the real thing will.
  function demoStore() {
    const KEY = 'cdt-demo-v1';
    const ROLE_KEY = 'cdt-demo-role';
    const catalog = flattenCatalog(CFG.catalog);
    let role = safeGet(ROLE_KEY) === 'team' ? 'team' : 'admin';
    let db;

    const me = () => ({ name: role === 'admin' ? 'Demo Admin' : 'Demo Team Member', email: '', role });
    const save = () => safeSet(KEY, JSON.stringify(db));
    const requireAdmin = () => { if (role !== 'admin') throw new Error('Only admins can do that.'); };
    const sortFor = (pillar, name) => (catalog.find((c) => c.pillar === pillar && c.name === name) || { sort: CUSTOM_SORT }).sort;
    const findD = (id) => {
      const d = db.deliverables.find((x) => x.id === id);
      if (!d) throw new Error('That deliverable no longer exists.');
      return d;
    };
    const makeDeliverable = (clientId, f) => {
      const t = nowISO();
      return {
        id: uid(), client_id: clientId, pillar: f.pillar, name: f.name.trim(),
        assigned_to: f.assigned_to || null, status: f.status || 'Pending', due_date: f.due_date || null,
        sort: f.sort ?? sortFor(f.pillar, f.name), created_by_name: f.by || me().name, created_at: t,
        updated_by_name: f.by || me().name, updated_at: t,
      };
    };

    function seed() {
      const fresh = { clients: [], deliverables: [], notes: [], activity: [] };
      const byName = new Map();
      const t = nowISO();
      for (const r of window.NOTION_IMPORT || []) {
        let c = byName.get(r.client);
        if (!c) {
          c = { id: uid(), name: r.client, program: CFG.program, start_date: null, target_date: r.due,
            source: 'notion-import', created_by_name: 'Notion import', created_at: t };
          byName.set(r.client, c);
          fresh.clients.push(c);
        }
        const d = makeDeliverable(c.id, { pillar: r.pillar, name: r.name, assigned_to: r.owner,
          status: r.status, due_date: r.due, by: 'Notion import' });
        fresh.deliverables.push(d);
        if (r.note) fresh.notes.push({ id: uid(), client_id: c.id, deliverable_id: d.id, body: r.note,
          author_name: 'Notion import', created_at: t });
      }
      return fresh;
    }

    function load() {
      try { db = JSON.parse(safeGet(KEY)); } catch { db = null; }
      if (!db || !Array.isArray(db.clients)) { db = seed(); save(); }
    }

    return {
      live: false,
      async init() {
        // Sample rows from the Notion tracker; optional, demo only.
        if (!window.NOTION_IMPORT) await loadScript('data/notion-import.js').catch(() => {});
        load();
        return me();
      },
      setRole(r) { role = r === 'team' ? 'team' : 'admin'; safeSet(ROLE_KEY, role); return me(); },
      reset() { db = seed(); save(); },
      onChange() {},
      async signOut() {},
      async load() {
        return { clients: [...db.clients], deliverables: [...db.deliverables], notes: [...db.notes],
          activity: [...db.activity], catalog };
      },
      async addClient(f) {
        const name = f.name.trim();
        if (db.clients.some((c) => c.name.trim().toLowerCase() === name.toLowerCase())) {
          throw new Error('A client with this name already exists.');
        }
        const t = nowISO();
        const c = { id: uid(), name, program: CFG.program, start_date: f.start_date || todayISO(),
          target_date: f.target_date || null, source: 'team', created_by_name: me().name, created_at: t };
        db.clients.push(c);
        if (f.include_package) {
          for (const it of catalog) {
            db.deliverables.push(makeDeliverable(c.id, { pillar: it.pillar, name: it.name,
              assigned_to: it.default_owner, due_date: c.target_date, sort: it.sort }));
          }
        }
        if (f.note && f.note.trim()) {
          db.notes.push({ id: uid(), client_id: c.id, deliverable_id: null, body: f.note.trim(), author_name: me().name, created_at: t });
        }
        db.activity.push({ id: uid(), client_id: c.id, deliverable_id: null, action: 'client', detail: 'Client added', actor_name: me().name, created_at: t });
        save();
        return c.id;
      },
      async addDeliverable(f) {
        const d = makeDeliverable(f.client_id, f);
        db.deliverables.push(d);
        if (f.note && f.note.trim()) {
          db.notes.push({ id: uid(), client_id: f.client_id, deliverable_id: d.id, body: f.note.trim(), author_name: me().name, created_at: d.created_at });
        }
        save();
        return d.id;
      },
      async setStatus(id, status) {
        const d = findD(id);
        if (d.status === status) return;
        db.activity.push({ id: uid(), client_id: d.client_id, deliverable_id: d.id, action: 'status',
          detail: d.status + ' → ' + status, actor_name: me().name, created_at: nowISO() });
        Object.assign(d, { status, updated_at: nowISO(), updated_by_name: me().name });
        save();
      },
      async addNote({ client_id, deliverable_id, body }) {
        db.notes.push({ id: uid(), client_id, deliverable_id: deliverable_id || null, body: body.trim(), author_name: me().name, created_at: nowISO() });
        save();
      },
      async updateDeliverable(id, patch) {
        requireAdmin();
        Object.assign(findD(id), patch, { updated_at: nowISO(), updated_by_name: me().name });
        save();
      },
      async deleteDeliverable(id) {
        requireAdmin();
        db.deliverables = db.deliverables.filter((d) => d.id !== id);
        db.notes = db.notes.filter((n) => n.deliverable_id !== id);
        db.activity = db.activity.filter((a) => a.deliverable_id !== id);
        save();
      },
      async updateClient(id, patch) {
        requireAdmin();
        if (patch.name && db.clients.some((c) => c.id !== id && c.name.trim().toLowerCase() === patch.name.trim().toLowerCase())) {
          throw new Error('A client with this name already exists.');
        }
        Object.assign(db.clients.find((c) => c.id === id), patch);
        save();
      },
      async deleteClient(id) {
        requireAdmin();
        db.clients = db.clients.filter((c) => c.id !== id);
        db.deliverables = db.deliverables.filter((d) => d.client_id !== id);
        db.notes = db.notes.filter((n) => n.client_id !== id);
        db.activity = db.activity.filter((a) => a.client_id !== id);
        save();
      },
      async deleteNote(id) {
        requireAdmin();
        db.notes = db.notes.filter((n) => n.id !== id);
        save();
      },
    };
  }

  // ------------------------------------------------------------ live store
  function supabaseStore() {
    let sb;
    let profile = null;

    const friendly = (error) => {
      if (!error) return new Error('Something went wrong.');
      if (error.code === '23505') return new Error('A client with this name already exists.');
      if (error.code === '42501') return new Error(error.message || 'You don\'t have permission to do that.');
      return new Error(error.message || 'Something went wrong.');
    };
    const must = ({ data, error }) => { if (error) throw friendly(error); return data; };
    const mustAffect = (res) => {
      const rows = must(res);
      if (!rows || rows.length === 0) throw new Error('You don\'t have permission to do that.');
      return rows;
    };

    async function fetchAll(table, order) {
      const out = [];
      const page = 1000;
      for (let from = 0; ; from += page) {
        const rows = must(await sb.from(table).select('*').order(order, { ascending: true }).range(from, from + page - 1));
        out.push(...rows);
        if (rows.length < page) return out;
      }
    }

    async function whoAmI() {
      const { data: { session } } = await sb.auth.getSession();
      if (!session) return null;
      profile = must(await sb.from('profiles').select('*').eq('id', session.user.id).single());
      return { name: profile.full_name || session.user.email, email: session.user.email, role: profile.role };
    }

    return {
      live: true,
      async init() {
        if (!window.supabase) await loadScript(SUPABASE_JS).catch(() => {
          throw new Error('Could not load the Supabase library. Check your internet connection.');
        });
        sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey);
        sb.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') location.reload(); });
        return whoAmI();
      },
      async signIn(email, password) {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Wrong email or password.' : error.message);
        return whoAmI();
      },
      async sendReset(email) {
        const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.href.split('#')[0] });
        if (error) throw friendly(error);
      },
      async updatePassword(password) {
        const { error } = await sb.auth.updateUser({ password });
        if (error) throw friendly(error);
      },
      async signOut() { await sb.auth.signOut(); },
      onChange(cb) {
        sb.channel('tracker')
          .on('postgres_changes', { event: '*', schema: 'public' }, () => cb())
          .subscribe();
      },
      async load() {
        const [clients, deliverables, notes, activity, catalog] = await Promise.all([
          fetchAll('clients', 'created_at'),
          fetchAll('deliverables', 'created_at'),
          fetchAll('notes', 'created_at'),
          fetchAll('activity', 'id'),
          fetchAll('catalog', 'sort'),
        ]);
        return { clients, deliverables, notes, activity, catalog: catalog.filter((c) => c.active) };
      },
      async addClient(f) {
        return must(await sb.rpc('add_client_with_package', {
          p_name: f.name.trim(), p_start_date: f.start_date || null, p_target_date: f.target_date || null,
          p_include_package: Boolean(f.include_package), p_source: 'team', p_note: f.note || null,
        }));
      },
      async addDeliverable(f) {
        const row = must(await sb.from('deliverables').insert({
          client_id: f.client_id, pillar: f.pillar, name: f.name.trim(), assigned_to: f.assigned_to || null,
          status: f.status || 'Pending', due_date: f.due_date || null, sort: f.sort ?? CUSTOM_SORT,
        }).select('id').single());
        if (f.note && f.note.trim()) {
          must(await sb.from('notes').insert({ client_id: f.client_id, deliverable_id: row.id, body: f.note.trim() }));
        }
        return row.id;
      },
      async setStatus(id, status) {
        mustAffect(await sb.from('deliverables').update({ status }).eq('id', id).select('id'));
      },
      async addNote({ client_id, deliverable_id, body }) {
        must(await sb.from('notes').insert({ client_id, deliverable_id: deliverable_id || null, body: body.trim() }));
      },
      async updateDeliverable(id, patch) {
        mustAffect(await sb.from('deliverables').update(patch).eq('id', id).select('id'));
      },
      async deleteDeliverable(id) {
        mustAffect(await sb.from('deliverables').delete().eq('id', id).select('id'));
      },
      async updateClient(id, patch) {
        mustAffect(await sb.from('clients').update(patch).eq('id', id).select('id'));
      },
      async deleteClient(id) {
        mustAffect(await sb.from('clients').delete().eq('id', id).select('id'));
      },
      async deleteNote(id) {
        mustAffect(await sb.from('notes').delete().eq('id', id).select('id'));
      },
    };
  }

  // ------------------------------------------------------------------ state
  const store = LIVE ? supabaseStore() : demoStore();
  const S = {
    me: null,
    clients: [], deliverables: [], notes: [], activity: [], catalog: [],
    filters: { q: '', client: '', status: '', owner: '', pillar: '', hideDone: false },
    view: safeGet('cdt-view') === 'flat' ? 'flat' : 'grouped',
    collapsed: new Set((() => { try { return JSON.parse(safeGet('cdt-collapsed') || '[]'); } catch { return []; } })()),
    drawer: null, // { type: 'deliverable' | 'client', id }
  };
  const isAdmin = () => S.me && S.me.role === 'admin';

  // Derived lookups, rebuilt after every load.
  let byClient = new Map();
  let notesByDeliv = new Map();
  let pillarOrder = new Map();
  function index() {
    byClient = new Map(S.clients.map((c) => [c.id, c]));
    notesByDeliv = new Map();
    for (const n of S.notes) {
      if (!n.deliverable_id) continue;
      if (!notesByDeliv.has(n.deliverable_id)) notesByDeliv.set(n.deliverable_id, []);
      notesByDeliv.get(n.deliverable_id).push(n);
    }
    for (const list of notesByDeliv.values()) list.sort((a, b) => b.created_at.localeCompare(a.created_at));
    pillarOrder = new Map();
    for (const c of S.catalog) if (!pillarOrder.has(c.pillar)) pillarOrder.set(c.pillar, pillarOrder.size);
  }
  const pillars = () => {
    const extra = [...new Set(S.deliverables.map((d) => d.pillar))].filter((p) => !pillarOrder.has(p)).sort();
    return [...pillarOrder.keys(), ...extra];
  };
  const pillarRank = (p) => (pillarOrder.has(p) ? pillarOrder.get(p) : 999);
  const byDeliverableOrder = (a, b) =>
    pillarRank(a.pillar) - pillarRank(b.pillar) || (a.sort ?? CUSTOM_SORT) - (b.sort ?? CUSTOM_SORT) ||
    a.created_at.localeCompare(b.created_at);
  const clientsSorted = () => [...S.clients].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  const owners = () => [...new Set([...(CFG.team || []), ...S.deliverables.map((d) => d.assigned_to).filter(Boolean)])];

  function clientStats(clientId) {
    const ds = S.deliverables.filter((d) => d.client_id === clientId);
    const done = ds.filter((d) => d.status === 'Done').length;
    return {
      total: ds.length, done,
      pct: ds.length ? Math.round((done / ds.length) * 100) : 0,
      waiting: ds.filter((d) => d.status === 'Waiting on Client').length,
      overdue: ds.filter(isOverdue).length,
    };
  }

  function matches(d) {
    const f = S.filters;
    if (f.client && d.client_id !== f.client) return false;
    if (f.status === 'overdue' ? !isOverdue(d) : f.status && d.status !== f.status) return false;
    if (f.owner === '__none' ? d.assigned_to : f.owner && d.assigned_to !== f.owner) return false;
    if (f.pillar && d.pillar !== f.pillar) return false;
    if (f.hideDone && d.status === 'Done') return false;
    if (f.q) {
      const q = f.q.toLowerCase();
      const c = byClient.get(d.client_id);
      const hay = [c && c.name, d.name, d.pillar, d.assigned_to, d.status,
        ...(notesByDeliv.get(d.id) || []).map((n) => n.body)].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }
  const filtersActive = () => {
    const f = S.filters;
    return Boolean(f.q || f.client || f.status || f.owner || f.pillar || f.hideDone);
  };

  // ------------------------------------------------------------------ toast
  function toast(msg, kind) {
    let box = $('.toasts');
    if (!box) { box = document.createElement('div'); box.className = 'toasts'; box.setAttribute('role', 'status'); document.body.appendChild(box); }
    const el = document.createElement('div');
    el.className = 'toast' + (kind === 'error' ? ' error' : '');
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(() => el.remove(), kind === 'error' ? 6000 : 2800);
  }
  async function act(fn, okMsg) {
    try {
      await fn();
      if (okMsg) toast(okMsg);
      await refresh();
      return true;
    } catch (e) {
      console.error(e);
      toast(e.message || String(e), 'error');
      await refresh().catch(() => {});
      return false;
    }
  }

  // ------------------------------------------------------------------ shell
  function renderShell() {
    const app = $('#app');
    app.innerHTML = `
      ${store.live ? '' : `
      <div class="banner">
        <span><strong>Demo mode.</strong> Changes are saved in this browser only. Connect Supabase (see README) to share it with your team.</span>
        <span class="spacer"></span>
        <span class="muted">Try it as:</span>
        <span class="role-switch" role="group" aria-label="Demo role">
          <button type="button" data-act="demo-role" data-role="admin">Admin</button>
          <button type="button" data-act="demo-role" data-role="team">Team member</button>
        </span>
        <button type="button" class="btn small ghost" data-act="demo-reset">Reset demo data</button>
      </div>`}
      <header class="topbar">
        <div class="brand">
          <div class="logo">${icon.check}</div>
          <div>
            <h1>${esc(CFG.appName || 'Client Delivery Tracker')}</h1>
            <p>${esc(CFG.orgName || '')}${CFG.orgName && CFG.program ? ' · ' : ''}${esc(CFG.program || '')}</p>
          </div>
        </div>
        <span class="spacer"></span>
        <div class="me" id="me"></div>
        <div class="actions">
          <button type="button" class="btn" data-act="new-deliverable">${icon.plus} Deliverable</button>
          <button type="button" class="btn primary" data-act="new-client">${icon.plus} Client</button>
        </div>
      </header>
      <section class="stats" id="stats" aria-label="Summary"></section>
      <section class="toolbar" aria-label="Filters">
        <input class="input search" id="f-q" type="search" placeholder="Search clients, deliverables, notes…" aria-label="Search">
        <select class="select" id="f-client" aria-label="Client"></select>
        <select class="select" id="f-status" aria-label="Status"></select>
        <select class="select" id="f-owner" aria-label="Assigned to"></select>
        <select class="select" id="f-pillar" aria-label="Pillar"></select>
        <label class="check"><input type="checkbox" id="f-hide-done"> Hide done</label>
        <button type="button" class="btn small ghost" id="f-clear" data-act="clear-filters" hidden>Clear filters</button>
        <span class="spacer"></span>
        <div class="seg" role="group" aria-label="Layout">
          <button type="button" data-act="view" data-view="grouped">By client</button>
          <button type="button" data-act="view" data-view="flat">All rows</button>
        </div>
      </section>
      <div class="table-wrap" id="table"></div>
      <div id="drawer-root"></div>
      <dialog id="modal"></dialog>`;

    $('#f-q').addEventListener('input', debounce((e) => { S.filters.q = e.target.value.trim(); renderTable(); renderStatsAndFilters(); }, 150));
    for (const [id, key] of [['#f-client', 'client'], ['#f-status', 'status'], ['#f-owner', 'owner'], ['#f-pillar', 'pillar']]) {
      $(id).addEventListener('change', (e) => { S.filters[key] = e.target.value; render(); });
    }
    $('#f-hide-done').addEventListener('change', (e) => { S.filters.hideDone = e.target.checked; render(); });

    app.addEventListener('click', onClick);
    app.addEventListener('change', onChange);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && S.drawer && !$('#modal').open) closeDrawer();
    });
  }

  function render() {
    index();
    renderMe();
    renderStatsAndFilters();
    renderTable();
    renderDrawer();
  }

  function renderMe() {
    $('#me').innerHTML = `
      <span>${esc(S.me.name)}</span>
      <span class="role-tag ${isAdmin() ? 'admin' : ''}">${isAdmin() ? 'Admin' : 'Team'}</span>
      ${store.live ? '<button type="button" class="btn small ghost" data-act="sign-out">Sign out</button>' : ''}`;
    document.querySelectorAll('[data-act="demo-role"]').forEach((b) =>
      b.setAttribute('aria-pressed', String(b.dataset.role === S.me.role)));
    document.querySelectorAll('[data-act="view"]').forEach((b) =>
      b.setAttribute('aria-pressed', String(b.dataset.view === S.view)));
  }

  function renderStatsAndFilters() {
    const open = S.deliverables.filter((d) => d.status !== 'Done').length;
    const waiting = S.deliverables.filter((d) => d.status === 'Waiting on Client').length;
    const overdue = S.deliverables.filter(isOverdue).length;
    const f = S.filters;
    $('#stats').innerHTML = `
      <div class="stat"><span class="n">${S.clients.length}</span><span class="l">Clients</span></div>
      <button type="button" class="stat ${f.hideDone && !f.status ? 'active' : ''}" data-act="stat" data-stat="open">
        <span class="n">${open}</span><span class="l">Open deliverables</span></button>
      <button type="button" class="stat ${waiting ? 'warn' : ''} ${f.status === 'Waiting on Client' ? 'active' : ''}" data-act="stat" data-stat="waiting">
        <span class="n">${waiting}</span><span class="l">Waiting on client</span></button>
      <button type="button" class="stat ${overdue ? 'warn' : ''} ${f.status === 'overdue' ? 'active' : ''}" data-act="stat" data-stat="overdue">
        <span class="n">${overdue}</span><span class="l">Overdue</span></button>`;

    const opts = (list, selected, allLabel) => `<option value="">${allLabel}</option>` +
      list.map(([v, l]) => `<option value="${esc(v)}" ${v === selected ? 'selected' : ''}>${esc(l)}</option>`).join('');
    $('#f-client').innerHTML = opts(clientsSorted().map((c) => [c.id, c.name]), f.client, 'All clients');
    $('#f-status').innerHTML = opts([...STATUSES.map((s) => [s, s]), ['overdue', 'Overdue']], f.status, 'All statuses');
    $('#f-owner').innerHTML = opts([...owners().map((o) => [o, o]), ['__none', 'Unassigned']], f.owner, 'Everyone');
    $('#f-pillar').innerHTML = opts(pillars().map((p) => [p, p]), f.pillar, 'All pillars');
    $('#f-hide-done').checked = f.hideDone;
    $('#f-clear').hidden = !filtersActive();
  }

  // ------------------------------------------------------------------ table
  function statusSelect(d) {
    return `<select class="status ${STATUS_CLASS[d.status] || 'pending'}" data-act="status" data-id="${d.id}" aria-label="Status of ${esc(d.name)}">
      ${STATUSES.map((s) => `<option ${s === d.status ? 'selected' : ''}>${s}</option>`).join('')}</select>`;
  }

  function rowHTML(d) {
    const c = byClient.get(d.client_id) || { name: '—' };
    const notes = notesByDeliv.get(d.id) || [];
    const latest = notes[0];
    const overdue = isOverdue(d);
    return `<tr class="row" data-id="${d.id}">
      <td class="sticky c-client"><button type="button" class="link client-name" data-act="open-client" data-id="${c.id}">${esc(c.name)}</button></td>
      <td class="c-deliv">
        <button type="button" class="link" data-act="open-deliverable" data-id="${d.id}">${esc(d.name)}</button>
        <span class="pillar">${esc(d.pillar)}</span>
      </td>
      <td class="c-owner">${d.assigned_to ? esc(d.assigned_to) : '<span class="muted">—</span>'}</td>
      <td class="c-status">${statusSelect(d)}</td>
      <td class="c-due ${overdue ? 'overdue' : ''}">${d.due_date ? esc(fmtDate(d.due_date)) : '<span class="muted">—</span>'}</td>
      <td class="c-note">${latest
        ? `<button type="button" class="note-preview" data-act="open-deliverable" data-id="${d.id}" title="${esc(latest.body)}">${esc(latest.body)}</button>${notes.length > 1 ? `<span class="count">+${notes.length - 1} more</span>` : ''}`
        : `<button type="button" class="note-add" data-act="open-deliverable" data-id="${d.id}" data-focus="note">+ Add note</button>`}</td>
      <td class="c-upd muted" title="${esc(d.updated_by_name || '')}">${esc(ago(d.updated_at))}${d.updated_by_name ? ' · ' + esc(d.updated_by_name) : ''}</td>
    </tr>`;
  }

  function groupHTML(c, rows, st) {
    const open = !S.collapsed.has(c.id);
    return `<tr class="group"><td colspan="7"><div class="group-inner">
        <button type="button" class="chev" data-act="toggle" data-id="${c.id}" aria-expanded="${open}" aria-label="${open ? 'Collapse' : 'Expand'} ${esc(c.name)}">${icon.chev}</button>
        <button type="button" class="link client-name" data-act="open-client" data-id="${c.id}">${esc(c.name)}</button>
        <span class="progress"><span class="bar"><span style="width:${st.pct}%"></span></span>${st.done}/${st.total} done · ${st.pct}%</span>
        ${st.waiting ? `<span class="badge waiting">${st.waiting} waiting on client</span>` : ''}
        ${st.overdue ? `<span class="badge overdue">${st.overdue} overdue</span>` : ''}
        ${filtersActive() && rows.length !== st.total ? `<span class="badge neutral">${rows.length} shown</span>` : ''}
        <button type="button" class="btn small ghost" data-act="new-deliverable" data-client="${c.id}">${icon.plus} Deliverable</button>
      </div></td></tr>
      ${open ? rows.map(rowHTML).join('') : ''}`;
  }

  function renderTable() {
    const head = `<thead><tr>
      <th class="sticky c-client">Client</th><th class="c-deliv">Deliverable</th><th class="c-owner">Assigned to</th>
      <th class="c-status">Status</th><th class="c-due">Due date</th><th class="c-note">Notes</th><th class="c-upd">Last update</th>
    </tr></thead>`;

    if (!S.clients.length) {
      $('#table').innerHTML = `<div class="empty"><strong>No clients yet</strong>Add your first client to start tracking deliverables.<br><br>
        <button type="button" class="btn primary" data-act="new-client">${icon.plus} Add client</button></div>`;
      return;
    }

    const visible = S.deliverables.filter(matches);
    let body = '';
    if (S.view === 'grouped') {
      const groups = new Map();
      for (const d of visible) {
        if (!groups.has(d.client_id)) groups.set(d.client_id, []);
        groups.get(d.client_id).push(d);
      }
      for (const c of clientsSorted()) {
        const rows = (groups.get(c.id) || []).sort(byDeliverableOrder);
        const showEmptyClient = !filtersActive() || (S.filters.client === c.id);
        if (!rows.length && !showEmptyClient) continue;
        body += groupHTML(c, rows, clientStats(c.id));
      }
    } else {
      const sorted = [...visible].sort((a, b) =>
        (a.due_date || '9999').localeCompare(b.due_date || '9999') ||
        (byClient.get(a.client_id)?.name || '').localeCompare(byClient.get(b.client_id)?.name || '') ||
        byDeliverableOrder(a, b));
      body = sorted.map(rowHTML).join('');
    }

    $('#table').innerHTML = body
      ? `<table>${head}<tbody>${body}</tbody></table>`
      : `<div class="empty"><strong>Nothing matches these filters</strong><button type="button" class="btn small" data-act="clear-filters">Clear filters</button></div>`;
  }

  // ----------------------------------------------------------------- drawer
  function timelineHTML(notes, events, extraFooter) {
    const items = [
      ...notes.map((n) => ({ kind: 'note', at: n.created_at, n })),
      ...events.map((a) => ({ kind: 'event', at: a.created_at, a })),
    ].sort((x, y) => y.at.localeCompare(x.at));
    if (!items.length && !extraFooter) return '<p class="muted" style="margin:0">No notes yet.</p>';
    return `<div class="timeline">${items.map((it) => it.kind === 'note' ? `
      <div class="tl-item">
        <div class="avatar">${esc(initials(it.n.author_name))}</div>
        <div>
          <div class="tl-meta"><b>${esc(it.n.author_name || 'Unknown')}</b><span>${esc(fmtDateTime(it.at))}</span>
            ${isAdmin() ? `<button type="button" class="btn small ghost" data-act="delete-note" data-id="${it.n.id}" aria-label="Delete note">Delete</button>` : ''}</div>
          <div class="tl-body">${esc(it.n.body)}</div>
        </div>
      </div>` : `
      <div class="tl-item event">
        <div class="avatar sys">${esc(initials(it.a.actor_name))}</div>
        <div>
          <div class="tl-meta"><b>${esc(it.a.actor_name || 'System')}</b><span>${esc(fmtDateTime(it.at))}</span></div>
          <div class="tl-body">${it.a.action === 'status' ? 'Status: ' : ''}${esc(it.a.detail)}</div>
        </div>
      </div>`).join('')}${extraFooter || ''}</div>`;
  }

  const noteFormHTML = (clientId, delivId) => `
    <form class="note-form" data-form="note" data-client="${clientId}" data-deliverable="${delivId || ''}">
      <label class="sr-only" for="note-body">New note</label>
      <textarea class="textarea" id="note-body" name="body" placeholder="Add a note — what happened, what's next…" required></textarea>
      <div class="row-end"><span class="hint" style="margin-right:auto">Notes can't be edited once added.</span>
        <button type="submit" class="btn primary small">Add note</button></div>
    </form>`;

  function deliverableDrawer(d) {
    const c = byClient.get(d.client_id) || { name: '—' };
    const notes = notesByDeliv.get(d.id) || [];
    const events = S.activity.filter((a) => a.deliverable_id === d.id);
    const created = `<div class="tl-item event"><div class="avatar sys">+</div><div>
        <div class="tl-meta"><b>${esc(d.created_by_name || 'Unknown')}</b><span>${esc(fmtDateTime(d.created_at))}</span></div>
        <div class="tl-body">Deliverable added</div></div></div>`;
    const admin = isAdmin();
    const ownerOpts = ['', ...owners()].map((o) => `<option value="${esc(o)}" ${o === (d.assigned_to || '') ? 'selected' : ''}>${o ? esc(o) : '— Unassigned —'}</option>`).join('');
    const pillarOpts = pillars().map((p) => `<option ${p === d.pillar ? 'selected' : ''}>${esc(p)}</option>`).join('');
    return `
      <header>
        <div class="t">
          <div class="eyebrow"><button type="button" class="link" data-act="open-client" data-id="${c.id}">${esc(c.name)}</button> · ${esc(d.pillar)}</div>
          <h2>${esc(d.name)}</h2>
        </div>
        <button type="button" class="btn small ghost" data-act="close-drawer" aria-label="Close">${icon.close}</button>
      </header>
      <div class="body">
        <section>
          <dl class="props">
            <dt>Status</dt><dd>${statusSelect(d)}</dd>
            ${admin ? `
            <dt><label for="e-name">Deliverable</label></dt><dd><input class="input" id="e-name" data-edit="name" value="${esc(d.name)}"></dd>
            <dt><label for="e-pillar">Pillar</label></dt><dd><select class="select" id="e-pillar" data-edit="pillar">${pillarOpts}</select></dd>
            <dt><label for="e-owner">Assigned to</label></dt><dd><select class="select" id="e-owner" data-edit="assigned_to">${ownerOpts}</select></dd>
            <dt><label for="e-due">Due date</label></dt><dd><input class="input" id="e-due" type="date" data-edit="due_date" value="${esc(d.due_date || '')}"></dd>
            ` : `
            <dt>Assigned to</dt><dd>${d.assigned_to ? esc(d.assigned_to) : '<span class="muted">Unassigned</span>'}</dd>
            <dt>Due date</dt><dd class="${isOverdue(d) ? 'overdue' : ''}">${d.due_date ? esc(fmtDate(d.due_date)) : '<span class="muted">Not set</span>'}${isOverdue(d) ? ' · overdue' : ''}</dd>
            <dt></dt><dd class="locked">${icon.lock} Only admins can change these.</dd>`}
          </dl>
        </section>
        <section>
          <h3>Notes & history</h3>
          ${noteFormHTML(d.client_id, d.id)}
        </section>
        <section>${timelineHTML(notes, events, created)}</section>
        ${admin ? `<section class="admin-zone"><button type="button" class="btn danger small" data-act="delete-deliverable" data-id="${d.id}">Delete deliverable</button></section>` : ''}
      </div>`;
  }

  function clientDrawer(c) {
    const st = clientStats(c.id);
    const ds = S.deliverables.filter((d) => d.client_id === c.id);
    const perPillar = pillars().map((p) => {
      const list = ds.filter((d) => d.pillar === p);
      if (!list.length) return '';
      const done = list.filter((d) => d.status === 'Done').length;
      const pct = Math.round((done / list.length) * 100);
      return `<div class="pillar-row"><span>${esc(p)}</span><span class="bar"><span style="width:${pct}%"></span></span><span class="num">${done}/${list.length}</span></div>`;
    }).join('');
    const notes = S.notes.filter((n) => n.client_id === c.id && !n.deliverable_id);
    const events = S.activity.filter((a) => a.client_id === c.id)
      .map((a) => {
        if (!a.deliverable_id) return a;
        const d = S.deliverables.find((x) => x.id === a.deliverable_id);
        return { ...a, detail: (d ? d.name + ': ' : '') + a.detail, action: 'event' };
      })
      .sort((x, y) => y.created_at.localeCompare(x.created_at)).slice(0, 25);
    const admin = isAdmin();
    return `
      <header>
        <div class="t">
          <div class="eyebrow">${esc(c.program || CFG.program || 'Client')}</div>
          <h2>${esc(c.name)}</h2>
        </div>
        <button type="button" class="btn small ghost" data-act="close-drawer" aria-label="Close">${icon.close}</button>
      </header>
      <div class="body">
        <section>
          <div class="progress" style="margin-bottom:12px"><span class="bar" style="width:160px"><span style="width:${st.pct}%"></span></span>
            <b>${st.pct}%</b> · ${st.done} of ${st.total} done
            ${st.waiting ? `<span class="badge waiting">${st.waiting} waiting</span>` : ''}
            ${st.overdue ? `<span class="badge overdue">${st.overdue} overdue</span>` : ''}</div>
          ${perPillar ? `<div class="pillars">${perPillar}</div>` : '<p class="muted" style="margin:0">No deliverables yet.</p>'}
        </section>
        <section>
          <dl class="props">
            ${admin ? `
            <dt><label for="c-name">Name</label></dt><dd><input class="input" id="c-name" data-cedit="name" value="${esc(c.name)}"></dd>
            <dt><label for="c-start">Start date</label></dt><dd><input class="input" type="date" id="c-start" data-cedit="start_date" value="${esc(c.start_date || '')}"></dd>
            <dt><label for="c-target">Target date</label></dt><dd><input class="input" type="date" id="c-target" data-cedit="target_date" value="${esc(c.target_date || '')}"></dd>
            ` : `
            <dt>Start date</dt><dd>${c.start_date ? esc(fmtDate(c.start_date)) : '<span class="muted">—</span>'}</dd>
            <dt>Target date</dt><dd>${c.target_date ? esc(fmtDate(c.target_date)) : '<span class="muted">—</span>'}</dd>`}
            <dt>Added by</dt><dd>${esc(c.created_by_name || '—')} <span class="muted">· ${esc(fmtDate(String(c.created_at).slice(0, 10)))}</span></dd>
          </dl>
          <div style="margin-top:12px; display:flex; gap:8px; flex-wrap:wrap">
            <button type="button" class="btn small" data-act="new-deliverable" data-client="${c.id}">${icon.plus} Add deliverable</button>
            <button type="button" class="btn small ghost" data-act="filter-client" data-id="${c.id}">Show only this client</button>
          </div>
        </section>
        <section>
          <h3>Client notes & recent activity</h3>
          ${noteFormHTML(c.id, null)}
        </section>
        <section>${timelineHTML(notes, events)}</section>
        ${admin ? `<section class="admin-zone"><button type="button" class="btn danger small" data-act="delete-client" data-id="${c.id}">Delete client and all their deliverables</button></section>` : ''}
      </div>`;
  }

  function renderDrawer() {
    const root = $('#drawer-root');
    if (!S.drawer) { root.innerHTML = ''; return; }
    const draft = $('#note-body') ? $('#note-body').value : '';
    const hadFocus = document.activeElement && document.activeElement.id === 'note-body';
    let html = '';
    if (S.drawer.type === 'deliverable') {
      const d = S.deliverables.find((x) => x.id === S.drawer.id);
      if (!d) { S.drawer = null; root.innerHTML = ''; return; }
      html = deliverableDrawer(d);
    } else {
      const c = byClient.get(S.drawer.id);
      if (!c) { S.drawer = null; root.innerHTML = ''; return; }
      html = clientDrawer(c);
    }
    root.innerHTML = `<div class="scrim" data-act="close-drawer"></div><aside class="drawer" role="dialog" aria-modal="true" aria-label="Details">${html}</aside>`;
    // Keep a half-written note when live updates re-render the drawer.
    if (draft && S.drawer.key === drawerKey()) $('#note-body').value = draft;
    if (hadFocus) $('#note-body').focus();
    S.drawer.key = drawerKey();
  }
  const drawerKey = () => S.drawer && S.drawer.type + ':' + S.drawer.id;

  function openDrawer(type, id, focusNote) {
    S.drawer = { type, id };
    renderDrawer();
    const target = focusNote ? $('#note-body') : $('.drawer [data-act="close-drawer"]');
    if (target) target.focus();
  }
  function closeDrawer() { S.drawer = null; renderDrawer(); }

  // ----------------------------------------------------------------- modals
  function openModal(html, onSubmit) {
    const dlg = $('#modal');
    dlg.innerHTML = html;
    const form = dlg.querySelector('form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (e.submitter && e.submitter.value === 'cancel') { dlg.close(); return; }
      const btn = form.querySelector('[type="submit"]:not([value="cancel"])');
      btn.disabled = true;
      const ok = await onSubmit(new FormData(form), form);
      btn.disabled = false;
      if (ok) dlg.close();
    });
    dlg.showModal();
    const first = form.querySelector('input:not([type="hidden"]), select, textarea');
    if (first) first.focus();
    return form;
  }

  function newClientModal() {
    const n = S.catalog.length;
    openModal(`
      <form>
        <h2>Add a client</h2>
        <p class="sub">They'll appear in the tracker for the whole team.</p>
        <label class="field"><span>Client name</span><input class="input" name="name" required maxlength="120" autocomplete="off"></label>
        <div class="grid2">
          <label class="field"><span>Start date</span><input class="input" type="date" name="start_date" value="${todayISO()}"></label>
          <label class="field"><span>Target date <span class="muted">(optional)</span></span><input class="input" type="date" name="target_date"></label>
        </div>
        ${n ? `<label class="pkg"><input type="checkbox" name="include_package" checked>
          <span><b>Add the full ${esc(CFG.program || 'package')} checklist</b><br>
          <span class="muted">Creates all ${n} deliverables as Pending, with default owners. The target date becomes each one's due date.</span></span></label>` : ''}
        <label class="field"><span>First note <span class="muted">(optional)</span></span><textarea class="textarea" name="note" placeholder="e.g. Onboarding call done, niche is…"></textarea></label>
        <p class="warn-text" id="dup-warn" hidden>A client with this name already exists.</p>
        <div class="actions">
          <button type="submit" class="btn" value="cancel" formnovalidate>Cancel</button>
          <button type="submit" class="btn primary">Add client</button>
        </div>
      </form>`, async (fd) => {
      const name = String(fd.get('name') || '').trim();
      if (!name) return false;
      let newId;
      const ok = await act(async () => {
        newId = await store.addClient({
          name, start_date: fd.get('start_date'), target_date: fd.get('target_date'),
          include_package: fd.get('include_package') === 'on', note: String(fd.get('note') || ''),
        });
      }, `${name} added`);
      if (ok && newId) openDrawer('client', newId);
      return ok;
    });
    const input = $('#modal input[name="name"]');
    input.addEventListener('input', () => {
      const v = input.value.trim().toLowerCase();
      $('#dup-warn').hidden = !S.clients.some((c) => c.name.trim().toLowerCase() === v);
    });
  }

  function newDeliverableModal(clientId) {
    if (!S.clients.length) { toast('Add a client first.', 'error'); return; }
    const NEW = '__new';
    const clientOpts = clientsSorted().map((c) => `<option value="${c.id}" ${c.id === clientId ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
    const pillarOpts = pillars().map((p) => `<option>${esc(p)}</option>`).join('') + '<option value="Other">Other</option>';
    const ownerOpts = '<option value="">— Unassigned —</option>' + owners().map((o) => `<option>${esc(o)}</option>`).join('');
    const statusOpts = STATUSES.map((s) => `<option>${s}</option>`).join('');
    const form = openModal(`
      <form>
        <h2>Add a deliverable</h2>
        <label class="field"><span>Client</span><select class="select" name="client_id" required>${clientId ? '' : '<option value="">Choose a client…</option>'}${clientOpts}</select></label>
        <div class="grid2">
          <label class="field"><span>Pillar</span><select class="select" name="pillar">${pillarOpts}</select></label>
          <label class="field"><span>Deliverable</span><select class="select" name="pick"></select></label>
        </div>
        <label class="field" id="custom-wrap" hidden><span>New deliverable name</span><input class="input" name="custom" maxlength="140" placeholder="e.g. Podcast cover art"></label>
        <p class="warn-text" id="exists-warn" hidden>This client already has this deliverable.</p>
        <div class="grid2">
          <label class="field"><span>Assigned to</span><select class="select" name="assigned_to">${ownerOpts}</select></label>
          <label class="field"><span>Due date</span><input class="input" type="date" name="due_date"></label>
        </div>
        <label class="field"><span>Status</span><select class="select" name="status">${statusOpts}</select></label>
        <label class="field"><span>Note <span class="muted">(optional)</span></span><textarea class="textarea" name="note"></textarea></label>
        <div class="actions">
          <button type="submit" class="btn" value="cancel" formnovalidate>Cancel</button>
          <button type="submit" class="btn primary">Add deliverable</button>
        </div>
      </form>`, async (fd) => {
      const pick = fd.get('pick');
      const name = String(pick === NEW ? fd.get('custom') : pick || '').trim();
      const client_id = fd.get('client_id');
      if (!client_id) { toast('Choose a client.', 'error'); return false; }
      if (!name) { toast('Give the deliverable a name.', 'error'); return false; }
      const pillar = fd.get('pillar');
      const cat = S.catalog.find((c) => c.pillar === pillar && c.name === name);
      return act(() => store.addDeliverable({
        client_id, pillar, name, assigned_to: fd.get('assigned_to'), due_date: fd.get('due_date'),
        status: fd.get('status'), note: String(fd.get('note') || ''), sort: cat ? cat.sort : CUSTOM_SORT,
      }), `${name} added`);
    });

    const pillarSel = form.elements.pillar;
    const pickSel = form.elements.pick;
    const syncItems = () => {
      const items = S.catalog.filter((c) => c.pillar === pillarSel.value);
      pickSel.innerHTML = items.map((c) => `<option>${esc(c.name)}</option>`).join('') +
        `<option value="${NEW}">＋ New deliverable…</option>`;
      syncPick();
    };
    const syncPick = () => {
      const isNew = pickSel.value === NEW;
      $('#custom-wrap').hidden = !isNew;
      form.elements.custom.required = isNew;
      const cat = S.catalog.find((c) => c.pillar === pillarSel.value && c.name === pickSel.value);
      if (cat && cat.default_owner) form.elements.assigned_to.value = cat.default_owner;
      const client = byClient.get(form.elements.client_id.value);
      if (client && client.target_date && !form.elements.due_date.value) form.elements.due_date.value = client.target_date;
      syncExists();
    };
    const syncExists = () => {
      const name = (pickSel.value === NEW ? form.elements.custom.value : pickSel.value).trim().toLowerCase();
      const cid = form.elements.client_id.value;
      $('#exists-warn').hidden = !S.deliverables.some((d) => d.client_id === cid && d.name.trim().toLowerCase() === name);
    };
    pillarSel.addEventListener('change', syncItems);
    pickSel.addEventListener('change', syncPick);
    form.elements.custom.addEventListener('input', syncExists);
    form.elements.client_id.addEventListener('change', () => { form.elements.due_date.value = ''; syncPick(); });
    syncItems();
  }

  function confirmModal(title, text, confirmLabel) {
    return new Promise((resolve) => {
      openModal(`
        <form>
          <h2>${esc(title)}</h2>
          <p style="margin:0">${esc(text)}</p>
          <div class="actions">
            <button type="submit" class="btn" value="cancel" formnovalidate>Cancel</button>
            <button type="submit" class="btn danger">${esc(confirmLabel)}</button>
          </div>
        </form>`, async () => { resolve(true); return true; });
      $('#modal').addEventListener('close', () => resolve(false), { once: true });
    });
  }

  // ----------------------------------------------------------------- events
  async function onClick(e) {
    const el = e.target.closest('[data-act]');
    if (!el || el.tagName === 'SELECT') return;
    const { act: a, id } = el.dataset;
    switch (a) {
      case 'new-client': return newClientModal();
      case 'new-deliverable': return newDeliverableModal(el.dataset.client || S.filters.client || (S.drawer && S.drawer.type === 'client' ? S.drawer.id : ''));
      case 'open-client': return openDrawer('client', id);
      case 'open-deliverable': return openDrawer('deliverable', id, el.dataset.focus === 'note');
      case 'close-drawer': return closeDrawer();
      case 'toggle':
        S.collapsed.has(id) ? S.collapsed.delete(id) : S.collapsed.add(id);
        safeSet('cdt-collapsed', JSON.stringify([...S.collapsed]));
        return renderTable();
      case 'view':
        S.view = el.dataset.view;
        safeSet('cdt-view', S.view);
        renderMe();
        return renderTable();
      case 'stat': {
        const s = el.dataset.stat;
        const f = S.filters;
        if (s === 'open') { const on = f.hideDone && !f.status; f.hideDone = !on; f.status = ''; }
        else { const v = s === 'waiting' ? 'Waiting on Client' : 'overdue'; f.status = f.status === v ? '' : v; }
        return render();
      }
      case 'clear-filters':
        S.filters = { q: '', client: '', status: '', owner: '', pillar: '', hideDone: false };
        $('#f-q').value = '';
        return render();
      case 'filter-client':
        S.filters.client = id;
        closeDrawer();
        return render();
      case 'demo-role':
        S.me = store.setRole(el.dataset.role);
        toast(S.me.role === 'admin' ? 'Viewing as admin — you can edit and delete.' : 'Viewing as a team member — add clients, deliverables, notes and change status.');
        return render();
      case 'demo-reset':
        if (await confirmModal('Reset demo data?', 'This puts back the clients imported from Notion and removes anything you added in the demo.', 'Reset')) {
          store.reset();
          S.drawer = null;
          await refresh();
          toast('Demo data reset');
        }
        return;
      case 'sign-out': return store.signOut();
      case 'delete-note':
        if (await confirmModal('Delete this note?', 'This can\'t be undone.', 'Delete note')) await act(() => store.deleteNote(id), 'Note deleted');
        return;
      case 'delete-deliverable': {
        const d = S.deliverables.find((x) => x.id === id);
        if (d && await confirmModal(`Delete "${d.name}"?`, 'Its notes and history are deleted too. This can\'t be undone.', 'Delete deliverable')) {
          if (await act(() => store.deleteDeliverable(id), 'Deliverable deleted')) closeDrawer();
        }
        return;
      }
      case 'delete-client': {
        const c = byClient.get(id);
        if (c && await confirmModal(`Delete ${c.name}?`, 'All of their deliverables, notes and history are deleted too. This can\'t be undone.', 'Delete client')) {
          if (await act(() => store.deleteClient(id), `${c.name} deleted`)) { closeDrawer(); S.filters.client = ''; render(); }
        }
        return;
      }
      default:
    }
  }

  async function onChange(e) {
    const el = e.target;
    if (el.dataset.act === 'status') {
      el.className = 'status ' + (STATUS_CLASS[el.value] || 'pending');
      await act(() => store.setStatus(el.dataset.id, el.value));
      return;
    }
    if (el.dataset.edit && S.drawer && S.drawer.type === 'deliverable') {
      let value = el.value.trim();
      if (el.dataset.edit === 'name' && !value) { toast('Name can\'t be empty.', 'error'); return render(); }
      if (el.dataset.edit !== 'name') value = value || null;
      await act(() => store.updateDeliverable(S.drawer.id, { [el.dataset.edit]: value }), 'Saved');
      return;
    }
    if (el.dataset.cedit && S.drawer && S.drawer.type === 'client') {
      let value = el.value.trim();
      if (el.dataset.cedit === 'name' && !value) { toast('Name can\'t be empty.', 'error'); return render(); }
      if (el.dataset.cedit !== 'name') value = value || null;
      await act(() => store.updateClient(S.drawer.id, { [el.dataset.cedit]: value }), 'Saved');
    }
  }

  document.addEventListener('submit', async (e) => {
    const form = e.target;
    if (form.dataset.form !== 'note') return;
    e.preventDefault();
    const body = form.elements.body.value.trim();
    if (!body) return;
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    form.elements.body.value = '';
    const ok = await act(() => store.addNote({ client_id: form.dataset.client, deliverable_id: form.dataset.deliverable || null, body }), 'Note added');
    if (!ok && $('#note-body')) $('#note-body').value = body;
    btn.disabled = false;
  });

  // ------------------------------------------------------------ login (live)
  function renderLogin(message) {
    const recovering = settingPassword;
    $('#app').innerHTML = `
      <div class="login">
        <form id="login-form">
          <div class="brand"><div class="logo">${icon.check}</div>
            <div><h1>${esc(CFG.appName || 'Client Delivery Tracker')}</h1><p class="muted" style="margin:0">${esc(CFG.orgName || '')}</p></div></div>
          ${recovering ? `
            <p class="muted" style="margin:0">Choose a password for your account.</p>
            <label class="field"><span>New password</span><input class="input" type="password" name="password" required minlength="8" autocomplete="new-password"></label>
            <button type="submit" class="btn primary">Set password</button>` : `
            <label class="field"><span>Email</span><input class="input" type="email" name="email" required autocomplete="email"></label>
            <label class="field"><span>Password</span><input class="input" type="password" name="password" required autocomplete="current-password"></label>
            <button type="submit" class="btn primary">Sign in</button>
            <button type="button" class="btn ghost small" id="forgot">Forgot password?</button>`}
          <p class="err" id="login-err">${esc(message || '')}</p>
          <p class="hint" style="margin:0">Accounts are created by your admin. Ask them for an invite if you don't have one.</p>
        </form>
      </div>`;
    const form = $('#login-form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      $('#login-err').textContent = '';
      try {
        if (recovering) {
          await store.updatePassword(form.elements.password.value);
          settingPassword = false;
          history.replaceState(null, '', location.pathname);
          start(await store.init());
        } else {
          start(await store.signIn(form.elements.email.value.trim(), form.elements.password.value));
        }
      } catch (err) {
        $('#login-err').textContent = err.message;
        btn.disabled = false;
      }
    });
    const forgot = $('#forgot');
    if (forgot) forgot.addEventListener('click', async () => {
      const email = form.elements.email.value.trim();
      if (!email) { $('#login-err').textContent = 'Enter your email first.'; return; }
      try { await store.sendReset(email); $('#login-err').textContent = 'Check your inbox for a reset link.'; }
      catch (err) { $('#login-err').textContent = err.message; }
    });
  }

  // ------------------------------------------------------------------- boot
  let refreshing = null;
  async function refresh() {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      try { Object.assign(S, await store.load()); render(); }
      finally { refreshing = null; }
    })();
    return refreshing;
  }

  async function start(me) {
    if (!me) return renderLogin();
    S.me = me;
    renderShell();
    await refresh();
    store.onChange(debounce(() => refresh().catch(console.error), 400));
  }

  (async () => {
    try {
      const me = await store.init();
      if (store.live && settingPassword) return renderLogin();
      await start(me);
    } catch (e) {
      console.error(e);
      $('#app').innerHTML = `<div class="empty"><strong>Couldn't start the tracker</strong>${esc(e.message || e)}</div>`;
    }
  })();
})();
