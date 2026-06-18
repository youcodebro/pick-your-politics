-- PYP decided schema.
-- WARNING: this drops and recreates all PYP public tables.

begin;

create extension if not exists "pgcrypto";

drop table if exists public.responses cascade;
drop table if exists public.sessions cascade;
drop table if exists public.share_links cascade;
drop table if exists public.subscriptions cascade;
drop table if exists public.questions cascade;
drop table if exists public.users cascade;

drop table if exists public.answers cascade;
drop table if exists public.question_sessions cascade;
drop table if exists public.user_progress cascade;
drop table if exists public.public_shares cascade;
drop table if exists public.scoring_rules cascade;
drop table if exists public.modules cascade;
drop table if exists public.profiles cascade;

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.is_admin()
returns boolean language sql stable as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin';
$$;

create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  display_name text,
  avatar_config jsonb not null default '{}'::jsonb,
  plan text not null default 'free' check (plan in ('free','plus')),
  streak_count int not null default 0,
  streak_last_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger touch_users_updated_at before update on public.users
for each row execute function public.touch_updated_at();

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  mode text not null check (mode in ('daily','full')),
  module_id text,
  scores jsonb not null default '{}'::jsonb,
  questions_answered int not null default 0,
  skips_used int not null default 0,
  completed boolean not null default false,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create index sessions_user_id_idx on public.sessions(user_id);
create index sessions_started_at_idx on public.sessions(started_at);

create table public.questions (
  id uuid primary key default gen_random_uuid(),
  module_id text not null,
  module_title text not null,
  order_index int not null,
  prompt text not null,
  help_text text,
  question_type text not null check (question_type in ('likert','binary')),
  binary_options jsonb,
  scoring jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  constraint questions_module_id_check check (module_id ~ '^m[1-8]$'),
  constraint questions_order_index_check check (order_index between 1 and 8)
);

create index questions_module_id_idx on public.questions(module_id);
create index questions_active_idx on public.questions(is_active);
create unique index questions_module_order_unique on public.questions(module_id, order_index);

create table public.responses (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  question_id uuid references public.questions(id) on delete set null,
  answer text not null,
  score_delta jsonb not null default '{}'::jsonb,
  answered_at timestamptz not null default now()
);

create index responses_session_id_idx on public.responses(session_id);
create index responses_user_id_idx on public.responses(user_id);
create index responses_question_id_idx on public.responses(question_id);
create index responses_answered_at_idx on public.responses(answered_at);

create table public.share_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  token text not null unique default encode(gen_random_bytes(8), 'hex'),
  scores_snapshot jsonb not null default '{}'::jsonb,
  top_issues jsonb not null default '[]'::jsonb,
  og_image_url text,
  view_count int not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz
);

create index share_links_user_id_idx on public.share_links(user_id);
create index share_links_session_id_idx on public.share_links(session_id);
create index share_links_token_idx on public.share_links(token);
create index share_links_created_at_idx on public.share_links(created_at);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users(id) on delete cascade,
  stripe_customer_id text,
  stripe_sub_id text,
  plan text check (plan in ('monthly','yearly')),
  status text not null default 'inactive'
    check (status in ('active','cancelled','past_due','trialing','incomplete','inactive')),
  current_period_end timestamptz,
  created_at timestamptz not null default now()
);

create index subscriptions_user_id_idx on public.subscriptions(user_id);
create index subscriptions_stripe_customer_id_idx on public.subscriptions(stripe_customer_id);
create index subscriptions_stripe_sub_id_idx on public.subscriptions(stripe_sub_id);

alter table public.users enable row level security;
alter table public.sessions enable row level security;
alter table public.responses enable row level security;
alter table public.questions enable row level security;
alter table public.share_links enable row level security;
alter table public.subscriptions enable row level security;

create policy "users own read" on public.users for select
using (auth.uid() = id or public.is_admin());
create policy "users own insert" on public.users for insert
with check (auth.uid() = id or public.is_admin());
create policy "users own update" on public.users for update
using (auth.uid() = id or public.is_admin())
with check (auth.uid() = id or public.is_admin());

create policy "sessions own read" on public.sessions for select
using (auth.uid() = user_id or public.is_admin());
create policy "sessions own insert" on public.sessions for insert
with check (auth.uid() = user_id or public.is_admin());
create policy "sessions own update" on public.sessions for update
using (auth.uid() = user_id or public.is_admin())
with check (auth.uid() = user_id or public.is_admin());
create policy "sessions own delete" on public.sessions for delete
using (auth.uid() = user_id or public.is_admin());

create policy "responses own read" on public.responses for select
using (auth.uid() = user_id or public.is_admin());
create policy "responses own insert" on public.responses for insert
with check (auth.uid() = user_id or public.is_admin());
create policy "responses own update" on public.responses for update
using (auth.uid() = user_id or public.is_admin())
with check (auth.uid() = user_id or public.is_admin());
create policy "responses own delete" on public.responses for delete
using (auth.uid() = user_id or public.is_admin());

create policy "questions public active read" on public.questions for select
using (is_active = true or public.is_admin());
create policy "questions admin insert" on public.questions for insert
with check (public.is_admin());
create policy "questions admin update" on public.questions for update
using (public.is_admin())
with check (public.is_admin());
create policy "questions admin delete" on public.questions for delete
using (public.is_admin());

create policy "share links public read" on public.share_links for select
using (expires_at is null or expires_at > now());
create policy "share links own insert" on public.share_links for insert
with check (auth.uid() = user_id or public.is_admin());
create policy "share links own update" on public.share_links for update
using (auth.uid() = user_id or public.is_admin())
with check (auth.uid() = user_id or public.is_admin());
create policy "share links own delete" on public.share_links for delete
using (auth.uid() = user_id or public.is_admin());

create policy "subscriptions own read" on public.subscriptions for select
using (auth.uid() = user_id or public.is_admin());
create policy "subscriptions admin insert" on public.subscriptions for insert
with check (public.is_admin());
create policy "subscriptions admin update" on public.subscriptions for update
using (public.is_admin())
with check (public.is_admin());
create policy "subscriptions admin delete" on public.subscriptions for delete
using (public.is_admin());

commit;
