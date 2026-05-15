# HPMS — Progress Tracking System (Offline-First Desktop + Mobile + Cloud Sync)

Your Construction Progress Monitoring System ships three ways from **one codebase**:

- **Web / PWA** — open in a browser, installable from the address bar
- **Desktop app** — Windows `.exe` / `.msi` installer (Electron), fully offline
- **Mobile app** — native Android `.apk` / iOS build (Capacitor)

All three are **cloud-authoritative / online-only**: the cloud (Supabase) is the single source of truth. Every device always **loads the latest** on open and **auto-syncs in real time**. Editing **requires internet** — when offline the app is **read-only**, so a stale local copy can never overwrite good cloud data. Conflict rule: the **last edit pushed wins**.

---

## File map

```
.
├── index.html                ← the app (loads vendored libs, works offline)
├── cpms.html                 ← secondary app view
├── config.js                 ← your Supabase URL + key + workspace code
├── manifest.webmanifest      ← PWA install metadata
├── sw.js                     ← Service Worker (offline app shell, v2)
├── setup.sql                 ← run once in Supabase to create the DB schema
├── package.json              ← Electron + Capacitor build scripts
├── capacitor.config.json     ← mobile (Android/iOS) config
├── app/
│   ├── cloud-sync.js         ← offline-first sync + realtime + status pill
│   └── icon.svg              ← app icon
├── electron/
│   ├── main.js               ← desktop window (loads index.html offline)
│   └── preload.js            ← minimal secure bridge
├── scripts/
│   └── build-web.js          ← assembles ./www for Capacitor (no deps)
├── vendor/                   ← Chart.js + Bootstrap Icons (local = true offline)
└── README.md                 ← this file
```

---

## How it works (90-second tour)

1. **Cloud is the truth.** On every load `cloud-sync.js` fetches the cloud copy and the app shows that — never stale local data. A persisted offline queue from a previous session is ignored (that, plus device-clock comparison, is what used to make old data "come back").
2. **Edit → push.** Edits made in the current session push to Supabase (debounced ~2 s). The device that pushed becomes the new cloud truth.
3. **Realtime pull.** The script subscribes to Postgres changes. When another device pushes, this device pulls within ~1 s. Plus pull-on-focus and a periodic poll so it always converges to the latest.
4. **Online-only.** No internet = **read-only**. Writes are refused (with a clear message) so a divergent local copy can't be created or pushed back later. Reconnect → it reloads the latest and editing re-enables.
5. **Conflict = last push wins.** A device with no edits this session always adopts the cloud copy and never pushes; a device actively editing pushes its change. Whoever pushes last wins the whole document.
6. **Status pill (bottom-right).** `Synced` / `Syncing…` / `Needs internet — read-only`. Click it: `pull` (force-take cloud), `push` (force-upload this device), `info`.

---

## Setup — 4 steps, about 5 minutes

### 1. Create a free Supabase project

1. Go to **https://supabase.com** → **Start your project** → sign in with GitHub or email.
2. Click **New project**. Pick a name (e.g. `hpms`), set a strong DB password, choose the nearest region.
3. Wait ~2 minutes for it to provision.

### 2. Run the SQL schema

1. In your project dashboard, click **SQL Editor** (left sidebar) → **+ New query**.
2. Open [`setup.sql`](setup.sql) from this folder, copy its entire contents, paste into the editor.
3. Click **Run**. You should see "Success. No rows returned."

### 3. Get your API credentials

1. Left sidebar → **Project Settings** (gear icon) → **API**.
2. Copy two values:
   - **Project URL** — looks like `https://abcdefghijkl.supabase.co`
   - **anon public** key — long string starting with `eyJ...`

### 4. Paste credentials into `config.js`

Open [`config.js`](config.js) and fill in:

```js
window.HPMS_CONFIG = {
  supabaseUrl:     'https://abcdefghijkl.supabase.co',
  supabaseAnonKey: 'eyJhbGciOi...your...long...key...',
  workspaceCode:   'my-project-2026',  // pick anything — your team's "shared secret"
  pushDebounceMs:  2000,
  showRemoteUpdateBanner: true
};
```

