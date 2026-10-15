-- Shared integrations (Resend API and similar). Secret column is not granted to the tablet.
-- Applied on the live project via MCP (integrations_shared_settings).

create table if not exists public.integrations (
  id text primary key,
  label text not null,
  config jsonb not null default '{}'::jsonb,
  secret text,
  secret_hint text,
  updated_at timestamptz not null default now()
);

alter table public.integrations enable row level security;

revoke all on table public.integrations from public, anon, authenticated;
grant select (id, label, config, secret_hint, updated_at) on table public.integrations to authenticated;
grant all on table public.integrations to service_role;

drop policy if exists "integrations admin read" on public.integrations;
create policy "integrations admin read" on public.integrations
  for select to authenticated
  using (public.is_admin());

insert into public.integrations (id, label, config)
values (
  'resend',
  'Resend',
  jsonb_build_object(
    'from', 'Build Mate <onboarding@resend.dev>',
    'to', 'justin.smith@seddonplant.co.uk'
  )
)
on conflict (id) do nothing;
