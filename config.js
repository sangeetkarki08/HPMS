/*
  HPMS Cloud Sync Configuration
  ─────────────────────────────
  Fill in your Supabase project URL and ANON key below.
  See README.md for step-by-step setup instructions.

  If you leave these blank, the app still works fully offline
  using localStorage — but no cloud sync will happen.
*/
window.HPMS_CONFIG = {
  // From Supabase Dashboard → Project Settings → API
  supabaseUrl: 'https://vhtsuoorhtrwujdmvpxh.supabase.co',
  supabaseAnonKey: 'sb_publishable_k_kzSjkn2SpZ4nRp3LNwFA_K8zgFAod',

  // Workspace = the shared project. Anyone with this code sees the same data.
  // Keep it secret — share only with collaborators.
  workspaceCode: 'my-project-2026',

  // How often to push local changes to the cloud (milliseconds).
  // Lower = more "real time", but more requests. 2000ms is a good default.
  pushDebounceMs: 2000,

  // Show a banner when remote changes arrive (otherwise applies silently)
  showRemoteUpdateBanner: true
};
