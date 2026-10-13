-- ============================================================
--  BUILD MATE — schedule the evening email
--  1. Replace YOUR-PROJECT-URL below with your Project URL
--     (looks like https://abcdefghijkl.supabase.co — no slash at the end).
--  2. Paste into Supabase → SQL Editor → New query → Run.
--
--  Runs Monday–Friday at 16:30 and 17:30 (UTC). The function only sends
--  when it is the 17:xx hour in the UK, so the email always goes at 17:30
--  UK time in both summer and winter.
-- ============================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('build-mate-daily-report')
where exists (select 1 from cron.job where jobname = 'build-mate-daily-report');

select cron.schedule(
  'build-mate-daily-report',
  '30 16,17 * * 1-5',
  $$
  select net.http_post(
    url     := 'YOUR-PROJECT-URL/functions/v1/daily-report',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);

select 'Evening email scheduled' as result;
