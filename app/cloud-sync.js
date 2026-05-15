/*
  HPMS Cloud Sync — CLOUD-AUTHORITATIVE (online-only)
  ───────────────────────────────────────────────────
  The cloud is the single source of truth. The app does NOT run on
  stale local data:

    1. On every load it adopts the cloud copy (latest data always)
    2. Editing requires internet — when offline / cloud unreachable
       the app is READ-ONLY, so a stale local copy can never be
       created or pushed back over good cloud data
    3. Edits made this session push to the cloud immediately
    4. Realtime + focus + periodic poll keep every device on the
       latest; a device that didn't edit always takes the cloud copy

  A persisted "dirty" queue from a previous session is ignored on
  load — that (and wall-clock comparison) is what used to make old
  data resurrect. Conflict rule: last edit pushed wins.

  The app needs ZERO source changes. We hook localStorage.setItem.

  Status UI:
    - Pill bottom-right: Synced / Syncing / Needs internet (read-only)
    - Click it to force pull/push, see workspace info
*/

(function () {
  'use strict';

  const STORAGE_KEY = 'hpms_data_v2';            // same key the app uses
  const META_KEY    = 'hpms_sync_meta_v1';        // our own bookkeeping
  const DEVICE_KEY  = 'hpms_device_id_v1';

  const cfg = window.HPMS_CONFIG || {};
  const ENABLED = !!(cfg.supabaseUrl && cfg.supabaseAnonKey && cfg.workspaceCode);

  // CLOUD-AUTHORITATIVE / ONLINE-ONLY:
  //  - The cloud is the single source of truth. On every load the app
  //    adopts the cloud copy; stale local data never wins.
  //  - Editing requires internet. When offline / cloud unreachable the
  //    app is read-only so a stale local copy can never be pushed back.
  //  - `sessionDirty` is in-memory only (NOT persisted). It is true
  //    only when the user edited during THIS session, after a fresh
  //    cloud load. A persisted/stale dirty flag can never resurrect
  //    old data because we ignore it.
  let online = false;
  let writesAllowed = false;   // gates editing — true only after a fresh cloud pull
  let sessionDirty = false;    // user edited in this session (in-memory, not persisted)
  let lastBlockBanner = 0;

  // ─── Device ID (so we ignore our own remote echoes) ──────────────────────
  let DEVICE_ID = localStorage.getItem(DEVICE_KEY);
  if (!DEVICE_ID) {
    DEVICE_ID = 'd_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    localStorage.setItem(DEVICE_KEY, DEVICE_ID);
  }

  // ─── Status pill (UI) ────────────────────────────────────────────────────
  const pillCSS = `
    .hpms-sync-pill{
      position:fixed;bottom:14px;right:14px;z-index:9999;
      display:inline-flex;align-items:center;gap:8px;
      padding:8px 14px;border-radius:999px;
      font:600 12px/1 'Plus Jakarta Sans', system-ui, sans-serif;
      background:#161d27;color:#e2e8f0;border:1px solid #23303f;
      box-shadow:0 4px 14px -4px rgba(0,0,0,.4);
      cursor:pointer;user-select:none;transition:all .15s;
    }
    .hpms-sync-pill:hover{background:#1f2733;border-color:#334155}
    .hpms-sync-pill .dot{
      width:8px;height:8px;border-radius:50%;background:#64748b;
      box-shadow:0 0 0 0 currentColor;
    }
    .hpms-sync-pill[data-state="synced"]   .dot{background:#10b981}
    .hpms-sync-pill[data-state="syncing"]  .dot{background:#22d3ee;animation:hpmsPulse 1.2s infinite}
    .hpms-sync-pill[data-state="offline"]  .dot{background:#94a3b8}
    .hpms-sync-pill[data-state="readonly"] .dot{background:#f59e0b}
    .hpms-sync-pill[data-state="readonly"]{border-color:#7c5a16;background:#241a08;color:#fbbf24}
    .hpms-sync-pill[data-state="error"]    .dot{background:#ef4444}
    .hpms-sync-pill[data-state="disabled"] .dot{background:#475569}
    @keyframes hpmsPulse{
      0%   {box-shadow:0 0 0 0 rgba(34,211,238,.6)}
      70%  {box-shadow:0 0 0 8px rgba(34,211,238,0)}
      100% {box-shadow:0 0 0 0 rgba(34,211,238,0)}
    }
    .hpms-sync-banner{
      position:fixed;top:14px;left:50%;transform:translateX(-50%);
      z-index:9999;padding:10px 16px;border-radius:10px;
      font:600 13px 'Plus Jakarta Sans',system-ui,sans-serif;
      background:#22d3ee;color:#0a0e14;
      box-shadow:0 8px 24px -8px rgba(0,0,0,.4);
      animation:hpmsSlide .3s ease;
    }
    .hpms-sync-banner.warn{background:#f59e0b;color:#1a1203}
    .hpms-sync-banner.bad {background:#ef4444;color:#fff}
    @keyframes hpmsSlide{from{opacity:0;transform:translate(-50%,-10px)}to{opacity:1;transform:translate(-50%,0)}}
  `;
  const styleEl = document.createElement('style');
  styleEl.textContent = pillCSS;
  document.head.appendChild(styleEl);

  const pill = document.createElement('div');
  pill.className = 'hpms-sync-pill';
  pill.dataset.state = 'offline';
  pill.innerHTML = '<span class="dot"></span><span class="lbl">Loading…</span>';
  pill.title = 'Click for sync options';
  document.addEventListener('DOMContentLoaded', () => document.body.appendChild(pill));

  function setStatus(state, label) {
    pill.dataset.state = state;
    pill.querySelector('.lbl').textContent = label;
  }

  function banner(msg, ms = 2500, tone = '') {
    if (tone === '' && cfg.showRemoteUpdateBanner === false) return;
    const b = document.createElement('div');
    b.className = 'hpms-sync-banner' + (tone ? ' ' + tone : '');
    b.textContent = msg;
    document.body.appendChild(b);
    setTimeout(() => b.remove(), ms);
  }


  pill.addEventListener('click', () => {
    if (!ENABLED) {
      alert(
        'Cloud sync is disabled.\n\n' +
        'To enable: edit config.js and add your Supabase URL, anon key, and workspace code.\n\n' +
        'See README.md for step-by-step setup.'
      );
      return;
    }
    const choice = prompt(
      'HPMS Sync — Workspace: ' + cfg.workspaceCode + '\n' +
      'Cloud-authoritative · online-only\n\n' +
      'Type:\n' +
      '  pull   – reload the latest from the cloud (recommended)\n' +
      '  push   – force-upload THIS device\'s data to the cloud\n' +
      '  info   – show sync status\n' +
      '  (cancel to do nothing)'
    );
    if (!choice) return;
    const c = choice.trim().toLowerCase();
    if (c === 'pull')      { sessionDirty = false; pullFromCloud(true); } // force-take cloud
    else if (c === 'push') pushToCloud(true);
    else if (c === 'info') {
      const meta = readMeta();
      alert(
        'Workspace: ' + cfg.workspaceCode + '\n' +
        'Device ID: ' + DEVICE_ID + '\n' +
        'Last push: ' + (meta.lastPushAt || 'never') + '\n' +
        'Last pull: ' + (meta.lastPullAt || 'never') + '\n' +
        'Mode: cloud-authoritative (online-only)\n' +
        'Editing: ' + (writesAllowed ? 'enabled' : 'read-only — needs internet') + '\n' +
        'Unsaved this session: ' + (sessionDirty ? 'yes' : 'no')
      );
    }
  });

  // ─── Hook localStorage.setItem (online-only gate) ────────────────────────
  // App-state writes are allowed only after a fresh cloud load
  // (writesAllowed). When offline / cloud unreachable the write is
  // dropped so a stale local copy can never be created or pushed back.
  const originalSetItem = localStorage.setItem;
  localStorage.setItem = function (key, value) {
    // Online-only: block app-state writes until we have a fresh cloud
    // copy. This stops a stale local copy from ever being created or
    // pushed back over good cloud data.
    if (key === STORAGE_KEY && ENABLED && !writesAllowed) {
      const now = Date.now();
      if (now - lastBlockBanner > 3500) {
        lastBlockBanner = now;
        banner('Needs internet — connect to load & save the latest. Changes not saved.', 3200, 'warn');
      }
      return; // drop the write; last cloud-loaded data stays on screen
    }
    originalSetItem.call(this, key, value);
    if (key === STORAGE_KEY) {
      sessionDirty = true;
      writeMeta({ localUpdatedAt: Date.now() });
      if (ENABLED) schedulePush();
    }
  };

  if (!ENABLED) {
    // No cloud configured — pure local/offline mode. Still fully editable.
    setStatus('offline', 'Local only (no cloud)');
    document.addEventListener('DOMContentLoaded', () => {
      banner('Cloud not configured — running local-only. Edits are saved on this device.', 4000, 'warn');
    });
    return;
  }

  // ─── Meta bookkeeping ────────────────────────────────────────────────────
  function readMeta() {
    try { return JSON.parse(localStorage.getItem(META_KEY) || '{}'); }
    catch { return {}; }
  }
  function writeMeta(patch) {
    const m = Object.assign(readMeta(), patch);
    localStorage.setItem(META_KEY, JSON.stringify(m));
  }

  // ─── Load Supabase client dynamically ────────────────────────────────────
  function loadSupabase() {
    return new Promise((resolve, reject) => {
      if (window.supabase && window.supabase.createClient) return resolve();
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';
      s.onload = resolve;
      s.onerror = () => reject(new Error('Failed to load Supabase SDK (offline?)'));
      document.head.appendChild(s);
    });
  }

  let client = null;
  let channel = null;

  async function init() {
    // Never trust a persisted dirty/queue flag from a previous session —
    // the cloud is authoritative on load.
    sessionDirty = false;
    writesAllowed = false;
    writeMeta({ dirty: false });

    setStatus('syncing', 'Connecting…');
    try {
      await loadSupabase();
    } catch (e) {
      console.warn('[HPMS Sync] Supabase SDK unavailable — read-only (needs internet)', e);
      online = false; writesAllowed = false;
      setStatus('offline', 'Needs internet — read-only');
      banner('No internet — cannot load the latest. The app is read-only until you reconnect.', 4000, 'bad');
      return;
    }
    client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);

    if (!navigator.onLine) {
      online = false; writesAllowed = false;
      setStatus('offline', 'Needs internet — read-only');
      banner('No internet — read-only. Connect to load & edit the latest data.', 4000, 'bad');
      return;
    }

    const ok = await pullFromCloud(false); // cloud-authoritative adopt
    if (!ok) {
      online = false; writesAllowed = false;
      setStatus('offline', 'Cloud unreachable — read-only');
      banner('Cannot reach the cloud — read-only. Retry when back online.', 4000, 'bad');
      return;
    }
    online = true;
    writesAllowed = true;          // editing enabled now that we have the latest
    subscribe();
    setStatus('synced', 'Synced');
  }

  // ─── Pull from cloud ─────────────────────────────────────────────────────
  async function pullFromCloud(showBanner) {
    if (!client) return false;
    setStatus('syncing', 'Pulling…');
    try {
      const { data, error } = await client
        .from('workspace_state')
        .select('state, updated_at, updated_by')
        .eq('workspace_code', cfg.workspaceCode)
        .maybeSingle();

      if (error) throw error;
      if (!data) {
        // No cloud copy yet (brand-new workspace). Allow the app to
        // seed locally and push that as the initial cloud copy.
        writesAllowed = true;
        writeMeta({ lastPullAt: new Date().toISOString() });
        try { if (typeof window.HPMS_flushSave === 'function') window.HPMS_flushSave(); } catch (_) {}
        await pushToCloud(true);
        return true;
      }

      // Make sure a just-typed edit has reached localStorage so
      // sessionDirty/local comparison is accurate.
      try { if (typeof window.HPMS_flushSave === 'function') window.HPMS_flushSave(); } catch (_) {}

      // CLOUD-AUTHORITATIVE. No wall-clock comparison, no trust of any
      // persisted dirty flag (those caused old data to resurrect):
      //
      //  - sessionDirty === false → this browser session has made NO
      //    edits. Always adopt the cloud copy. A freshly-loaded or
      //    viewing device therefore always shows the latest and can
      //    never push stale local data back over good cloud data.
      //  - sessionDirty === true → the user is editing right now in
      //    this session. Keep their edits and push them (last write
      //    wins by push order). We never overwrite their in-progress
      //    work with the remote copy.
      const remoteStr = typeof data.state === 'string' ? data.state : JSON.stringify(data.state);
      const localStr  = localStorage.getItem(STORAGE_KEY);

      if (!sessionDirty) {
        if (remoteStr !== localStr) {
          originalSetItem.call(localStorage, STORAGE_KEY, remoteStr); // bypass write gate + push loop
          writeMeta({ lastPullAt: new Date().toISOString(), dirty: false });
          if (showBanner) banner('Loaded latest from cloud');
          window.dispatchEvent(new CustomEvent('hpmsDataUpdated'));
        } else {
          writeMeta({ lastPullAt: new Date().toISOString(), dirty: false });
        }
      } else {
        writeMeta({ lastPullAt: new Date().toISOString() });
        schedulePush(); // push this session's edits
      }
      online = true;
      setStatus('synced', 'Synced');
      return true;
    } catch (e) {
      console.warn('[HPMS Sync] Pull failed — read-only (needs internet)', e);
      online = false; writesAllowed = false;
      setStatus('offline', navigator.onLine ? 'Cloud unreachable — read-only' : 'Needs internet — read-only');
      return false;
    }
  }

  // ─── Push to cloud ───────────────────────────────────────────────────────
  let pushTimer = null;
  function schedulePush() {
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(() => pushToCloud(false), cfg.pushDebounceMs || 2000);
  }

  async function pushToCloud(force) {
    if (!client) return;
    // Only push genuine edits made in this session (or an explicit
    // first-run seed). Never push a stale/unedited local copy.
    if (!force && !sessionDirty) { setStatus('synced', 'Synced'); return; }

    if (!navigator.onLine) {
      online = false; writesAllowed = false;
      setStatus('offline', 'Needs internet — read-only');
      banner('No internet — your change was not saved. Reconnect and re-enter it.', 3500, 'bad');
      return;
    }
    setStatus('syncing', 'Saving…');
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      setStatus('synced', 'Synced');
      return;
    }
    let stateObj;
    try { stateObj = JSON.parse(raw); }
    catch { setStatus('error', 'Bad local data'); return; }

    const now = Date.now();
    try {
      const { error } = await client
        .from('workspace_state')
        .upsert(
          {
            workspace_code: cfg.workspaceCode,
            state: stateObj,
            updated_at: new Date(now).toISOString(),
            updated_by: DEVICE_ID
          },
          { onConflict: 'workspace_code' }
        );
      if (error) throw error;
      online = true;
      sessionDirty = false; // pushed — this session's edits are now the cloud truth
      writeMeta({ lastPushAt: new Date(now).toISOString(), localUpdatedAt: now, dirty: false });
      setStatus('synced', 'Synced');
    } catch (e) {
      console.warn('[HPMS Sync] Save failed — needs internet', e);
      online = false; writesAllowed = false;
      setStatus('offline', 'Save failed — needs internet');
      banner('Could not save to the cloud — check your internet and try again.', 3500, 'bad');
    }
  }

  // ─── Realtime subscription ───────────────────────────────────────────────
  function subscribe() {
    if (channel) client.removeChannel(channel);
    channel = client
      .channel('hpms-' + cfg.workspaceCode)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'workspace_state',
          filter: 'workspace_code=eq.' + cfg.workspaceCode
        },
        (payload) => {
          const row = payload.new;
          if (!row) return;
          // Ignore echoes from our own pushes
          if (row.updated_by === DEVICE_ID) return;
          banner('Updates received from another device…');
          setTimeout(() => pullFromCloud(false), 200);
        }
      )
      .subscribe();
  }

  // ─── Online/offline events ───────────────────────────────────────────────
  window.addEventListener('online', async () => {
    if (!client) return init();
    setStatus('syncing', 'Reconnecting…');
    const ok = await pullFromCloud(false); // cloud-authoritative re-adopt
    if (ok) {
      online = true;
      writesAllowed = true;        // editing re-enabled now we have the latest
      if (!channel) subscribe();
      banner('Back online — loaded the latest', 2200);
    }
  });
  window.addEventListener('offline', () => {
    online = false; writesAllowed = false;
    setStatus('offline', 'Needs internet — read-only');
    banner('Offline — read-only. Reconnect to load & edit the latest data.', 3000, 'bad');
  });

  // ─── Always-fresh: pull on focus + periodic poll fallback ────────────────
  // Realtime can silently drop (sleep/wake, flaky Wi-Fi, proxies). These
  // make sure the app still converges to the latest data.

  // (a) When the user returns to the app/tab, grab the latest immediately.
  let lastFocusPull = 0;
  function pullOnFocus() {
    if (!client || !navigator.onLine) return;
    const now = Date.now();
    if (now - lastFocusPull < 3000) return; // de-dupe focus+visibility double fire
    lastFocusPull = now;
    pullFromCloud(false);
    if (!channel) subscribe(); // re-arm realtime if it was lost
  }
  window.addEventListener('focus', pullOnFocus);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) pullOnFocus();
  });

  // (b) Lightweight periodic poll while the tab is visible and online.
  //     Catches updates even if the realtime websocket died.
  const POLL_MS = Math.max(8000, cfg.pollMs || 20000);
  setInterval(() => {
    if (!client || !navigator.onLine) return;
    if (document.hidden) return;          // don't poll a backgrounded tab
    if (sessionDirty) return;             // user is editing now → don't yank it
    pullFromCloud(false);
  }, POLL_MS);

  // ─── Register service worker ─────────────────────────────────────────────
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch((e) => {
        console.warn('[HPMS Sync] SW registration failed', e);
      });
    });
  }

  // ─── Kick off ────────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose for debugging from DevTools
  window.HPMSSync = { pullFromCloud, pushToCloud, readMeta, DEVICE_ID };
})();
