-- Machines are a list an admin can add, rename, and delete.
-- Renaming updates the process and every works order, including archived ones.
-- A machine that is already on a works order cannot be deleted.
-- Applied on the live project via MCP (machines).

create table if not exists public.machines (
  name       text primary key,
  position   integer not null,
  updated_at timestamptz not null default now()
);

insert into public.machines (name, position) values
  ('100T ES Diesel', 1),
  ('150T ES Diesel', 2),
  ('150TFT ES Diesel', 3),
  ('175T ES Diesel', 4),
  ('175TFT ES Diesel', 5)
on conflict (name) do nothing;

alter table public.machine_stages
  drop constraint if exists machine_stages_machine_fkey;
alter table public.machine_stages
  add constraint machine_stages_machine_fkey
  foreign key (machine) references public.machines(name)
  on update cascade
  on delete restrict;

alter table public.machines enable row level security;
revoke all on table public.machines from public, anon, authenticated;
grant select, insert, update, delete on table public.machines to authenticated;

drop policy if exists "machines read" on public.machines;
drop policy if exists "machines insert" on public.machines;
drop policy if exists "machines update" on public.machines;
drop policy if exists "machines delete" on public.machines;
create policy "machines read" on public.machines for select to authenticated using (true);
create policy "machines insert" on public.machines for insert to authenticated with check (public.is_admin());
create policy "machines update" on public.machines for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "machines delete" on public.machines for delete to authenticated using (public.is_admin());

create or replace function public.rename_machine(p_from text, p_to text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can rename a machine';
  end if;
  p_to := btrim(coalesce(p_to, ''));
  if p_to = '' then
    raise exception 'Enter a machine name';
  end if;
  if p_from is not distinct from p_to then
    return;
  end if;
  if exists (select 1 from public.machines where name = p_to) then
    raise exception 'A machine with that name already exists';
  end if;
  update public.machines set name = p_to, updated_at = now() where name = p_from;
  if not found then
    raise exception 'That machine was not found';
  end if;
  update public.orders set machine = p_to, updated_at = now() where machine = p_from;
end;
$$;

create or replace function public.delete_machine(p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can delete a machine';
  end if;
  if exists (select 1 from public.orders where machine = p_name) then
    raise exception 'This machine is on a works order, so it cannot be deleted';
  end if;
  delete from public.machine_stages where machine = p_name;
  delete from public.machines where name = p_name;
  if not found then
    raise exception 'That machine was not found';
  end if;
end;
$$;

revoke all on function public.rename_machine(text, text) from public, anon, authenticated;
revoke all on function public.delete_machine(text) from public, anon, authenticated;
grant execute on function public.rename_machine(text, text) to authenticated;
grant execute on function public.delete_machine(text) to authenticated;
