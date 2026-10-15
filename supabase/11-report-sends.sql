-- Log of weekday evening reports and admin alerts. Service role only.
-- Applied via MCP: report_sends_log

create table if not exists public.report_sends (
  id uuid primary key default gen_random_uuid(),
  day_key text not null,
  kind text not null check (kind in ('report', 'alert', 'missed')),
  status text not null check (status in ('sent', 'failed')),
  to_email text,
  orders_count integer,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists report_sends_day_kind_idx on public.report_sends (day_key, kind, status);

alter table public.report_sends enable row level security;
revoke all on table public.report_sends from public, anon, authenticated;
grant all on table public.report_sends to service_role;
