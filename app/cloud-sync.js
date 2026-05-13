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

  function banner(msg, ms = 2500) {
    if (cfg.showRemoteUpdateBanner === false) return;
    const b = document.createElement('div');
    b.className = 'hpms-sync-banner';
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

  if (!ENABLED) {
    setStatus('disabled', 'Local only');
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
      console.warn('[HPMS Sync] Supabase SDK unavailable — offline mode', e);
      setStatus('offline', 'Offline');
      return;
    }
    client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);

    await pullFromCloud(false); // initial pull
    subscribe();
    hookLocalStorage();

    setStatus(navigator.onLine ? 'synced' : 'offline', navigator.onLine ? 'Synced' : 'Offline');
    flushQueueIfDirty();
  }

  // ─── Pull from cloud ─────────────────────────────────────────────────────
  async function pullFromCloud(showBanner) {
    if (!client) return;
    setStatus('syncing', 'Pulling…');
    try {
      const { data, error } = await client
        .from('workspace_state')
        .select('state, updated_at, updated_by')
        .eq('workspace_code', cfg.workspaceCode)
        .maybeSingle();

      if (error) throw error;
      if (!data) {
        // No cloud copy yet — push our local state as the initial seed
        writeMeta({ lastPullAt: new Date().toISOString() });
        await pushToCloud(false);
        return;
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
    } catch (e) {
      console.warn('[HPMS Sync] Pull failed', e);
      setStatus(navigator.onLine ? 'error' : 'offline', navigator.onLine ? 'Pull failed' : 'Offline');
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
      writeMeta({ dirty: true });
      setStatus('offline', 'Offline (queued)');
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
      setStatus('error', 'Push failed (queued)');
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

  // ─── Hook localStorage so saves auto-push ────────────────────────────────
  const originalSetItem = localStorage.setItem;
  function hookLocalStorage() {
    localStorage.setItem = function (key, value) {
      originalSetItem.call(this, key, value);
      if (key === STORAGE_KEY) {
        writeMeta({ localUpdatedAt: Date.now(), dirty: true });
        schedulePush();
      }
    };
  }

  // ─── Online/offline events ───────────────────────────────────────────────
  window.addEventListener('online', () => {
    setStatus('syncing', 'Reconnecting…');
    flushQueueIfDirty();
  });
  window.addEventListener('offline', () => {
    setStatus('offline', 'Offline');
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
