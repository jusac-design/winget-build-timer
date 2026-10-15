-- Close forgotten shop timers at 17:00 UK on weekdays.
-- Caps stop time at that day's close (or the previous Friday if the
-- timer spanned a weekend). Safe to run more than once.

create or replace function public.active_started_at(a jsonb)
returns timestamptz
language sql
stable
as $$
  select case
    when a is null or a->>'start' is null or a->>'start' = '' then null
    when a->>'start' ~ '^[0-9]+(\.[0-9]+)?$' then to_timestamp((a->>'start')::numeric / 1000.0)
    else (a->>'start')::timestamptz
  end;
$$;

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
  select (day::timestamp + time '17:00') at time zone 'Europe/London'
  from work;
$$;

create or replace function public.close_open_timers()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n int := 0;
  rec record;
  started timestamptz;
  closing timestamptz;
begin
  for rec in select id, active from public.orders where active is not null loop
    started := public.active_started_at(rec.active);
    if started is null then
      update public.orders set active = null, updated_at = now() where id = rec.id;
      n := n + 1;
      continue;
    end if;
    closing := public.uk_close_at(started);
    if now() < closing then
      continue;
    end if;
    if started < closing then
      insert into public.runs (id, order_id, stage, unit, fitter, started_at, stopped_at)
      values (
        'r' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 18),
        rec.id,
        coalesce(nullif(rec.active->>'stage', '')::int, 1),
        coalesce(nullif(rec.active->>'unit', '')::int, 1),
        rec.active->>'fitter',
        started,
        closing
      );
    end if;
    update public.orders set active = null, updated_at = now() where id = rec.id;
    n := n + 1;
  end loop;
  return n;
end;
$$;

revoke all on function public.active_started_at(jsonb) from public;
revoke all on function public.uk_close_at(timestamptz) from public;
revoke all on function public.close_open_timers() from public;
grant execute on function public.close_open_timers() to postgres;

select cron.unschedule('build-mate-close-timers')
where exists (select 1 from cron.job where jobname = 'build-mate-close-timers');

-- Weekday hourly (UTC). Function only stops timers whose UK 17:00 close has passed.
select cron.schedule(
  'build-mate-close-timers',
  '5 * * * 1-5',
  $$select public.close_open_timers();$$
);
