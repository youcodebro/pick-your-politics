-- RLS policies for the decided PYP schema:
-- users, sessions, responses, questions, share_links, subscriptions, stripe_webhook_events
--
-- Run this after the table-name migration has completed.
-- Admin access is controlled by Supabase auth app_metadata:
--   {"role":"admin"}

create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin';
$$;

alter table public.users enable row level security;
alter table public.sessions enable row level security;
alter table public.responses enable row level security;
alter table public.questions enable row level security;
alter table public.share_links enable row level security;
alter table public.subscriptions enable row level security;
alter table public.stripe_webhook_events enable row level security;

-- USERS
drop policy if exists "users own read" on public.users;
create policy "users own read"
on public.users
for select
using (auth.uid() = id or public.is_admin());

drop policy if exists "users own insert" on public.users;
create policy "users own insert"
on public.users
for insert
with check (auth.uid() = id or public.is_admin());

drop policy if exists "users own update" on public.users;
create policy "users own update"
on public.users
for update
using (auth.uid() = id or public.is_admin())
with check (auth.uid() = id or public.is_admin());

-- SESSIONS
drop policy if exists "sessions own read" on public.sessions;
create policy "sessions own read"
on public.sessions
for select
using (auth.uid() = user_id or public.is_admin());

drop policy if exists "sessions own insert" on public.sessions;
create policy "sessions own insert"
on public.sessions
for insert
with check (auth.uid() = user_id or public.is_admin());

drop policy if exists "sessions own update" on public.sessions;
create policy "sessions own update"
on public.sessions
for update
using (auth.uid() = user_id or public.is_admin())
with check (auth.uid() = user_id or public.is_admin());

drop policy if exists "sessions own delete" on public.sessions;
create policy "sessions own delete"
on public.sessions
for delete
using (auth.uid() = user_id or public.is_admin());

-- RESPONSES
drop policy if exists "responses own read" on public.responses;
create policy "responses own read"
on public.responses
for select
using (auth.uid() = user_id or public.is_admin());

drop policy if exists "responses own insert" on public.responses;
create policy "responses own insert"
on public.responses
for insert
with check (auth.uid() = user_id or public.is_admin());

drop policy if exists "responses own update" on public.responses;
create policy "responses own update"
on public.responses
for update
using (auth.uid() = user_id or public.is_admin())
with check (auth.uid() = user_id or public.is_admin());

drop policy if exists "responses own delete" on public.responses;
create policy "responses own delete"
on public.responses
for delete
using (auth.uid() = user_id or public.is_admin());

-- QUESTIONS
drop policy if exists "questions public active read" on public.questions;
create policy "questions public active read"
on public.questions
for select
using (is_active = true or public.is_admin());

drop policy if exists "questions admin insert" on public.questions;
create policy "questions admin insert"
on public.questions
for insert
with check (public.is_admin());

drop policy if exists "questions admin update" on public.questions;
create policy "questions admin update"
on public.questions
for update
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "questions admin delete" on public.questions;
create policy "questions admin delete"
on public.questions
for delete
using (public.is_admin());

-- SHARE LINKS
drop policy if exists "share links public read" on public.share_links;
create policy "share links public read"
on public.share_links
for select
using (expires_at is null or expires_at > now());

drop policy if exists "share links own insert" on public.share_links;
create policy "share links own insert"
on public.share_links
for insert
with check (auth.uid() = user_id or public.is_admin());

drop policy if exists "share links own update" on public.share_links;
create policy "share links own update"
on public.share_links
for update
using (auth.uid() = user_id or public.is_admin())
with check (auth.uid() = user_id or public.is_admin());

drop policy if exists "share links own delete" on public.share_links;
create policy "share links own delete"
on public.share_links
for delete
using (auth.uid() = user_id or public.is_admin());

-- SUBSCRIPTIONS
drop policy if exists "subscriptions own read" on public.subscriptions;
create policy "subscriptions own read"
on public.subscriptions
for select
using (auth.uid() = user_id or public.is_admin());

-- Subscription writes should normally happen through Netlify Functions with the
-- Supabase service role key. These admin policies are only for trusted admin UI.
drop policy if exists "subscriptions admin insert" on public.subscriptions;
create policy "subscriptions admin insert"
on public.subscriptions
for insert
with check (public.is_admin());

drop policy if exists "subscriptions admin update" on public.subscriptions;
create policy "subscriptions admin update"
on public.subscriptions
for update
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "subscriptions admin delete" on public.subscriptions;
create policy "subscriptions admin delete"
on public.subscriptions
for delete
using (public.is_admin());

-- STRIPE WEBHOOK EVENTS
drop policy if exists "stripe webhook events admin read" on public.stripe_webhook_events;
create policy "stripe webhook events admin read"
on public.stripe_webhook_events
for select
using (public.is_admin());
