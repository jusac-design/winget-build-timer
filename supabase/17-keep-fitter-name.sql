-- Signing in updates auth.users and used to rewrite fitters.full_name from the
-- email address whenever no display name was stored on the login.
-- Keep a name already saved on the fitter unless the login itself has one.

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
