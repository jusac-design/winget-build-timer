// ============================================================
//  BUILD MATE — daily-report Edge Function
//  Weekday 17:30 UK email (including empty days). No weekend sends.
//  Send now (force) is admin-only.
//  At 18:00 UK, a watchdog alerts if the evening mail did not send.
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";
import * as XLSXNS from "npm:xlsx@0.18.5";

function xlsx() {
  const mod = XLSXNS as { default?: typeof XLSXNS; utils?: unknown; write?: unknown };
  const lib = (mod.utils && mod.write ? mod : mod.default) as typeof XLSXNS | undefined;
  if (!lib?.utils || !lib.write) throw new Error("xlsx did not load (no utils/write).");
  return lib;
}

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
const ukWeekday = () => {
  const w = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short" }).format(new Date());
  return w !== "Sat" && w !== "Sun";
};
const ukTime = (d: string) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(d));
const hm = (mins: number) => { const m = Math.round(mins); return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`; };
const dec = (mins: number) => Math.round((mins / 60) * 100) / 100;
const mins = (a: string, b: string) => (new Date(b).getTime() - new Date(a).getTime()) / 60000;

type Db = ReturnType<typeof createClient>;

async function resendMail(key: string, from: string, to: string, subject: string, html: string, attachments?: { filename: string; content: string }[]) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: to.split(",").map((x) => x.trim()).filter(Boolean),
      subject,
      html,
      ...(attachments && attachments.length ? { attachments } : {}),
    }),
  });
  const raw = await res.text();
  if (res.ok) return { ok: true as const, raw };
  let detail = raw;
  try {
    const parsed = JSON.parse(raw);
    detail = parsed.message || (typeof parsed.error === "string" ? parsed.error : parsed.error?.message) || raw;
  } catch { /* keep raw */ }
  return { ok: false as const, raw: "Resend HTTP " + res.status + "\n" + detail };
}

Deno.serve(async (req) => {
  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const db = createClient(url, service) as Db;

  let force = false;
  let watchdog = false;
  let resendKey = "";
  let mailTo = "";
  let mailFrom = "";
  let today = dayKey(new Date());

  async function logRow(kind: "report" | "alert" | "missed", status: "sent" | "failed", extra: { error?: string; orders_count?: number } = {}) {
    await db.from("report_sends").insert({
      day_key: today,
      kind,
      status,
      to_email: mailTo || null,
      orders_count: extra.orders_count ?? null,
      error: extra.error || null,
    });
  }

  async function loadMail() {
    const integ = await db.from("integrations").select("secret, config").eq("id", "resend").maybeSingle();
    if (integ.error) throw new Error(integ.error.message);
    const cfg = (integ.data && integ.data.config && typeof integ.data.config === "object") ? integ.data.config as Record<string, string> : {};
    resendKey = (integ.data && integ.data.secret) || Deno.env.get("RESEND_API_KEY") || "";
    mailTo = cfg.to || Deno.env.get("REPORT_TO") || "jusacsmith@gmail.com";
    mailFrom = cfg.from || Deno.env.get("REPORT_FROM") || "Build Mate <onboarding@resend.dev>";
    if (!resendKey) throw new Error("Resend is not set up. Add the API key in Admin → Settings.");
  }

  async function already(kind: "report" | "alert" | "missed", status?: "sent" | "failed") {
    let q = db.from("report_sends").select("id").eq("day_key", today).eq("kind", kind);
    if (status) q = q.eq("status", status);
    const { data } = await q.limit(1);
    return !!(data && data.length);
  }

  async function sendAlert(subject: string, html: string, kind: "alert" | "missed") {
    if (await already("alert", "sent") || await already("missed", "sent")) return { skipped: true };
    if (!resendKey) await loadMail();
    const sent = await resendMail(resendKey, mailFrom, mailTo, subject, html);
    await logRow(kind, sent.ok ? "sent" : "failed", { error: sent.ok ? undefined : sent.raw });
    return sent;
  }

  async function runWatchdog() {
    await loadMail();
    if (await already("report", "sent")) return json({ skipped: "Evening report already sent today." });
    if (await already("alert", "sent") || await already("missed", "sent")) return json({ skipped: "Admin already alerted today." });
    const why = (await already("report", "failed"))
      ? "The 17:30 UK send ran but failed. Check the earlier failure email, or use Send now."
      : "The 17:30 UK send did not run. The weekday job may have missed. Use Send now, or check Supabase cron.";
    const alert = await sendAlert(
      "Build Mate — evening report did not send",
      `<p>Build Mate did not send today's weekday report (${today}).</p><p>${why}</p>`,
      "missed",
    );
    return json({ missed: true, alerted: !("skipped" in alert && alert.skipped) });
  }

  try {
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { /* scheduled call has no body */ }
    force = body.force === true;
    watchdog = body.watchdog === true;

    const authHeader = req.headers.get("Authorization") || "";
    const userSb = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: sess } = await userSb.auth.getUser();

    if (force) {
      const uid = sess.user?.id;
      if (!uid) return json({ error: "Sign in first." }, 401);
      const me = await db.from("fitters").select("admin, supervisor").eq("id", uid).maybeSingle();
      if (me.error) return json({ error: me.error.message }, 500);
      if (!me.data?.admin && !me.data?.supervisor) return json({ error: "Only a supervisor or admin can send the report now." }, 403);
    } else if (sess.user) {
      return json({ error: "Only the evening schedule or Send now can email the report." }, 403);
    }

    today = dayKey(new Date());
    const selectedIds = Array.isArray(body.ids) ? [...new Set((body.ids as unknown[]).map((x) => String(x || "")).filter(Boolean))] : [];
    const selectedReport = force && selectedIds.length > 0;

    if (!force) {
      if (!ukWeekday()) return json({ skipped: "Weekend — no evening report." });
      if (watchdog) {
        if (ukHour() !== 18) return json({ skipped: "Not the 18:00 UK watchdog hour (" + ukHour() + ":xx)." });
        return await runWatchdog();
      }
      const sendHour = Number(Deno.env.get("SEND_HOUR") ?? "17");
      if (ukHour() !== sendHour) return json({ skipped: "Not the send hour in the UK (" + ukHour() + ":xx)." });
    }

    await loadMail();
    const now = new Date();
    const since = new Date(now.getTime() - 40 * 3600e3).toISOString();

    const ids = new Set<string>();
    if (selectedReport) {
      selectedIds.forEach((x) => ids.add(x));
    } else {
      const [rRecent, nRecent, oFinished, oActive] = await Promise.all([
        db.from("runs").select("order_id, started_at").gte("started_at", since),
        db.from("notes").select("order_id, created_at").gte("created_at", since),
        db.from("orders").select("id, finished_at").gte("finished_at", since),
        db.from("orders").select("id").not("active", "is", null),
      ]);
      for (const r of [rRecent, nRecent, oFinished, oActive]) if (r.error) throw new Error(r.error.message);
      rRecent.data!.filter((r) => dayKey(r.started_at) === today).forEach((r) => ids.add(r.order_id));
      nRecent.data!.filter((n) => dayKey(n.created_at) === today).forEach((n) => ids.add(n.order_id));
      oFinished.data!.filter((o) => dayKey(o.finished_at) === today).forEach((o) => ids.add(o.id));
      oActive.data!.forEach((o) => ids.add(o.id));
    }

    const idList = [...ids];
    const [orders, runs, notes] = idList.length
      ? await Promise.all([
          db.from("orders").select("*").in("id", idList).order("created_at"),
          db.from("runs").select("*").in("order_id", idList).order("started_at"),
          db.from("notes").select("*").in("order_id", idList).order("created_at"),
        ])
      : [{ data: [] }, { data: [] }, { data: [] }] as any;

    const allRuns = [...(runs.data ?? [])];
    for (const o of orders.data ?? []) {
      if (o.active) allRuns.push({ id: "live", order_id: o.id, stage: o.active.stage, unit: o.active.unit, fitter: o.active.fitter,
        started_at: new Date(o.active.start).toISOString(), stopped_at: now.toISOString(), live: true });
    }

    const t1: unknown[][] = [[selectedReport ? "Build Mate — selected works orders" : "Build Mate — end of day report", "", "", today]];
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

    const byId = new Map((orders.data ?? []).map((o: any) => [o.id, o]));
    const t2: unknown[][] = [["Works order", "Customer", "Machine", "Unit", "Stage #", "Process stage", "Function", "Fitter", "Start", "Stop", "Duration (Hr:Min)", "Duration (hours)", "Flag"]];
    const fitterMins: Record<string, number> = {}, fnMins: Record<string, number> = {};
    for (const r of allRuns.filter((r) => selectedReport || dayKey(r.started_at) === today)) {
      const o: any = byId.get(r.order_id); const s = STAGES.find((x) => x.n === r.stage);
      if (!s) continue;
      const m = mins(r.started_at, r.stopped_at);
      fitterMins[r.fitter ?? "—"] = (fitterMins[r.fitter ?? "—"] ?? 0) + m;
      fnMins[s.fn] = (fnMins[s.fn] ?? 0) + m;
      t2.push([o?.wo, o?.customer, o?.machine, r.unit, s.n, s.name, s.fn, r.fitter, ukTime(r.started_at), (r as any).live ? "still running" : ukTime(r.stopped_at), hm(m), dec(m), (r as any).live ? "Timer was still running when the report was made" : ""]);
    }

    const t3: unknown[][] = [["Hours by fitter", "Hr:Min", "Hours"]];
    Object.entries(fitterMins).sort().forEach(([k, v]) => t3.push([k, hm(v), dec(v)]));
    t3.push([], ["Hours by function", "Hr:Min", "Hours"]);
    ["Fabrication", "Stores", "Assembly", "Build", "QC"].forEach((f) => t3.push([f, hm(fnMins[f] ?? 0), dec(fnMins[f] ?? 0)]));

    const XLSX = xlsx();
    const wb = XLSX.utils.book_new();
    const ws1 = XLSX.utils.aoa_to_sheet(t1); ws1["!cols"] = [{ wch: 14 }, { wch: 14 }, { wch: 34 }, { wch: 16 }, { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 18 }, { wch: 10 }, { wch: 14 }];
    const ws2 = XLSX.utils.aoa_to_sheet(t2); ws2["!cols"] = [{ wch: 12 }, { wch: 22 }, { wch: 18 }, { wch: 6 }, { wch: 8 }, { wch: 34 }, { wch: 12 }, { wch: 18 }, { wch: 8 }, { wch: 13 }, { wch: 16 }, { wch: 14 }, { wch: 40 }];
    const ws3 = XLSX.utils.aoa_to_sheet(t3); ws3["!cols"] = [{ wch: 22 }, { wch: 10 }, { wch: 8 }];
    XLSX.utils.book_append_sheet(wb, ws1, "Works order summary");
    XLSX.utils.book_append_sheet(wb, ws2, "Stage detail");
    XLSX.utils.book_append_sheet(wb, ws3, "Day totals");
    const file = XLSX.write(wb, { type: "base64", bookType: "xlsx" });
    if (typeof file !== "string" || !file.length) throw new Error("xlsx write did not return a base64 file.");

    const html = `<div style="font-family:Arial,sans-serif;color:#373a36">
    <h2 style="margin:0 0 6px">Build Mate · ${selectedReport ? "selected works orders" : today}</h2>
    <p style="margin:0 0 14px;color:#6e7a7b">${selectedReport ? "To-date build times for the works orders you selected." : "Today's build times are attached as an Excel workbook."}</p>
    ${emailRows.length ? `<table style="border-collapse:collapse;font-size:13px"><tr style="background:#373a36;color:#fff"><th style="padding:6px 10px;text-align:left">Works order</th><th style="padding:6px 10px;text-align:left">Customer</th><th style="padding:6px 10px;text-align:left">Machine</th><th style="padding:6px 10px;text-align:right">Today</th><th style="padding:6px 10px;text-align:right">To date</th><th style="padding:6px 10px;text-align:left">Status</th></tr>${emailRows.join("")}</table>` : "<p>No work was logged today.</p>"}
  </div>`;

    const subject = selectedReport ? `Build Mate — selected works orders ${today}` : `Build Mate — build times ${today}`;
    const filename = selectedReport ? `Build-Mate-selected-${today}.xlsx` : `Build-Mate-${today}.xlsx`;
    const sent = await resendMail(resendKey, mailFrom, mailTo, subject, html, [{ filename, content: file }]);
    if (!sent.ok) {
      if (!selectedReport) await logRow("report", "failed", { error: sent.raw, orders_count: idList.length });
      if (!force) {
        await sendAlert(
          "Build Mate — evening report failed",
          `<p>The weekday evening report for ${today} failed.</p><pre style="white-space:pre-wrap">${sent.raw}</pre>`,
          "alert",
        );
      }
      return json({ error: sent.raw });
    }
    if (!selectedReport) await logRow("report", "sent", { orders_count: idList.length });
    return json({ sent: true, orders: idList.length, to: mailTo });
  } catch (e) {
    const msg = e instanceof Error ? (e.stack || e.message) : String(e);
    console.error(msg);
    try {
      if (!force && ukWeekday()) {
        await logRow("report", "failed", { error: msg });
        await sendAlert(
          "Build Mate — evening report failed",
          `<p>The weekday evening report for ${today} failed.</p><pre style="white-space:pre-wrap">${msg}</pre>`,
          "alert",
        );
      }
    } catch (alertErr) {
      console.error(alertErr);
    }
    return json({ error: msg });
  }
});