Done. Open `index.html` — the bottom-right pill should turn green and say **Synced**.

---

## Desktop app (Windows .exe / .msi) — Electron

The desktop build wraps the same `index.html` and runs **fully offline** (all assets, including Chart.js and icons, are bundled — no CDN needed).

### Prerequisites
- [Node.js](https://nodejs.org) LTS (18+). Verify: `node -v` and `npm -v`.

### Run in development
```powershell
npm install            # first time only — pulls Electron
npm start              # opens the app in a desktop window
```

### Build the installer
```powershell
npm run dist:win       # builds NSIS .exe + .msi into dist-desktop/
# or:
npm run dist:portable  # single portable .exe (no install)
```

Output lands in **`dist-desktop/`**:
- `HPMS Setup <version>.exe` — double-click to install (Start-menu + desktop shortcut)
- `HPMS <version>.msi` — for managed/IT deployment
- portable `.exe` — runs without installing

> macOS/Linux: `npx electron-builder --mac` or `--linux` (config already included).

The desktop app keeps the **same workspace** as the web/mobile — it reads `config.js`, so set your Supabase credentials there before building (or edit `config.js` and rebuild).

---

## Mobile app (Android / iOS) — Capacitor

### Prerequisites
- Node.js LTS
- **Android:** [Android Studio](https://developer.android.com/studio) (gives you the SDK + emulator)
- **iOS:** a Mac with **Xcode** (Apple requirement — iOS apps can't be built on Windows)

### One-time setup
```powershell
npm install
npm run cap:init        # builds ./www and adds android + ios platforms
```
(Use `npm run cap:add:android` alone if you only need Android.)

### Build / run
```powershell
npm run cap:sync        # rebuild ./www and copy into native projects
npm run cap:android     # opens Android Studio → press Run for emulator/device
npm run cap:ios         # opens Xcode (macOS only) → press Run
```

To produce a shippable file:
- **Android:** in Android Studio → *Build → Build Bundle(s)/APK(s) → Build APK* → `app-debug.apk` (or a signed release for the Play Store).
- **iOS:** in Xcode → *Product → Archive* → distribute via TestFlight/App Store.

After **any** change to `index.html` / `app/` / `vendor/`, re-run `npm run cap:sync` so the native app picks it up.

> The mobile app uses the same offline-first sync. Open it on a phone, leave it on the **Dashboard** — it updates live as the desktop/web edits flow in.

---

## Hosting online (so others can access it)

The folder is just static files. Drop it on any static host. Easiest free options:

### Option A — Netlify Drop (zero config)
1. Zip this folder.
2. Go to https://app.netlify.com/drop and drag the zip in.
3. You get a public URL instantly (e.g. `https://hpms-abc123.netlify.app`).

### Option B — Vercel
1. Push this folder to a GitHub repo.
2. https://vercel.com → **Add New… → Project** → import the repo.
3. Click **Deploy**. Done.

### Option C — GitHub Pages
1. Push to a GitHub repo.
2. Repo **Settings** → **Pages** → Source = `main` branch, `/ (root)`.
3. URL: `https://<user>.github.io/<repo>/`.

### Option D — Local network only (no internet hosting)
Just open `index.html` directly, or run a tiny local server so the Service Worker works:

```powershell
# Python (already on most machines)
python -m http.server 8000

# Or Node.js
npx serve .
```

Then open `http://localhost:8000`.

> **Important:** Service Workers only register on `http://localhost` or `https://` URLs — not `file://`. Use a local server during development.

---

## Using the app online + offline

| Scenario | What happens |
|---|---|
| **Open the app (online)** | Always loads the **latest** from Supabase — never stale local data |
| **Lose internet mid-use** | Pill shows "Needs internet — read-only". Editing is disabled until you reconnect, so nothing diverges. Last loaded data stays on screen to view. |
| **Reconnect** | Pill pulses "Syncing…", reloads the latest, editing re-enables |
| **Another teammate edits on their device** | You get a banner and the app refreshes to their version within ~1 s |
| **You edit & save (online)** | Pushes to the cloud immediately; every other device converges to it |
| **Two devices edit at once** | Whoever's edit is **pushed last** wins the whole document |
| **No internet at all** | App is read-only. It will not run on or push old local data — by design |

---

## Sharing the workspace with collaborators

Everyone uses the **same `workspaceCode`** in their `config.js`. That's the only thing they need to share. The Supabase URL and anon key can be the same (they're public-facing by design).

To create a separate workspace (e.g. a different project), change `workspaceCode` to something new — Supabase auto-creates the row on first push.

---

## Backup / restore

The app's existing **Export** button still exports a JSON file of the whole state. To restore on a fresh device:
1. Set your `workspaceCode` to a fresh value (so you don't overwrite a shared workspace).
2. Use the **Import** button.
3. The first push will seed your cloud copy.

You can also back up directly from Supabase: **Table Editor → workspace_state → export to CSV**.

---

## Security notes for v1

- Anyone who learns your `workspaceCode` + has the anon key (which is shipped in `config.js`, i.e. public) can read/write the workspace.
- This is **fine for trusted teams** keeping the code private.
- For stricter access control, enable Supabase Auth and switch to the user-scoped RLS policies described at the bottom of [`setup.sql`](setup.sql).

---

## Troubleshooting

**Pill says "Local only"**
→ `config.js` is missing values. Fill in `supabaseUrl`, `supabaseAnonKey`, and `workspaceCode`.

**Pill says "Push failed" but you're online**
→ Open DevTools (F12) → Console. Usually one of:
  - Wrong URL or anon key in `config.js`
  - You forgot to run `setup.sql`
  - RLS is blocking — re-run the policy section of `setup.sql`

**Service Worker doesn't register**
→ You're opening via `file://` in a browser. Use a local server (see "Option D" above). Note: the **desktop and mobile apps don't need the Service Worker** — their assets are bundled, so they're offline by default.

**Charts/icons missing offline**
→ Make sure the `vendor/` folder shipped with the app (it holds Chart.js + Bootstrap Icons locally). For the desktop/mobile builds it's bundled automatically; for the PWA it's cached by `sw.js` (v2).

**Two devices not syncing in real time**
→ Realtime needs to be enabled on the table. The last line of `setup.sql` does this — make sure that statement ran successfully. Re-run it if unsure.

**A device pulled an OLD version / my update got overwritten by another device**
→ Fixed. The conflict rule no longer compares device clocks (unreliable across devices — that caused stale data to "win"). It now uses the **dirty flag**: a device with **no unpushed edits always adopts the cloud copy** and never pushes stale data back; a device **with** unpushed edits keeps and pushes them (last-write-wins by push order). If a device still shows something old, click the sync pill → type `pull` to force-take the cloud copy, or `push` from the device that has the correct data.

**Both devices edited the same workspace at the same time**
→ Whichever device's edit is pushed *last* wins the whole document (last-write-wins, as chosen). To avoid losing work, have one device finish and sync (pill = "Synced") before another starts editing offline.

---

## Extending

- **Per-record sync** (instead of one-document) — replace the JSONB column with proper tables (`projects`, `logs`, `ipcs`, etc.) and PowerSync. Bigger lift, better for huge datasets.
- **Login + permissions** — switch on Supabase Auth, add the `workspace_members` table from `setup.sql`, gate policies on `auth.uid()`.
- **Conflict resolution** — current strategy is **last-write-wins on the whole document** (whoever syncs last wins). For finer-grained collaborative editing, consider per-field timestamps or CRDTs.

---

## Where to ask for help

- Supabase docs: https://supabase.com/docs
- Realtime guide: https://supabase.com/docs/guides/realtime
- PWA manifest reference: https://developer.mozilla.org/en-US/docs/Web/Manifest
