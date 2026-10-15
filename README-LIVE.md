# Build Mate — live version

Plain HTML/CSS/JavaScript app with no build step. Open `index.html` in a browser, or serve the folder with GitHub Pages.

- `config.js` — Supabase URL, anon key, report email. Never put passphrases in this file.
- `app.js` — fitter list from the database, each person unlocks with their own passphrase, offline outbox + sync. Auto-locks after 8 hours with no taps.
- `app.css` — all styling (Winget yellow #fdc42b, charcoal #373a36, Gotham).
- `supabase/1-setup.sql` — tables `orders`, `runs`, `notes`, `fitters` + row-level security (works data only for a signed-in fitter).
- `supabase/4-shop-lock.sql` — run if tables already exist: blocks anyone who is not signed in from works-order data.
- `supabase/5-fitters.sql` — run if tables already exist: `fitters` list synced from Authentication → Users.
- `supabase/7-manage-team.ts` — Edge Function `manage-team`: admins add, edit, archive and set passphrases.
- `supabase/2-daily-report-function.ts` — Edge Function `daily-report`: builds a 3-tab .xlsx (summary, stage detail, day totals) and emails it via Resend. Secrets: RESEND_API_KEY (required), REPORT_TO, REPORT_FROM, SEND_HOUR, SEND_EMPTY.
- `supabase/3-schedule.sql` — pg_cron job, weekdays 16:30 and 17:30 UTC; the function only sends during the 17:xx UK hour.

Sync model: every change is written to localStorage and queued in an outbox; the outbox is flushed in order (orders before runs/notes) whenever online. The app pulls open orders (and anything updated in the last 14 days) on load and every 60 s when the outbox is empty.

Design and behaviour brief: see the original handoff README (stages, rules, screens, tokens, open questions) — kept below.

---
