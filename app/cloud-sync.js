/*
  HPMS Cloud Sync
  ───────────────
  Offline-first sync layer. The existing app keeps writing to
  localStorage as it always has; this script transparently:

    1. Pushes localStorage changes to Supabase (debounced)
    2. Subscribes to remote changes via Supabase Realtime
    3. Applies remote changes to localStorage and reloads
    4. Queues pushes when offline, retries on reconnect

  The app needs ZERO source changes. We hook localStorage.setItem.

  Status UI:
    - A small pill in the bottom-right shows: Offline / Synced / Syncing / Error
    - Click it to force a pull, see workspace info, or change workspace
*/

(function () {
  'use strict';

  const STORAGE_KEY = 'hpms_data_v2';            // same key the app uses
  const META_KEY    = 'hpms_sync_meta_v1';        // our own bookkeeping
  const DEVICE_KEY  = 'hpms_device_id_v1';

  const cfg = window.HPMS_CONFIG || {};
  const ENABLED = !!(cfg.supabaseUrl && cfg.supabaseAnonKey && cfg.workspaceCode);

  // Cloud-only mode: app starts read-only until the first cloud pull succeeds.
  // Writes are gated by `writesAllowed`. Offline / failed sync = read-only.
  let writesAllowed = false;
  let lastReadOnlyBanner = 0;

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

  function flashReadOnly(reason) {
    const now = Date.now();
    if (now - lastReadOnlyBanner < 4000) return;
    lastReadOnlyBanner = now;
    banner('Read-only: ' + reason + ' — changes not saved', 3200, 'warn');
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
      'HPMS Sync — Workspace: ' + cfg.workspaceCode + '\n\n' +
      'Type:\n' +
      '  pull   – overwrite local data with cloud version\n' +
      '  push   – overwrite cloud with local version\n' +
      '  info   – show last sync time\n' +
      '  (cancel to do nothing)'
    );
    if (!choice) return;
    const c = choice.trim().toLowerCase();
    if (c === 'pull')      pullFromCloud(true);
    else if (c === 'push') pushToCloud(true);
    else if (c === 'info') {
      const meta = readMeta();
      alert(
        'Workspace: ' + cfg.workspaceCode + '\n' +
        'Device ID: ' + DEVICE_ID + '\n' +
        'Last push: ' + (meta.lastPushAt || 'never') + '\n' +
        'Last pull: ' + (meta.lastPullAt || 'never') + '\n' +
        'Dirty: ' + (meta.dirty ? 'yes (queued)' : 'no')
      );
    }
  });

  // ─── Install write-blocker IMMEDIATELY ───────────────────────────────────
  // Writes start disabled and only open up after a successful initial cloud
  // pull. This guarantees the app is read-only until we know we're online
  // AND in sync with the cloud. We hook setItem here (before init) so even
  // the earliest save() call from the page is intercepted.
  const originalSetItem = localStorage.setItem;
  localStorage.setItem = function (key, value) {
    if (key === STORAGE_KEY && !writesAllowed) {
      flashReadOnly(navigator.onLine ? 'cloud not reachable' : 'offline');
      return; // silently drop — last-known data stays visible
    }
    originalSetItem.call(this, key, value);
    if (key === STORAGE_KEY) {
      writeMeta({ localUpdatedAt: Date.now(), dirty: true });
      schedulePush();
    }
  };

  if (!ENABLED) {
    setStatus('readonly', 'Read-only (no cloud config)');
    document.addEventListener('DOMContentLoaded', () => {
      banner('Cloud not configured — app is read-only. Fill config.js to enable saving.', 5000, 'bad');
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
    setStatus('syncing', 'Connecting…');
    try {
      await loadSupabase();
    } catch (e) {
      console.warn('[HPMS Sync] Supabase SDK unavailable — read-only', e);
      setStatus('readonly', 'Offline — read-only');
      banner('Cannot reach Supabase SDK — read-only mode.', 3500, 'bad');
      return;
    }
    client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);

    if (!navigator.onLine) {
      setStatus('readonly', 'Offline — read-only');
      banner('Offline — read-only mode. Reconnect to save changes.', 3500, 'warn');
      return;
    }

    const ok = await pullFromCloud(false); // initial pull — gates writesAllowed
    if (!ok) {
      setStatus('readonly', 'Cloud unreachable — read-only');
      banner('Cloud unreachable — read-only mode. Changes will not save.', 3500, 'bad');
      return;
    }
    subscribe();

    writesAllowed = true;
    setStatus('synced', 'Synced');
    flushQueueIfDirty();
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
        // No cloud copy yet — push our local state as the initial seed.
        // Temporarily allow the seed push so the workspace row gets created.
        writeMeta({ lastPullAt: new Date().toISOString() });
        const prev = writesAllowed;
        writesAllowed = true;
        await pushToCloud(false);
        writesAllowed = prev;
        return true;
      }

      const remoteAt = new Date(data.updated_at).getTime();
      const localAt  = parseInt(readMeta().localUpdatedAt || '0', 10);

      // If remote is strictly newer than local — apply it
      if (remoteAt > localAt) {
        const stateStr = typeof data.state === 'string' ? data.state : JSON.stringify(data.state);
        // Bypass our own setItem hook so this doesn't trigger a push loop
        originalSetItem.call(localStorage, STORAGE_KEY, stateStr);
        writeMeta({ lastPullAt: new Date().toISOString(), localUpdatedAt: remoteAt, dirty: false });
        if (showBanner) banner('Pulled latest from cloud — reloading…');
        // Dispatch event to update UI without reload
        window.dispatchEvent(new CustomEvent('hpmsDataUpdated'));
      } else {
        writeMeta({ lastPullAt: new Date().toISOString() });
      }
      setStatus('synced', 'Synced');
      return true;
    } catch (e) {
      console.warn('[HPMS Sync] Pull failed', e);
      writesAllowed = false;
      setStatus(navigator.onLine ? 'readonly' : 'offline', navigator.onLine ? 'Cloud unreachable — read-only' : 'Offline — read-only');
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
    if (!navigator.onLine) {
      writesAllowed = false;
      setStatus('readonly', 'Offline — read-only');
      return;
    }
    setStatus('syncing', 'Pushing…');
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
      writeMeta({ lastPushAt: new Date(now).toISOString(), localUpdatedAt: now, dirty: false });
      setStatus('synced', 'Synced');
    } catch (e) {
      console.warn('[HPMS Sync] Push failed', e);
      writeMeta({ dirty: true });
      writesAllowed = false;
      setStatus('readonly', 'Push failed — read-only');
      banner('Cloud push failed — switching to read-only', 3000, 'bad');
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
    const ok = await pullFromCloud(false);
    if (ok) {
      writesAllowed = true;
      setStatus('synced', 'Synced');
      banner('Back online — saving enabled', 2200);
      if (!channel) subscribe();
      flushQueueIfDirty();
    }
  });
  window.addEventListener('offline', () => {
    writesAllowed = false;
    setStatus('readonly', 'Offline — read-only');
    banner('Offline — read-only. Changes will not save.', 3000, 'warn');
  });

  function flushQueueIfDirty() {
    if (readMeta().dirty) pushToCloud(false);
    else if (client) pullFromCloud(false);
  }

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
