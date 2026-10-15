-- Leave overtime timers running. 5pm auto-stop only applies to runs
-- that started before that day's UK close.

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
    -- Started at or after close: overtime. Do not cap or clear.
    if started >= closing then
      continue;
    end if;
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
    update public.orders set active = null, updated_at = now() where id = rec.id;
    n := n + 1;
  end loop;
  return n;
end;
$$;
