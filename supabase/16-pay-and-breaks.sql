-- Hourly rates stay off the fitters table (every tablet can read that).
-- Forgotten shop timers close at 16:30 UK. Overtime started at or after
-- that time is left running by close_open_timers.

create or replace function public.uk_close_at(p_start timestamptz)
returns timestamptz
language sql
stable
as $$
  with loc as (
    select (timezone('Europe/London', p_start))::date as d
  ),
  work as (
    select case extract(dow from d)::int
      when 0 then d - 2
      when 6 then d - 1
      else d
    end as day
    from loc
  )
  select (day::timestamp + time '16:30') at time zone 'Europe/London'
  from work;
$$;

create table if not exists public.fitter_rates (
  fitter_id uuid primary key references public.fitters(id) on delete cascade,
  hourly_rate numeric(8,2) not null check (hourly_rate >= 0 and hourly_rate <= 999.99),
  updated_at timestamptz not null default now()
);

create table if not exists public.run_rates (
  run_id text primary key references public.runs(id) on delete cascade,
  hourly_rate numeric(8,2),
  created_at timestamptz not null default now()
);

alter table public.fitter_rates enable row level security;
alter table public.run_rates enable row level security;

drop policy if exists "office read rates" on public.fitter_rates;
create policy "office read rates" on public.fitter_rates
  for select to authenticated
  using (public.is_office());

drop policy if exists "office read run rates" on public.run_rates;
create policy "office read run rates" on public.run_rates
  for select to authenticated
  using (public.is_office());

revoke all on public.fitter_rates from anon, authenticated;
revoke all on public.run_rates from anon, authenticated;
grant select on public.fitter_rates to authenticated;
grant select on public.run_rates to authenticated;

create or replace function public.snapshot_run_rate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  rate numeric;
begin
  if exists (select 1 from public.run_rates where run_id = new.id) then
    return new;
  end if;
  select fr.hourly_rate into rate
  from public.fitters f
  join public.fitter_rates fr on fr.fitter_id = f.id
  where lower(btrim(f.full_name)) = lower(btrim(coalesce(new.fitter, '')))
  order by f.active desc
  limit 1;
  insert into public.run_rates (run_id, hourly_rate)
  values (new.id, rate)
  on conflict (run_id) do nothing;
  return new;
end;
$$;

drop trigger if exists runs_snapshot_rate on public.runs;
create trigger runs_snapshot_rate
  after insert on public.runs
  for each row execute function public.snapshot_run_rate();

revoke all on function public.snapshot_run_rate() from public, anon, authenticated;

drop policy if exists "office delete runs" on public.runs;
create policy "office delete runs" on public.runs
  for delete to authenticated
  using (public.is_office());

grant delete on public.runs to authenticated;
