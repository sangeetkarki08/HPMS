-- ============================================================
-- HPMS — Supabase Schema (run this once in Supabase SQL editor)
-- ============================================================
-- This creates a single table that stores the entire app state
-- as one JSONB document per workspace. Anyone with the same
-- workspace_code shares the same data.
--
-- For v1, RLS allows anonymous reads/writes — fine for trusted
-- teams that keep their workspace_code private. For stricter
-- security, see the optional "AUTH" section at the bottom.
-- ============================================================

-- Enable the extension Supabase uses for UUIDs (usually already on)
create extension if not exists pgcrypto;

-- One row per shared workspace.
create table if not exists public.workspace_state (
  workspace_code text primary key,
  state          jsonb       not null default '{}'::jsonb,
  updated_at     timestamptz not null default now(),
  updated_by     text        not null default ''
);

-- Bump updated_at automatically (in case the client forgets).
create or replace function public.touch_workspace_state()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_touch_workspace_state on public.workspace_state;
create trigger trg_touch_workspace_state
  before update on public.workspace_state
  for each row execute function public.touch_workspace_state();

-- Enable Row Level Security
alter table public.workspace_state enable row level security;

-- Anyone with the anon key can read and write.
-- (Keep your workspace_code private — it acts as the "password".)
drop policy if exists "anon read"  on public.workspace_state;
drop policy if exists "anon write" on public.workspace_state;
drop policy if exists "anon update" on public.workspace_state;

create policy "anon read"   on public.workspace_state
  for select using (true);

create policy "anon write"  on public.workspace_state
  for insert with check (true);

create policy "anon update" on public.workspace_state
  for update using (true) with check (true);

-- Add this table to the realtime publication so the app gets
-- live updates when other devices push changes.
alter publication supabase_realtime add table public.workspace_state;

-- ============================================================
-- OPTIONAL — Stricter security with Supabase Auth
-- ============================================================
-- If you want only logged-in users to access workspaces, replace
-- the policies above with these and add a workspace_members table:
--
-- create table public.workspace_members (
--   workspace_code text not null,
--   user_id        uuid not null references auth.users(id) on delete cascade,
--   role           text not null default 'editor',
--   primary key (workspace_code, user_id)
-- );
-- alter table public.workspace_members enable row level security;
-- create policy "members can read self"
--   on public.workspace_members for select
--   using (user_id = auth.uid());
--
-- Then replace the policies on workspace_state with:
-- create policy "members read" on public.workspace_state
--   for select using (
--     exists (select 1 from public.workspace_members m
--             where m.workspace_code = workspace_state.workspace_code
--               and m.user_id = auth.uid())
--   );
-- (similar for insert/update — left as an exercise.)
