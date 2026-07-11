# HPMS — Simple Hydropower Progress Tracking

A lightweight, single-page web app for tracking day-to-day construction progress
on a hydropower project. Site staff log daily progress against a component
list; the dashboard shows planned vs. actual completion with traffic-light
status, so management can spot delayed components at a glance.

It's intentionally **not** a scheduling tool (no Gantt charts, no critical
path) — it's a simple progress log and dashboard, meant to take a couple of
minutes a day to update.

## What it does

- **Dashboard** — overall progress, a progress trend chart, and a component
  table (Planned % / Actual % / Status: On Track, Minor Delay, Delayed).
- **Components** — add/edit/remove the project's construction components and
  set each one's planned % complete.
- **Daily Entries** — log what was done each day per component: quantity,
  unit, cumulative % complete, and remarks. The log is grouped by date and
  filterable by component.
- **Export / Import** — back up or restore all data as a `.json` file.
- **Cloud sync (optional)** — if configured, data syncs live across devices
  via Supabase so a director's phone and a site engineer's laptop see the
  same numbers. Without it configured, everything still works, saved locally
  in the browser.

## File map

```
.
├── index.html                ← the whole app
├── config.js                 ← Supabase URL + key + workspace code (optional)
├── manifest.webmanifest      ← PWA install metadata
├── sw.js                     ← Service Worker (offline app shell)
├── setup.sql                 ← run once in Supabase to create the DB schema
├── app/
│   ├── cloud-sync.js         ← offline-aware cloud sync + status pill
│   └── icon.svg              ← app icon
├── vendor/                   ← Chart.js + Bootstrap Icons (bundled, no CDN)
└── README.md
```

## Running it

Just open `index.html` in a browser — no build step, no dependencies. For the
Service Worker (offline support) to register, serve it over `http://` instead
of `file://`:

```powershell
npx serve .
```

Then open the printed `http://localhost:...` URL.

## Cloud sync setup (optional, ~5 minutes)

Without this, the app works fully offline using your browser's local storage
(single device only). To sync across devices/team members:

1. Create a free project at [supabase.com](https://supabase.com).
2. Supabase dashboard → **SQL Editor** → paste the contents of
   [`setup.sql`](setup.sql) → **Run**.
3. Supabase dashboard → **Project Settings → API** → copy the **Project URL**
   and **anon public** key.
4. Paste them into [`config.js`](config.js):

```js
window.HPMS_CONFIG = {
  supabaseUrl:     'https://xxxxx.supabase.co',
  supabaseAnonKey: 'eyJ...',
  workspaceCode:   'my-project-2026',   // shared "password" for your team
  pushDebounceMs:  2000,
  showRemoteUpdateBanner: true
};
```

Everyone who uses the same `workspaceCode` shares the same data. Reload the
page — the sync pill (bottom-right) should turn green and say **Synced**.

**Note:** the anon key is meant to be public (it ships in the page); access
is controlled by keeping `workspaceCode` private to your team. Change it from
the default before sharing the app.

## Hosting

The app is static files — host it anywhere:

- **GitHub Pages** — repo **Settings → Pages** → source = `main` / `(root)`.
- **Netlify / Vercel** — import the repo, deploy with no build command.
- **Local network** — `npx serve .` on one machine, others open its IP.

## Backup / restore

Use the **export/import icons** in the header to download or restore a
`.json` snapshot of all project data.
