# HPMS — Progress Tracking System (Offline + Cloud Sync)

Your existing Construction Progress Monitoring System, now with:

- **Works offline** — full functionality with no internet (Service Worker + localStorage)
- **Real-time cloud sync** — when online, changes push to Supabase and propagate to other devices instantly
- **Installable as an app** — Chrome/Edge users can "Install app" from the address bar
- **Zero code changes to the original app** — sync hooks `localStorage` transparently

---

## File map

```
.
├── index.html                ← your existing HPMS app + 4 lines of sync glue
├── cpms.html                 ← your existing CPMS app + 4 lines of sync glue
├── config.js                 ← put your Supabase URL + key here
├── manifest.webmanifest      ← PWA install metadata
├── sw.js                     ← Service Worker (offline app shell)
├── setup.sql                 ← run this in Supabase to create the DB schema
├── app/
│   ├── cloud-sync.js         ← the brain: sync + realtime + status pill
│   └── icon.svg              ← app icon
└── README.md                 ← this file
```

---

## How it works (90-second tour)

1. **Local first.** The app reads and writes `localStorage` exactly as it always did. Nothing about the original UI logic changed.
2. **Transparent push.** `cloud-sync.js` overrides `localStorage.setItem`. Every save schedules a debounced push to Supabase (default 2 s).
3. **Realtime pull.** The script subscribes to Postgres changes on your workspace row. When *another* device pushes, this device gets a banner ("Updates received…") and reloads with the fresh data.
4. **Offline queue.** No network? Pushes are marked dirty and retried when `online` fires. The Service Worker means the app still loads.
5. **Status pill (bottom-right).** Shows `Synced` / `Syncing…` / `Offline` / `Local only`. Click it to manually pull, push, or see sync info.

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
| **Open the app the first time online** | Pulls existing workspace data from Supabase (if any), caches the app shell |
| **Lose internet mid-use** | Pill goes grey "Offline". You keep working normally. Saves are queued. |
| **Reconnect** | Pill pulses "Syncing…", queued changes push, then settles "Synced" |
| **Another teammate edits on their device** | You get a banner "Updates received…" and the app refreshes within ~1 s |
| **Install as an app** | In Chrome/Edge: address bar shows an install icon. Now it opens in its own window like a desktop app |
| **Open offline next time** | App shell loads from cache; your local data is still in `localStorage` |

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
→ You're opening via `file://`. Use a local server (see "Option D" above).

**Two devices not syncing in real time**
→ Realtime needs to be enabled on the table. The last line of `setup.sql` does this — make sure that statement ran successfully. Re-run it if unsure.

**App still has my old test data after pulling**
→ The pull only overwrites if the cloud copy is *newer* than your local copy. To force-overwrite local with cloud, click the sync pill → type `pull`.

---

## Extending

- **Per-record sync** (instead of one-document) — replace the JSONB column with proper tables (`projects`, `logs`, `ipcs`, etc.) and PowerSync. Bigger lift, better for huge datasets.
- **Login + permissions** — switch on Supabase Auth, add the `workspace_members` table from `setup.sql`, gate policies on `auth.uid()`.
- **Conflict resolution** — current strategy is last-write-wins on the whole doc. For collaborative editing, consider per-field timestamps or CRDTs.

---

## Where to ask for help

- Supabase docs: https://supabase.com/docs
- Realtime guide: https://supabase.com/docs/guides/realtime
- PWA manifest reference: https://developer.mozilla.org/en-US/docs/Web/Manifest
