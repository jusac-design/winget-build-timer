// ============================================================
//  BUILD MATE — daily-report Edge Function
//  Builds the end-of-day Excel workbook and emails it via Resend.
//  Paste ALL of this into Supabase → Edge Functions → Deploy a new function → Via Editor.
//  Name the function:  daily-report
//
//  Secrets (Edge Functions → Secrets):
//    RESEND_API_KEY   required — from resend.com → API Keys
//    REPORT_TO        optional — defaults to justin.smith@seddonplant.co.uk
//    REPORT_FROM      optional — defaults to Build Mate <onboarding@resend.dev>
//    SEND_HOUR        optional — UK hour to send, defaults to 17 (the schedule runs at :30)
//    SEND_EMPTY       optional — "yes" to send on days with no work logged
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";
import * as XLSX from "https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs";

const STAGES = [
  { n: 1, fn: "Fabrication", name: "Fabricate", ref: 0 },
  { n: 2, fn: "Stores", name: "Pick Parts", ref: 40 },
  { n: 3, fn: "Assembly", name: "Sub-assemble Main Frame", ref: 60 },
  { n: 4, fn: "Assembly", name: "Sub-assemble Engine & Preparation", ref: 60 },
  { n: 5, fn: "Assembly", name: "Sub-assemble Trunnion", ref: 120 },
  { n: 6, fn: "Assembly", name: "Sub-assemble Drum", ref: 120 },
  { n: 7, fn: "Build", name: "Build up mixer", ref: 60 },
  { n: 8, fn: "QC", name: "Test / Inspection", ref: 60 },
  { n: 9, fn: "QC", name: "Paint", ref: 240 },
  { n: 10, fn: "QC", name: "Finish", ref: 35 },
];
const FIXED_BUDGET_100T = 765;
const TZ = "Europe/London";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

