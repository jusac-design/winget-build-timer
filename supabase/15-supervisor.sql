-- Supervisor sits under Admin. Office screens (Live now, archive WOs,
-- manage shop users) use is_office(). Settings and role changes stay admin.

alter table public.fitters add column if not exists supervisor boolean not null default false;

update public.fitters set supervisor = false where admin = true;

create or replace function public.is_office()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select f.admin or f.supervisor from public.fitters f where f.id = auth.uid()
  ), false);
$$;

revoke all on function public.is_office() from public, anon;
grant execute on function public.is_office() to authenticated;

drop policy if exists "shop read" on public.orders;
create policy "shop read" on public.orders
  for select to authenticated
  using (coalesce(archived, false) = false or public.is_office());

drop policy if exists "shop read" on public.runs;
create policy "shop read" on public.runs
  for select to authenticated
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_id
        and (coalesce(o.archived, false) = false or public.is_office())
    )
  );

drop policy if exists "shop read" on public.notes;
create policy "shop read" on public.notes
  for select to authenticated
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_id
        and (coalesce(o.archived, false) = false or public.is_office())
    )
  );
