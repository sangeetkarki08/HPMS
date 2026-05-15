/*
  HPMS Electron Main Process
  ──────────────────────────
  Wraps the existing index.html as an offline-first desktop app.

  Why loadFile (file://) and no bundled server:
    - All app assets ship inside the installer, so the app works
      fully offline by definition — the service-worker cache that
      the browser PWA needs is redundant here.
    - Supabase REST + Realtime (WebSocket) work fine from file://
      with the anon key, so cloud sync still runs when online.

  The renderer keeps using localStorage exactly as before;
  app/cloud-sync.js handles the offline-first Supabase sync.
*/

const { app, BrowserWindow, shell, Menu } = require('electron');
const path = require('path');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: '#0a0e14',
    title: 'HPMS — Progress Tracking System',
    icon: path.join(__dirname, '..', 'app', 'icon.svg'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Renderer only loads our local files + talks to Supabase over https/wss.
      sandbox: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'index.html'));

  // Open external links (e.g. docs, Supabase) in the system browser,
  // never inside the app window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// Minimal native menu so clipboard / reload / devtools shortcuts work.
function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    { role: 'windowMenu' }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  buildMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
