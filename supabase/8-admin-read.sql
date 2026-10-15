-- Admins can read archived fitters. Applied on the live project via MCP.

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select f.admin from public.fitters f where f.id = auth.uid()), false);
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

drop policy if exists "fitters read" on public.fitters;
drop policy if exists "fitters read active" on public.fitters;
drop policy if exists "fitters admin read all" on public.fitters;
create policy "fitters read active" on public.fitters for select to anon, authenticated using (active = true);
create policy "fitters admin read all" on public.fitters for select to authenticated using (public.is_admin());
