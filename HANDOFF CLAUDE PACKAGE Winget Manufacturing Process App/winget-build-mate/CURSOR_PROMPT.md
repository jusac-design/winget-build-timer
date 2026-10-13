# Paste this into Cursor's AI chat (Ctrl + L)

I'm a beginner. Please read README.md in this repo first — it describes the whole app.

The live prototype is index.html (a bundled file — don't edit it directly). Readable source is in design/app-logic.js and design/app-template.html.

Please, step by step, with plain instructions for anything I need to click:

1. Turn the prototype into a clean, editable app in this repo (plain HTML + JavaScript is fine) that looks and behaves exactly like index.html, using the logo and fonts in assets/. It must still work on GitHub Pages.
2. Create Supabase tables for works orders, timer runs and notes, matching the data model in README.md.
3. Change the app so it saves to and loads from Supabase instead of localStorage, and still works if Wi-Fi drops (save locally, sync when back online).
4. Add a Supabase Edge Function, scheduled every weekday at 17:30 UK time, that builds the Excel workbook described in README.md and emails it to justin.smith@seddonplant.co.uk using Resend's free plan.

Keep it as simple as possible. After each step, tell me exactly what to test, then wait for me to say it works before moving on.
