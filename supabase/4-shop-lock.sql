-- ============================================================
--  BUILD MATE — shop lock (run this if you already ran 1-setup.sql)
--  Paste ALL of this into Supabase → SQL Editor → New query → Run.
--
--  Then run 5-fitters.sql and add each fitter under Authentication → Users.
--  Do not put passphrases in app files.
-- ============================================================

alter table public.orders enable row level security;
alter table public.runs   enable row level security;
alter table public.notes  enable row level security;

do $$
declare t text;
begin
  foreach t in array array['orders','runs','notes'] loop
    execute format('drop policy if exists "tablet read" on public.%I', t);
    execute format('drop policy if exists "tablet add" on public.%I', t);
    execute format('drop policy if exists "tablet update" on public.%I', t);
    execute format('drop policy if exists "shop read" on public.%I', t);
    execute format('drop policy if exists "shop add" on public.%I', t);
    execute format('drop policy if exists "shop update" on public.%I', t);
    execute format('create policy "shop read" on public.%I for select to authenticated using (true)', t);
    execute format('create policy "shop add" on public.%I for insert to authenticated with check (true)', t);
    execute format('create policy "shop update" on public.%I for update to authenticated using (true) with check (true)', t);
  end loop;
end $$;

revoke all on public.orders, public.runs, public.notes from anon;
grant select, insert, update on public.orders, public.runs, public.notes to authenticated;

select 'Shop lock is on — only a signed-in tablet can read or write' as result;
