-- ============================================================
--  BUILD MATE — per-fitter logins (run this if tables already exist)
--  Paste ALL of this into Supabase → SQL Editor → New query → Run.
--
--  Then add each fitter:
--    1. Authentication → Providers → Email → enabled, Confirm email OFF → Save
--    2. Authentication → Users → Add user → Create new user
--    3. Email: e.g. michael.bishop@seddonplant.co.uk
--    4. Password: that person's passphrase (not stored in any app file)
--    5. Auto Confirm User: ON
--    6. User Metadata (JSON):  {"full_name":"Michael Bishop"}
--    7. Create user
--  To hide someone: Table Editor → fitters → set active = false
--  (or delete/ban the user under Authentication → Users)
-- ============================================================

create table if not exists public.fitters (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text not null,
  email      text not null,
  active     boolean not null default true,
  admin      boolean not null default false
);

alter table public.fitters enable row level security;
drop policy if exists "fitters read" on public.fitters;
create policy "fitters read" on public.fitters for select to anon, authenticated using (active = true);
grant select on public.fitters to anon, authenticated;

create or replace function public.sync_fitter()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.fitters (id, full_name, email)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'full_name',''), nullif(new.raw_user_meta_data->>'name',''), split_part(new.email, '@', 1)),
    new.email
  )
  on conflict (id) do update set
    full_name = coalesce(nullif(new.raw_user_meta_data->>'full_name',''), nullif(new.raw_user_meta_data->>'name',''), public.fitters.full_name),
    email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_sync on auth.users;
create trigger on_auth_user_sync
  after insert or update on auth.users
  for each row execute procedure public.sync_fitter();

insert into public.fitters (id, full_name, email)
select id,
  coalesce(nullif(raw_user_meta_data->>'full_name',''), nullif(raw_user_meta_data->>'name',''), split_part(email, '@', 1)),
  email
from auth.users
on conflict (id) do update set full_name = excluded.full_name, email = excluded.email;

-- Hide the old shared shop login if it exists (it is not a fitter).
update public.fitters
set active = false
where lower(email) = 'buildmate@seddonplant.co.uk';

update public.fitters set admin = false;
update public.fitters set admin = true where lower(email) = 'jusacsmith@gmail.com';

select 'Fitter list is ready — add people in Authentication → Users' as result;
