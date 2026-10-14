-- ============================================================
--  BUILD MATE — weekday 17:30 UK email
--
--  Easiest (recommended): do this in the dashboard, not this file.
--    1. Left sidebar → Integrations → Cron
--    2. Create job
--    3. Name: build-mate-daily-report
--    4. Schedule (cron):  30 16,17 * * 1-5
--       (16:30 and 17:30 UTC, Mon–Fri. The function only sends
--        when the UK clock is 17:xx, so the email is 17:30 UK
--        in both winter and summer.)
--    5. Type: Supabase Edge Function
--    6. Function: daily-report
--    7. Method: POST
--    8. Body: {}
--    9. Save / Create job
--
--  If the dashboard has no "Edge Function" type, paste this SQL
--  instead (SQL Editor → New query → Run).
--  Replace YOUR-PROJECT-URL and YOUR-ANON-KEY first.
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
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'YOUR-ANON-KEY',
      'Authorization', 'Bearer YOUR-ANON-KEY'
    ),
    body    := '{}'::jsonb
  );
  $$
);

select 'Evening email scheduled' as result;
