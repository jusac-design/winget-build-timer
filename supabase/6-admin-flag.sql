-- Admin flag on fitters. Applied on the live project via MCP.
-- Only jusacsmith@gmail.com is admin; everyone else is false.

alter table public.fitters add column if not exists admin boolean not null default false;
update public.fitters set admin = false;
update public.fitters set admin = true where lower(email) = 'jusacsmith@gmail.com';
