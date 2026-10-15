-- ============================================================
--  BUILD MATE — database setup
--  Paste ALL of this into Supabase → SQL Editor → New query → Run.
--  Safe to run more than once.
-- ============================================================

create table if not exists public.orders (
  id          text primary key,
  wo          text not null,
  customer    text,
  machine     text,
  has_ref     boolean default false,
  qty         int default 1,
  mode        text default 'batch',
  complete    int[] default '{}',
  done        boolean default false,
  finished_at timestamptz,
  active      jsonb,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create table if not exists public.runs (
  id          text primary key,
  order_id    text references public.orders(id) on delete cascade,
  stage       int not null,
  unit        int default 1,
  fitter      text,
  started_at  timestamptz not null,
  stopped_at  timestamptz not null
);

create table if not exists public.notes (
  id          text primary key,
  order_id    text references public.orders(id) on delete cascade,
  text        text not null,
  fitter      text,
  created_at  timestamptz default now()
);

create index if not exists runs_order_idx   on public.runs(order_id);
create index if not exists runs_started_idx on public.runs(started_at);
create index if not exists notes_order_idx  on public.notes(order_id);

-- Only a signed-in shop session (the passphrase) can read or write. Never delete.
-- The public anon key in the web page is not enough on its own.
alter table public.orders enable row level security;
alter table public.runs   enable row level security;
alter table public.notes  enable row level security;

do $$
declare t text;
begin
  foreach t in array array['orders','runs','notes'] loop
    execute format('drop policy if exists "tablet read" on public.%I', t);
    execute format('drop policy if exists "tablet add" on public.%I', t);
    execute format('drop policy if exists "tablet update" on public.%I', t);
    execute format('drop policy if exists "shop read" on public.%I', t);
    execute format('drop policy if exists "shop add" on public.%I', t);
    execute format('drop policy if exists "shop update" on public.%I', t);
    execute format('create policy "shop read" on public.%I for select to authenticated using (true)', t);
    execute format('create policy "shop add" on public.%I for insert to authenticated with check (true)', t);
    execute format('create policy "shop update" on public.%I for update to authenticated using (true) with check (true)', t);
  end loop;
end $$;

revoke all on public.orders, public.runs, public.notes from anon;
grant select, insert, update on public.orders, public.runs, public.notes to authenticated;

-- Fitters (names for the tablet). Passwords stay in Authentication → Users, never in this table.
create table if not exists public.fitters (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text not null,
  email      text not null,
  active     boolean not null default true,
  admin      boolean not null default false
);

alter table public.fitters enable row level security;
drop policy if exists "fitters read" on public.fitters;
create policy "fitters read" on public.fitters for select to anon, authenticated using (active = true);
grant select on public.fitters to anon, authenticated;

create or replace function public.sync_fitter()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.fitters (id, full_name, email)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'full_name',''), nullif(new.raw_user_meta_data->>'name',''), split_part(new.email, '@', 1)),
    new.email
  )
  on conflict (id) do update set
    full_name = excluded.full_name,
    email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_sync on auth.users;
create trigger on_auth_user_sync
  after insert or update on auth.users
  for each row execute procedure public.sync_fitter();

insert into public.fitters (id, full_name, email)
select id,
  coalesce(nullif(raw_user_meta_data->>'full_name',''), nullif(raw_user_meta_data->>'name',''), split_part(email, '@', 1)),
  email
from auth.users
on conflict (id) do update set full_name = excluded.full_name, email = excluded.email;

select 'Build Mate tables are ready' as result;
