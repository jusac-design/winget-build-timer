# Build Mate — Winget shop-floor build timer

Handoff brief for Cursor (or any developer). Read this first; it is self-contained.

## Overview

Build Mate is a tablet app for fitters building Winget concrete mixers at Seddon Plant & Engineers. A fitter signs in, opens a works order, picks which of 10 process stages they are on, and runs a stopwatch (as many start/stops as needed). When all 10 stages are complete they finish the job. At the end of each day, all recorded times are totalled per stage and emailed as an Excel workbook to the Production Manager.

Tone matters: this is a **helpful tool for fitters, not a monitoring tool**. Keep copy friendly and neutral. Never word anything as surveillance ("recorded against you", "tracked", etc.).

## What's in this folder

| Path | What it is |
|---|---|
| `index.html` | The working prototype as one self-contained file (1.2 MB, everything inlined). This is what GitHub Pages serves. **Do not edit it by hand** — it is a build output. |
| `design/app-logic.js` | Readable prototype logic: stage list, machine list, fitters, data model, timer rules, report maths. **Start here.** |
| `design/app-template.html` | Readable prototype markup with exact inline styles (colours, sizes, spacing). |
| `design/Build Mate prototype.dc.html` + `support.js` | The original prototype file (needs the design-system folder to render; reference only). |
| `assets/winget-logo.png` | Winget logo (yellow on black), 900×186. |
| `assets/fonts/` | Gotham Black (headings, weight 900) and Gotham Medium (body, weight 500). |
| `CURSOR_PROMPT.md` | Ready-to-paste request for the next build stage (Supabase + evening email). |

## Fidelity

**High fidelity.** Colours, type, layout and copy in the prototype are final. Recreate them closely. The prototype is a design reference; for the production build, a plain HTML + vanilla JS (or small React/Vite) app is fine — choose whatever is simplest to host on GitHub Pages.

## Target device

One **shared tablet** on the shop floor, landscape, used by many fitters during the day. Gloved hands: **minimum touch target 44px**, large text, high contrast. Must keep working if Wi-Fi drops.

## The process (fixed data)

10 process stages in 5 core functions. Reference times are the recorded 100T build (total 13h 15m). The model's fixed budget is 12h 45m. There is **no per-stage budget** — the per-stage figure shown is the last recorded actual, labelled "ref".

| # | Function | Colour | Stage | 100T ref | Key tasks |
|---|---|---|---|---|---|
| 1 | Fabrication | #00a3e0 | Fabricate | 0h 00m | Main Frame (UK), Prime (UK), outsourced |
| 2 | Stores | #8c4799 | Pick Parts | 0h 40m | Pick all components (excluding fixings) |
| 3 | Assembly | #e57200 | Sub-assemble Main Frame | 1h 00m | Main Frame (UK), Wheels, Towbar, Axle |
| 4 | Assembly | #e57200 | Sub-assemble Engine & Preparation | 1h 00m | Engine & W/Loom (UK), Engine Base Plate, Oil/Fuel |
| 5 | Assembly | #e57200 | Sub-assemble Trunnion | 2h 00m | Trunnion (UK), Tilt Wheel (INT), Chain Sprocket, Brackets |
| 6 | Assembly | #e57200 | Sub-assemble Drum | 2h 00m | Top Drum (INT), Bottom Drum (INT), Shaft (DC Assy) (INT), Tophat (DC Assy) (INT), Blades x2, Bonded/Fixed, Clamped/Spot Welded |
| 7 | Build | #009639 | Build up mixer | 1h 00m | Fit all sub-assemblies to mainframe, Engine (UK), Trunnion (UK), Drum (INT), Pulley Alignment, Belt Tensioning |
| 8 | QC | #e11f1c | Test / Inspection | 1h 00m | Engine Start, Drum Run Speed, Water Tightness, Drum Backlash |
| 9 | QC | #e11f1c | Paint | 4h 00m | Engine Bagged, Wheels Bagged, Masked, Prime, Topcoat |
| 10 | QC | #e11f1c | Finish | 0h 35m | Pull Cord Plate, Engine Stop Switch, Engine Lids* (UK), Engine Grills* (UK), Decals, Battery |

**Machines:** 100T ES Diesel (has ref times), 150T ES Diesel, 150TFT ES Diesel, 175T ES Diesel, 175TFT ES Diesel (no ref times yet — show "—" / "no ref").

**Fitters:** Alan Beardall, Andrew Thomond, Andrew Simpson, Clive Hope, Graham Hodge, Ian Carr, Ian Bradbury, Keagan Brindley, Neil Churchouse, Ryan Cave, Stuart Fildes.

**Report recipient:** justin.smith@seddonplant.co.uk (Production Manager).

## Screens

