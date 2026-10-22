-- Public name list: id + full_name only. Emails and admin stay on fitters.
-- Applied on the live project via MCP (fitter_directory_hide_emails).

create or replace view public.fitter_directory
with (security_invoker = false) as
select id, full_name
from public.fitters
where active = true;

revoke all on public.fitter_directory from public, anon, authenticated;
grant select on public.fitter_directory to anon, authenticated;

create or replace function public.fitter_email_for_login(p_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select email from public.fitters where id = p_id and active = true;
$$;

revoke all on function public.fitter_email_for_login(uuid) from public;
grant execute on function public.fitter_email_for_login(uuid) to anon, authenticated;

revoke all on table public.fitters from anon, public;
grant select on table public.fitters to authenticated;

drop policy if exists "fitters read" on public.fitters;
drop policy if exists "fitters read active" on public.fitters;
create policy "fitters read self" on public.fitters
  for select to authenticated
  using (id = auth.uid());
