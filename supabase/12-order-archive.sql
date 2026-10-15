-- Archive hides a works order from the shop list. Admins still see it.
-- Delete is admin-only via manage-team (service role). Applied via MCP.

alter table public.orders add column if not exists archived boolean not null default false;

create index if not exists orders_archived_idx on public.orders (archived);

drop policy if exists "shop read" on public.orders;
create policy "shop read" on public.orders
  for select to authenticated
  using (coalesce(archived, false) = false or public.is_admin());

drop policy if exists "shop add" on public.orders;
create policy "shop add" on public.orders
  for insert to authenticated
  with check (coalesce(archived, false) = false);

drop policy if exists "shop update" on public.orders;
create policy "shop update" on public.orders
  for update to authenticated
  using (coalesce(archived, false) = false)
  with check (coalesce(archived, false) = false);

drop policy if exists "shop read" on public.runs;
create policy "shop read" on public.runs
  for select to authenticated
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_id
        and (coalesce(o.archived, false) = false or public.is_admin())
    )
  );

drop policy if exists "shop read" on public.notes;
create policy "shop read" on public.notes
  for select to authenticated
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_id
        and (coalesce(o.archived, false) = false or public.is_admin())
    )
  );
