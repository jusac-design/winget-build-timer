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

-- The tablet uses the public (anon) key, so allow it to read, add and update — never delete.
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
    execute format('create policy "tablet read" on public.%I for select to anon using (true)', t);
    execute format('create policy "tablet add" on public.%I for insert to anon with check (true)', t);
    execute format('create policy "tablet update" on public.%I for update to anon using (true) with check (true)', t);
  end loop;
end $$;

grant select, insert, update on public.orders, public.runs, public.notes to anon;

select 'Build Mate tables are ready' as result;
