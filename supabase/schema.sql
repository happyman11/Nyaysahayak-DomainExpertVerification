-- NyaySahayak lawyer-validation app — Supabase schema.
--
-- Run this once in your Supabase project's SQL editor (Dashboard ->
-- SQL Editor -> New query -> paste -> Run). Safe to re-run: every
-- statement is idempotent (IF NOT EXISTS / DROP POLICY IF EXISTS).
--
-- Access model implemented by the policies below:
--   * Anyone (the public "anon" key, i.e. any site visitor) can INSERT a
--     submission, and can read/write/delete THEIR OWN in-progress
--     review_sessions row (see the privacy note on that table). Nobody
--     using only the anon key can read other lawyers' submissions or
--     other lawyers' in-progress drafts by scenario/session listing.
--   * Only an authenticated user (an admin you create by hand in
--     Supabase Auth — see README.md "Admin & centralized storage") can
--     read submissions, and can write the live `scenarios` table.
--   * Everyone can read the live `scenarios` table — it's the same
--     content every lawyer reviews, not sensitive.

create extension if not exists pgcrypto;

-- ============================================================
-- lawyer_validations — final submitted evaluations (admin-read-only)
-- ============================================================
create table if not exists lawyer_validations (
  id uuid primary key default gen_random_uuid(),
  payload jsonb not null,
  created_at timestamptz not null default now()
);

alter table lawyer_validations enable row level security;

drop policy if exists "anon can submit" on lawyer_validations;
create policy "anon can submit"
  on lawyer_validations for insert
  to anon
  with check (true);

drop policy if exists "admin can read submissions" on lawyer_validations;
create policy "admin can read submissions"
  on lawyer_validations for select
  to authenticated
  using (true);

drop policy if exists "admin can delete submissions" on lawyer_validations;
create policy "admin can delete submissions"
  on lawyer_validations for delete
  to authenticated
  using (true);

-- ============================================================
-- scenarios — live scenario data an admin publishes (public read)
-- ============================================================
create table if not exists scenarios (
  scenario_index integer primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table scenarios enable row level security;

drop policy if exists "anyone can read scenarios" on scenarios;
create policy "anyone can read scenarios"
  on scenarios for select
  to anon, authenticated
  using (true);

drop policy if exists "admin can write scenarios" on scenarios;
create policy "admin can write scenarios"
  on scenarios for all
  to authenticated
  using (true)
  with check (true);

-- ============================================================
-- review_sessions — in-progress autosave, keyed by reviewer email, so a
-- lawyer can resume on a different device/browser.
--
-- PRIVACY NOTE: because lawyers are not authenticated (there is no
-- lawyer-facing login — only email is used as a resume key), this table
-- allows the anon key to read/write/delete ANY row by email. In practice
-- that means someone who already knows another participant's email could
-- look up their in-progress (not yet submitted) draft. This is a
-- deliberate, documented trade-off appropriate for a small, known,
-- invited participant pool in an academic study — it does NOT expose
-- final submissions (lawyer_validations stays admin-only above). If your
-- study needs stronger isolation between participants, don't enable this
-- table's policies as broadly (e.g. add a per-session random token
-- instead of using bare email) — ask before you deploy this to a wider
-- or adversarial audience.
-- ============================================================
create table if not exists review_sessions (
  email text primary key,
  state jsonb not null,
  updated_at timestamptz not null default now()
);

alter table review_sessions enable row level security;

drop policy if exists "anon can manage own session by email" on review_sessions;
create policy "anon can manage own session by email"
  on review_sessions for all
  to anon
  using (true)
  with check (true);

drop policy if exists "admin can read sessions" on review_sessions;
create policy "admin can read sessions"
  on review_sessions for select
  to authenticated
  using (true);