All screens sit inside one app frame. When signed in, a charcoal (#373a36) top bar (64px) is always visible: **Home button** (pill, house icon + "HOME" → returns to sign-in and signs the fitter out; running timers keep running), Winget logo (30px tall), current context (customer / WO · machine), a yellow running-timer pill when any timer is live, and the fitter avatar (tap = sign out).

On New works order, Stage list, Stage timer and Finish job, a white **breadcrumb bar** sits under the top bar: a large charcoal pill "‹ BACK TO …" (46px tall) followed by a breadcrumb trail (e.g. Works orders › WO 48217 › Stage 5 · Sub-assemble Trunnion). Earlier crumbs are underlined and tappable.

1. **Sign in** — charcoal background with a yellow 12°-skewed shape top-right, Winget logo (52px), title "BUILD MATE", line "Your build, logged as you go. Tap your name to get started." Fitter tiles in a 4-column grid (initials avatar in yellow + name, min 64px tall).
2. **Works orders (board)** — "Today · Tuesday 13 October" (20px), title "WORKS ORDERS", buttons "End of day report" (outline) and "+ New works order" (yellow). One card per order: WO number, status chip (Running = yellow, In progress = pale yellow, Finished = grey), customer · machine · qty line, yellow progress bar (stages complete / 10), total logged, "n of 10 stages", note count.
3. **New works order** — left: works order number display (up to **10 digits**, with "n / 10" counter) and a 3×4 keypad (1–9, C, 0, ⌫). Right: customer text input with "Most used" quick-pick chips (top 5 customers by number of works orders on this device, ties → most recent), machine picker (5 tiles, 2 columns), quantity stepper (1–20), and — only if qty > 1 — choose "One timer for the batch" or "Separate timer per unit". Optional notes textarea. "Open works order" button enabled only when WO number, customer and machine are set.
4. **Stage list** — header with order meta, title, unit switcher (per-unit orders only, 44px squares), total logged. 10 stage rows (min 62px): number, function label in function colour, stage name, logged time, ref time, status chip (Not started / In progress / Running / Complete). 6px left border in function colour. Below: **Works order notes** card — list of notes (text, fitter, date & time; newest first) and an add-note box. Footer: hint text + "Works order complete" button, enabled only when all 10 stages are complete.
5. **Stage timer** — stage number · function, stage name, WO · machine (· unit n of N). Big clock panel (charcoal when idle, yellow when running) with 58px monospace clock, ref line, and a 150px round Start (green #009639) / Stop (charcoal) button. "Mark stage complete" (green) / "Reopen stage" (outline). Right column (330px): key tasks list; list of runs (start → stop, fitter, duration), live run highlighted pale yellow.
6. **Finish job** — table: #, stage, reference, logged; works order total row; line comparing total to the fixed budget (or "No reference times exist for this model yet…"); notes block; "Finish job" yellow button. Finishing stops any running timer, marks the order Finished and queues it for tonight's report.
7. **End of day report** (modal) — per works order: WO, customer · machine · qty, notes, rows per stage with Hr:Min and decimal hours, works order total row. "Send now" (yellow → green "Sent ✓").

## Rules

- **One live timer per works order.** Starting a stage stops whatever else is running on that order. Different works orders can run in parallel.
- **Each start/stop is stored as its own run.** Totals are always calculated from runs, never stored.
- Stages can be done in **any order**; all 10 must be complete to finish.
- Marking a stage complete stops its timer. A completed stage can be reopened; more time just adds runs.
- Per-unit orders: runs carry a unit number; the stage list and timer filter by the selected unit; the report totals all units.
- Every run and note is stamped with the signed-in fitter.

## Data model

```
WorksOrder { id, wo (string, ≤10 digits), customer, machine, hasRef, qty, mode: 'batch'|'unit',
             done, finishedAt, complete: number[] (stage numbers), active: Run|null,
             runs: Run[], notes: Note[] }
Run  { stage (1–10), unit, fitter, start (ms), stop (ms) }
Note { text, fitter, at (ms) }
```

The prototype keeps everything in the browser (`localStorage` key `winget-build-timer-v1`).

## End-of-day spreadsheet (to build)

Excel (.xlsx), emailed each weekday evening to justin.smith@seddonplant.co.uk, covering every works order touched that day.
- **Tab 1 — Works order summary:** one block per order (WO, customer, machine, qty, status, notes), then the 10 stages with total time in **Hr:Min and decimal hours**, then the works order total vs the model's fixed budget.
- **Tab 2 — Stage detail:** every run: WO, unit, stage, fitter, start, stop, duration.
- **Tab 3 — Day totals:** hours by function and by fitter.

Note: the existing workbook writes stage times as H.MM where the decimals are literal minutes (1.00 = 1h 00m), while the budget is decimal hours (12.75 = 12h 45m). Write both formats.

## Design tokens

- Winget yellow (primary accent, CTAs, running state): **#fdc42b**; hover #e8b01f
- Pale yellow (in-progress / highlights): #fff6dc; chip #f3e2b0 with text #5c4300; amber text on light #8a6400
- Charcoal (top bar, headings, text): #373a36; greys #4d585a, #6e7a7b, #8b9596, #bac5c3, #d6dcdb, #e9eded; app background #f4f6f6; cards #ffffff
- Green (Start, Complete, Sent): #009639. Focus ring blue: #01b4dd
- **Text on yellow is always charcoal #373a36**, never white.
- Type: Gotham Black 900 for headings (ALL CAPS, tracking −0.02em), Gotham Medium 500 for body, labels 9–10px uppercase tracking 0.1–0.16em; numbers/clocks in a monospace (ui-monospace, Menlo).
- Radii: cards 12–16px, panels 18px, buttons are pills (999px). Shadow: 0 1px 3px rgba(109,122,123,.14).

## Open questions (not yet answered)

1. Per-stage budget times — do they exist, or only the model total?
2. Times for the 150T, 150TFT, 175T, 175TFT — and do they use the same 10 stages?
3. Where works order numbers come from (could be picked rather than typed).
4. What time the evening email sends, and whether to send on days with no work logged.
5. Who can correct a mistimed run or reopen a finished order (supervisor PIN?).
