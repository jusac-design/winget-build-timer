-- Master stages, and which of those stages each machine uses, in order.
-- Reference minutes belong to the machine + stage, because the same stage
-- takes longer on a larger machine. Null means no reference has been set.
-- Applied on the live project via MCP (machine_process).

create table if not exists public.stages (
  n          integer primary key,
  fn         text not null,
  colour     text not null,
  name       text not null,
  tasks      jsonb not null default '[]'::jsonb,
  retired    boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.machine_stages (
  machine      text not null,
  stage        integer not null references public.stages(n),
  position     integer not null,
  ref_minutes  integer,
  primary key (machine, stage)
);

alter table public.stages enable row level security;
alter table public.machine_stages enable row level security;

revoke all on table public.stages from public, anon, authenticated;
revoke all on table public.machine_stages from public, anon, authenticated;
grant select, insert, update, delete on table public.stages to authenticated;
grant select, insert, update, delete on table public.machine_stages to authenticated;

drop policy if exists "stages read" on public.stages;
drop policy if exists "stages insert" on public.stages;
drop policy if exists "stages update" on public.stages;
drop policy if exists "stages delete" on public.stages;
create policy "stages read" on public.stages for select to authenticated using (true);
create policy "stages insert" on public.stages for insert to authenticated with check (public.is_admin());
create policy "stages update" on public.stages for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "stages delete" on public.stages for delete to authenticated using (public.is_admin());

drop policy if exists "machine stages read" on public.machine_stages;
drop policy if exists "machine stages insert" on public.machine_stages;
drop policy if exists "machine stages update" on public.machine_stages;
drop policy if exists "machine stages delete" on public.machine_stages;
create policy "machine stages read" on public.machine_stages for select to authenticated using (true);
create policy "machine stages insert" on public.machine_stages for insert to authenticated with check (public.is_admin());
create policy "machine stages update" on public.machine_stages for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "machine stages delete" on public.machine_stages for delete to authenticated using (public.is_admin());

insert into public.stages (n, fn, colour, name, tasks) values
  (1, 'Fabrication', '#00a3e0', 'Fabricate', '["Main Frame (UK)","Prime (UK)","Outsourced — no internal time expected"]'::jsonb),
  (2, 'Stores', '#8c4799', 'Pick Parts', '["Pick all components (excluding fixings)"]'::jsonb),
  (3, 'Assembly', '#e57200', 'Sub-assemble Main Frame', '["Main Frame (UK)","Wheels","Towbar","Axle"]'::jsonb),
  (4, 'Assembly', '#e57200', 'Sub-assemble Engine & Preparation', '["Engine & W/Loom (UK)","Engine Base Plate","Oil/Fuel"]'::jsonb),
  (5, 'Assembly', '#e57200', 'Sub-assemble Trunnion', '["Trunnion (UK)","Tilt Wheel (INT)","Chain Sprocket","Brackets"]'::jsonb),
  (6, 'Assembly', '#e57200', 'Sub-assemble Drum', '["Top Drum (INT)","Bottom Drum (INT)","Shaft (DC Assy) (INT)","Tophat (DC Assy) (INT)","Blades x2","Bonded/Fixed","Clamped/Spot Welded"]'::jsonb),
  (7, 'Build', '#009639', 'Build up mixer', '["Fit all Sub-assemblies to mainframe","Engine (UK)","Trunnion (UK)","Drum (INT)","Pulley Alignment","Belt Tensioning"]'::jsonb),
  (8, 'QC', '#e11f1c', 'Test / Inspection', '["Engine Start","Drum Run Speed","Water Tightness","Drum Backlash"]'::jsonb),
  (9, 'QC', '#e11f1c', 'Paint', '["Engine Bagged","Wheels Bagged","Masked","Prime","Topcoat"]'::jsonb),
  (10, 'QC', '#e11f1c', 'Finish', '["Pull Cord Plate","Engine Stop Switch","Engine Lids* (UK)","Engine Grills* (UK)","Decals","Battery"]'::jsonb)
on conflict (n) do nothing;

insert into public.machine_stages (machine, stage, position, ref_minutes)
select m.machine, s.n, s.n, case when m.machine = '100T ES Diesel' then s.ref end
from (values
  ('100T ES Diesel'),
  ('150T ES Diesel'),
  ('150TFT ES Diesel'),
  ('175T ES Diesel'),
  ('175TFT ES Diesel')
) as m(machine)
cross join (values
  (1, 0), (2, 40), (3, 60), (4, 60), (5, 120),
  (6, 120), (7, 60), (8, 60), (9, 240), (10, 35)
) as s(n, ref)
on conflict (machine, stage) do nothing;
