# Build Mate — live version

Plain HTML/CSS/JavaScript app with no build step. Open `index.html` in a browser, or serve the folder with GitHub Pages.

- `config.js` — the only file to edit: Supabase Project URL and anon/publishable key. Leave the placeholders to run on this device only.
- `app.js` — all app logic: fixed data (stages, machines, fitters), state, offline outbox + Supabase sync, screens.
- `app.css` — all styling (Winget yellow #fdc42b, charcoal #373a36, Gotham).
- `supabase/1-setup.sql` — tables `orders`, `runs`, `notes` + row-level security for the anon key (read/insert/update, no delete).
- `supabase/2-daily-report-function.ts` — Edge Function `daily-report`: builds a 3-tab .xlsx (summary, stage detail, day totals) and emails it via Resend. Secrets: RESEND_API_KEY (required), REPORT_TO, REPORT_FROM, SEND_HOUR, SEND_EMPTY.
- `supabase/3-schedule.sql` — pg_cron job, weekdays 16:30 and 17:30 UTC; the function only sends during the 17:xx UK hour.

Sync model: every change is written to localStorage and queued in an outbox; the outbox is flushed in order (orders before runs/notes) whenever online. The app pulls open orders (and anything updated in the last 14 days) on load and every 60 s when the outbox is empty.

Design and behaviour brief: see the original handoff README (stages, rules, screens, tokens, open questions) — kept below.

---