const dayKey = (d: Date | string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(d));
const ukHour = () => Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hour12: false }).format(new Date()));
const ukTime = (d: string) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(d));
const hm = (mins: number) => { const m = Math.round(mins); return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`; };
const dec = (mins: number) => Math.round((mins / 60) * 100) / 100;
const mins = (a: string, b: string) => (new Date(b).getTime() - new Date(a).getTime()) / 60000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* scheduled call has no body */ }
  const force = body.force === true;

  const sendHour = Number(Deno.env.get("SEND_HOUR") ?? "17");
  if (!force && ukHour() !== sendHour) return json({ skipped: "Not the send hour in the UK (" + ukHour() + ":xx)." });

  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) return json({ error: "RESEND_API_KEY secret is missing." }, 500);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const now = new Date();
  const today = dayKey(now);
  const since = new Date(now.getTime() - 40 * 3600e3).toISOString();

  const [rRecent, nRecent, oFinished, oActive] = await Promise.all([
    db.from("runs").select("order_id, started_at").gte("started_at", since),
    db.from("notes").select("order_id, created_at").gte("created_at", since),
    db.from("orders").select("id, finished_at").gte("finished_at", since),
    db.from("orders").select("id").not("active", "is", null),
  ]);
  for (const r of [rRecent, nRecent, oFinished, oActive]) if (r.error) return json({ error: r.error.message }, 500);

  const ids = new Set<string>();
  rRecent.data!.filter((r) => dayKey(r.started_at) === today).forEach((r) => ids.add(r.order_id));
  nRecent.data!.filter((n) => dayKey(n.created_at) === today).forEach((n) => ids.add(n.order_id));
  oFinished.data!.filter((o) => dayKey(o.finished_at) === today).forEach((o) => ids.add(o.id));
  oActive.data!.forEach((o) => ids.add(o.id));

  const sendEmpty = (Deno.env.get("SEND_EMPTY") ?? "").toLowerCase() === "yes";
  if (!ids.size && !force && !sendEmpty) return json({ skipped: "No work logged today, nothing sent." });

  const idList = [...ids];
  const [orders, runs, notes] = idList.length
    ? await Promise.all([
        db.from("orders").select("*").in("id", idList).order("created_at"),
        db.from("runs").select("*").in("order_id", idList).order("started_at"),
        db.from("notes").select("*").in("order_id", idList).order("created_at"),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }] as any;

  // Treat a timer that is still running as stopping now.
  const allRuns = [...(runs.data ?? [])];
  for (const o of orders.data ?? []) {
    if (o.active) allRuns.push({ id: "live", order_id: o.id, stage: o.active.stage, unit: o.active.unit, fitter: o.active.fitter,
      started_at: new Date(o.active.start).toISOString(), stopped_at: now.toISOString(), live: true });
  }

  // ---- Tab 1: works order summary ----
  const t1: unknown[][] = [["Build Mate — end of day report", "", "", today]];
  const emailRows: string[] = [];
  for (const o of orders.data ?? []) {
    const oRuns = allRuns.filter((r) => r.order_id === o.id);
    const oNotes = (notes.data ?? []).filter((n: any) => n.order_id === o.id);
    const status = o.done ? "Finished" : o.active ? "Timer running" : "In progress";
    t1.push([]);
    t1.push(["Works order", o.wo, "Customer", o.customer, "Machine", o.machine, "Qty", o.qty, "Status", status]);
    if (oNotes.length) t1.push(["Notes", oNotes.map((n: any) => `${n.text} (${n.fitter})`).join("  |  ")]);
    t1.push(["#", "Function", "Process stage", "Today (Hr:Min)", "Today (hours)", "To date (Hr:Min)", "To date (hours)", "Reference (Hr:Min)"]);
    let tToday = 0, tAll = 0;
    for (const s of STAGES) {
      const sr = oRuns.filter((r) => r.stage === s.n);
      const all = sr.reduce((a, r) => a + mins(r.started_at, r.stopped_at), 0);
      const day = sr.filter((r) => dayKey(r.started_at) === today).reduce((a, r) => a + mins(r.started_at, r.stopped_at), 0);
      tToday += day; tAll += all;
      t1.push([s.n, s.fn, s.name, hm(day), dec(day), hm(all), dec(all), o.has_ref ? hm(s.ref) : "—"]);
    }
    t1.push(["", "", "Works order total", hm(tToday), dec(tToday), hm(tAll), dec(tAll), o.has_ref ? hm(STAGES.reduce((a, s) => a + s.ref, 0)) : "—"]);
    if (o.has_ref) t1.push(["", "", "Fixed budget", "", "", hm(FIXED_BUDGET_100T), dec(FIXED_BUDGET_100T)]);
    emailRows.push(`<tr><td style="padding:6px 10px;border-bottom:1px solid #e9eded"><b>WO ${o.wo}</b></td><td style="padding:6px 10px;border-bottom:1px solid #e9eded">${o.customer ?? ""}</td><td style="padding:6px 10px;border-bottom:1px solid #e9eded">${o.machine ?? ""}</td><td style="padding:6px 10px;border-bottom:1px solid #e9eded;text-align:right">${hm(tToday)}</td><td style="padding:6px 10px;border-bottom:1px solid #e9eded;text-align:right">${hm(tAll)}</td><td style="padding:6px 10px;border-bottom:1px solid #e9eded">${status}</td></tr>`);
  }
  if (!(orders.data ?? []).length) t1.push([], ["No work was logged today."]);

  // ---- Tab 2: every start and stop today ----
  const byId = new Map((orders.data ?? []).map((o: any) => [o.id, o]));
  const t2: unknown[][] = [["Works order", "Customer", "Machine", "Unit", "Stage #", "Process stage", "Function", "Fitter", "Start", "Stop", "Duration (Hr:Min)", "Duration (hours)", "Flag"]];
  const fitterMins: Record<string, number> = {}, fnMins: Record<string, number> = {};
  for (const r of allRuns.filter((r) => dayKey(r.started_at) === today)) {
    const o: any = byId.get(r.order_id); const s = STAGES.find((x) => x.n === r.stage)!;
    const m = mins(r.started_at, r.stopped_at);
    fitterMins[r.fitter ?? "—"] = (fitterMins[r.fitter ?? "—"] ?? 0) + m;
    fnMins[s.fn] = (fnMins[s.fn] ?? 0) + m;
    t2.push([o?.wo, o?.customer, o?.machine, r.unit, s.n, s.name, s.fn, r.fitter, ukTime(r.started_at), (r as any).live ? "still running" : ukTime(r.stopped_at), hm(m), dec(m), (r as any).live ? "Timer was still running when the report was made" : ""]);
  }

  // ---- Tab 3: day totals ----
  const t3: unknown[][] = [["Hours by fitter", "Hr:Min", "Hours"]];
  Object.entries(fitterMins).sort().forEach(([k, v]) => t3.push([k, hm(v), dec(v)]));
  t3.push([], ["Hours by function", "Hr:Min", "Hours"]);
  ["Fabrication", "Stores", "Assembly", "Build", "QC"].forEach((f) => t3.push([f, hm(fnMins[f] ?? 0), dec(fnMins[f] ?? 0)]));

  const wb = XLSX.utils.book_new();
  const ws1 = XLSX.utils.aoa_to_sheet(t1); ws1["!cols"] = [{ wch: 14 }, { wch: 14 }, { wch: 34 }, { wch: 16 }, { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 18 }, { wch: 10 }, { wch: 14 }];
  const ws2 = XLSX.utils.aoa_to_sheet(t2); ws2["!cols"] = [{ wch: 12 }, { wch: 22 }, { wch: 18 }, { wch: 6 }, { wch: 8 }, { wch: 34 }, { wch: 12 }, { wch: 18 }, { wch: 8 }, { wch: 13 }, { wch: 16 }, { wch: 14 }, { wch: 40 }];
  const ws3 = XLSX.utils.aoa_to_sheet(t3); ws3["!cols"] = [{ wch: 22 }, { wch: 10 }, { wch: 8 }];
  XLSX.utils.book_append_sheet(wb, ws1, "Works order summary");
  XLSX.utils.book_append_sheet(wb, ws2, "Stage detail");
  XLSX.utils.book_append_sheet(wb, ws3, "Day totals");
  const file = XLSX.write(wb, { type: "base64", bookType: "xlsx" });

  const to = Deno.env.get("REPORT_TO") ?? "justin.smith@seddonplant.co.uk";
  const from = Deno.env.get("REPORT_FROM") ?? "Build Mate <onboarding@resend.dev>";
  const html = `<div style="font-family:Arial,sans-serif;color:#373a36">
    <h2 style="margin:0 0 6px">Build Mate · ${today}</h2>
    <p style="margin:0 0 14px;color:#6e7a7b">Today's build times are attached as an Excel workbook.</p>
    ${emailRows.length ? `<table style="border-collapse:collapse;font-size:13px"><tr style="background:#373a36;color:#fff"><th style="padding:6px 10px;text-align:left">Works order</th><th style="padding:6px 10px;text-align:left">Customer</th><th style="padding:6px 10px;text-align:left">Machine</th><th style="padding:6px 10px;text-align:right">Today</th><th style="padding:6px 10px;text-align:right">To date</th><th style="padding:6px 10px;text-align:left">Status</th></tr>${emailRows.join("")}</table>` : "<p>No work was logged today.</p>"}
  </div>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from, to: to.split(",").map((x) => x.trim()),
      subject: `Build Mate — build times ${today}`,
      html,
      attachments: [{ filename: `Build-Mate-${today}.xlsx`, content: file }],
    }),
  });
  if (!res.ok) return json({ error: "Resend: " + (await res.text()) }, 502);
  return json({ sent: true, orders: idList.length, to });
});
