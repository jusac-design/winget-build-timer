-- ============================================================
--  BUILD MATE — weekday 17:30 UK email
--
--  Live jobs (applied via MCP):
--    build-mate-daily-report     30 16,17 * * 1-5   body {}
--    build-mate-report-watchdog  0 17,18 * * 1-5    body {"watchdog":true}
--    build-mate-close-timers     5 * * * 1-5        select close_open_timers()
--  Send: UK 17:xx weekdays (including empty days). No weekends.
--  Watchdog: UK 18:xx weekdays — emails admin if today's report did not send.
--
--  Recreate only if the job is missing. Do not commit real keys.
--    1. Left sidebar → Integrations → Cron, or run below in SQL
--    2. Name: build-mate-daily-report
--    3. Schedule:  30 16,17 * * 1-5
--    4. POST YOUR-PROJECT-URL/functions/v1/daily-report
--    5. Body: {}
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
