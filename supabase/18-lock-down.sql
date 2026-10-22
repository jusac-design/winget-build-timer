-- The name list is a view owned by a role that bypasses row security.
-- Default grants let anyone signed out change or delete those names.
-- The forgotten-timer closer was also callable with the public key.

revoke all on table public.fitter_directory from public, anon, authenticated;
grant select on table public.fitter_directory to anon, authenticated;

revoke insert, update, delete, truncate, trigger, references on table public.fitters from anon, authenticated;
revoke delete, truncate, trigger, references on table public.orders from anon, authenticated;
revoke delete, truncate, trigger, references on table public.notes from anon, authenticated;
revoke truncate, trigger, references on table public.runs from anon, authenticated;

revoke all on function public.close_open_timers() from public, anon, authenticated;
grant execute on function public.close_open_timers() to postgres;

revoke all on function public.active_started_at(jsonb) from public, anon, authenticated;
revoke all on function public.uk_close_at(timestamptz) from public, anon, authenticated;
alter function public.active_started_at(jsonb) set search_path = public;
alter function public.uk_close_at(timestamptz) set search_path = public;
