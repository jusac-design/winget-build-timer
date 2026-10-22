-- Functions group stages and set their colour.
-- Renaming updates every stage that uses the function.
-- A function that is still on a stage cannot be deleted.
-- Applied on the live project via MCP (stage_functions).

create table if not exists public.stage_functions (
  name       text primary key,
  colour     text not null,
  position   integer not null,
  updated_at timestamptz not null default now(),
  constraint stage_functions_colour_hex check (colour ~ '^#[0-9a-fA-F]{6}$')
);

insert into public.stage_functions (name, colour, position) values
  ('Fabrication', '#00a3e0', 1),
  ('Stores', '#8c4799', 2),
  ('Assembly', '#e57200', 3),
  ('Build', '#009639', 4),
  ('QC', '#e11f1c', 5)
on conflict (name) do nothing;

insert into public.stage_functions (name, colour, position)
select s.fn,
  coalesce((select s2.colour from public.stages s2 where s2.fn = s.fn and s2.colour ~ '^#[0-9a-fA-F]{6}$' limit 1), '#373a36'),
  100 + row_number() over (order by s.fn)
from (select distinct fn from public.stages) s
where not exists (select 1 from public.stage_functions f where f.name = s.fn);

alter table public.stages drop constraint if exists stages_fn_fkey;
alter table public.stages
  add constraint stages_fn_fkey
  foreign key (fn) references public.stage_functions(name)
  on update cascade
  on delete restrict;

alter table public.stage_functions enable row level security;
revoke all on table public.stage_functions from public, anon, authenticated;
grant select, insert, update, delete on table public.stage_functions to authenticated;

drop policy if exists "stage functions read" on public.stage_functions;
drop policy if exists "stage functions insert" on public.stage_functions;
drop policy if exists "stage functions update" on public.stage_functions;
drop policy if exists "stage functions delete" on public.stage_functions;
create policy "stage functions read" on public.stage_functions for select to authenticated using (true);
create policy "stage functions insert" on public.stage_functions for insert to authenticated with check (public.is_admin());
create policy "stage functions update" on public.stage_functions for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "stage functions delete" on public.stage_functions for delete to authenticated using (public.is_admin());

create or replace function public.save_stage_function(p_from text, p_name text, p_colour text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pos integer;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can change a function';
  end if;
  p_from := nullif(btrim(coalesce(p_from, '')), '');
  p_name := btrim(coalesce(p_name, ''));
  p_colour := lower(btrim(coalesce(p_colour, '')));
  if p_name = '' then
    raise exception 'Enter a function name';
  end if;
  if p_colour !~ '^#[0-9a-f]{6}$' then
    raise exception 'Pick a colour for this function';
  end if;
  if exists (
    select 1 from public.stage_functions
    where lower(name) = lower(p_name)
      and name is distinct from p_from
  ) then
    raise exception 'A function with that name already exists';
  end if;
  if p_from is null then
    select coalesce(max(position), 0) + 1 into v_pos from public.stage_functions;
    insert into public.stage_functions (name, colour, position, updated_at)
    values (p_name, p_colour, v_pos, now());
  else
    update public.stage_functions
      set name = p_name, colour = p_colour, updated_at = now()
      where name = p_from;
    if not found then
      raise exception 'That function was not found';
    end if;
    update public.stages
      set colour = p_colour, updated_at = now()
      where fn = p_name;
  end if;
end;
$$;

create or replace function public.delete_stage_function(p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can delete a function';
  end if;
  if exists (select 1 from public.stages where fn = p_name) then
    raise exception 'This function is used by a stage, so it cannot be deleted';
  end if;
  delete from public.stage_functions where name = p_name;
  if not found then
    raise exception 'That function was not found';
  end if;
end;
$$;

revoke all on function public.save_stage_function(text, text, text) from public, anon, authenticated;
revoke all on function public.delete_stage_function(text) from public, anon, authenticated;
grant execute on function public.save_stage_function(text, text, text) to authenticated;
grant execute on function public.delete_stage_function(text) to authenticated;
