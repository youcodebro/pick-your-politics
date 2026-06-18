create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  avatar_seed text,
  role text not null default 'user' check (role in ('user','admin')),
  stripe_customer_id text,
  stripe_subscription_id text,
  subscription_status text default 'inactive',
  price_id text,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.question_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  mode text not null default 'daily' check (mode in ('daily','full','module')),
  status text not null default 'in_progress',
  module_id text,
  current_question_index integer not null default 0,
  party_scores jsonb not null default '{}'::jsonb,
  issue_scores jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.answers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  session_id uuid not null references public.question_sessions(id) on delete cascade,
  module_id text not null,
  question_index integer not null,
  question_prompt text not null,
  answer_value text not null,
  answer_kind text not null default 'answer',
  party_delta jsonb not null default '{}'::jsonb,
  party_scores jsonb not null default '{}'::jsonb,
  issue_scores jsonb not null default '{}'::jsonb,
  answered_at timestamptz not null default now(),
  unique(session_id,module_id,question_index)
);

create table if not exists public.user_progress (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  current_session_id uuid references public.question_sessions(id) on delete set null,
  current_module_id text,
  current_question_index integer not null default 0,
  completed_modules text[] not null default '{}',
  streak_count integer not null default 0,
  last_activity_at timestamptz,
  party_scores jsonb not null default '{}'::jsonb,
  issue_scores jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.modules (
  id text primary key,
  title text not null,
  description text,
  icon text,
  sort_order integer not null default 0,
  is_published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  module_id text not null references public.modules(id) on delete cascade,
  prompt text not null,
  help_text text,
  type text not null default 'likert' check (type in ('likert','binary')),
  options jsonb not null default '[]'::jsonb,
  sort_order integer not null default 0,
  is_published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.scoring_rules (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions(id) on delete cascade,
  answer_value text not null,
  party_delta jsonb not null default '{}'::jsonb,
  issue_delta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(question_id,answer_value)
);

create table if not exists public.public_shares (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  token text not null unique default encode(gen_random_bytes(12),'hex'),
  display_name text not null,
  avatar_seed text,
  party_scores jsonb not null default '{}'::jsonb,
  issue_scores jsonb not null default '{}'::jsonb,
  answered_count integer not null default 0,
  completed_modules integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists touch_profiles_updated_at on public.profiles;
create trigger touch_profiles_updated_at before update on public.profiles
for each row execute function public.touch_updated_at();

drop trigger if exists touch_question_sessions_updated_at on public.question_sessions;
create trigger touch_question_sessions_updated_at before update on public.question_sessions
for each row execute function public.touch_updated_at();

drop trigger if exists touch_user_progress_updated_at on public.user_progress;
create trigger touch_user_progress_updated_at before update on public.user_progress
for each row execute function public.touch_updated_at();

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

alter table public.profiles enable row level security;
alter table public.question_sessions enable row level security;
alter table public.answers enable row level security;
alter table public.user_progress enable row level security;
alter table public.modules enable row level security;
alter table public.questions enable row level security;
alter table public.scoring_rules enable row level security;
alter table public.public_shares enable row level security;

drop policy if exists "profiles own read" on public.profiles;
create policy "profiles own read" on public.profiles for select using (auth.uid() = id or public.is_admin());
drop policy if exists "profiles own insert" on public.profiles;
create policy "profiles own insert" on public.profiles for insert with check (auth.uid() = id);
drop policy if exists "profiles own update" on public.profiles;
create policy "profiles own update" on public.profiles for update using (auth.uid() = id or public.is_admin()) with check (auth.uid() = id or public.is_admin());

drop policy if exists "sessions own all" on public.question_sessions;
create policy "sessions own all" on public.question_sessions for all using (auth.uid() = user_id or public.is_admin()) with check (auth.uid() = user_id or public.is_admin());

drop policy if exists "answers own all" on public.answers;
create policy "answers own all" on public.answers for all using (auth.uid() = user_id or public.is_admin()) with check (auth.uid() = user_id or public.is_admin());

drop policy if exists "progress own all" on public.user_progress;
create policy "progress own all" on public.user_progress for all using (auth.uid() = user_id or public.is_admin()) with check (auth.uid() = user_id or public.is_admin());

drop policy if exists "modules public read" on public.modules;
create policy "modules public read" on public.modules for select using (is_published or public.is_admin());
drop policy if exists "modules admin write" on public.modules;
create policy "modules admin write" on public.modules for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "questions public read" on public.questions;
create policy "questions public read" on public.questions for select using (is_published or public.is_admin());
drop policy if exists "questions admin write" on public.questions;
create policy "questions admin write" on public.questions for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "scoring public read" on public.scoring_rules;
create policy "scoring public read" on public.scoring_rules for select using (true);
drop policy if exists "scoring admin write" on public.scoring_rules;
create policy "scoring admin write" on public.scoring_rules for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "shares public active read" on public.public_shares;
create policy "shares public active read" on public.public_shares for select using (is_active);
drop policy if exists "shares own write" on public.public_shares;
create policy "shares own write" on public.public_shares for all using (auth.uid() = user_id or public.is_admin()) with check (auth.uid() = user_id or public.is_admin());

insert into public.modules (id,title,description,icon,sort_order,is_published) values
('m1','Economy & Taxes','Taxation, wages, UBI, regulation','ti-coin',1,true),
('m3','Healthcare','Insurance, access, safety net','ti-heart-rate-monitor',2,true),
('m6','Immigration','Pathways, border, asylum','ti-world',3,true),
('m7','Climate & Energy','Emissions, fossil fuels, green jobs','ti-leaf',4,true)
on conflict (id) do update set title=excluded.title, description=excluded.description, icon=excluded.icon, sort_order=excluded.sort_order;
