/*
  HPMS Electron Preload
  ─────────────────────
  Intentionally minimal. The app is a self-contained web app that
  only needs localStorage + fetch/WebSocket (for Supabase). We expose
  a tiny, read-only marker so the renderer can detect it is running
  inside the desktop shell if it ever needs to (e.g. for UI tweaks).

  No Node APIs are exposed to the renderer (contextIsolation + sandbox).
*/

const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('HPMS_DESKTOP', {
  isDesktop: true,
  platform: process.platform,
  version: process.versions.electron
});
