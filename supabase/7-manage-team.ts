// Build Mate — manage-team Edge Function
// Admins only: add, edit, archive, restore, set passphrase.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const authHeader = req.headers.get("Authorization") || "";
  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const userSb = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const db = createClient(url, service);

  const { data: sess } = await userSb.auth.getUser();
  const uid = sess.user?.id;
  if (!uid) return json({ error: "Sign in first." }, 401);

  const me = await db.from("fitters").select("id, admin").eq("id", uid).maybeSingle();
  if (me.error) return json({ error: me.error.message }, 500);
  if (!me.data?.admin) return json({ error: "Only an admin can manage the team." }, 403);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return json({ error: "Missing request body." }, 400); }
  const action = String(body.action || "");
  const id = String(body.id || "");
  const full_name = String(body.full_name || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const admin = body.admin === true;

  async function list() {
    const { data, error } = await db.from("fitters").select("id, full_name, email, active, admin").order("full_name");
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, fitters: data || [] });
  }

  if (action === "list") return list();

  async function listIntegrations() {
    const { data, error } = await db.from("integrations").select("id, label, config, secret, secret_hint, updated_at").order("label");
    if (error) return json({ error: error.message }, 500);
    const integrations = (data || []).map((row) => ({
      id: row.id,
      label: row.label,
      config: row.config || {},
      secret_hint: row.secret_hint || (row.secret ? String(row.secret).slice(-4) : ""),
      has_secret: !!(row.secret && String(row.secret).length),
      updated_at: row.updated_at,
    }));
    return json({ ok: true, integrations });
  }

  if (action === "integrations_list") return listIntegrations();

  if (action === "integrations_save") {
    const intId = String(body.id || "");
    if (!intId) return json({ error: "Pick an integration first." }, 400);
    const cfgIn = body.config && typeof body.config === "object" ? body.config as Record<string, unknown> : {};
    const from = String(cfgIn.from || "").trim();
    const to = String(cfgIn.to || "").trim();
    const secret = String(body.secret || "").trim();
    const patch: Record<string, unknown> = {
      config: { from, to },
      updated_at: new Date().toISOString(),
    };
    if (secret) {
      patch.secret = secret;
      patch.secret_hint = secret.slice(-4);
    }
    const up = await db.from("integrations").update(patch).eq("id", intId);
    if (up.error) return json({ error: up.error.message }, 500);
    const listed = await listIntegrations();
    const payload = await listed.json();
    return json({ ...payload, message: secret ? "Resend key saved." : "Settings saved." });
  }

  if (action === "integrations_test") {
    const intId = String(body.id || "resend");
    const testTo = String(body.test_to || "").trim();
    if (!testTo || !testTo.includes("@")) return json({ error: "Enter a test email address." }, 400);
    const row = await db.from("integrations").select("secret, config").eq("id", intId).maybeSingle();
    if (row.error) return json({ error: row.error.message }, 500);
    const typedKey = String(body.secret || "").trim();
    const savedKey = row.data && row.data.secret ? String(row.data.secret) : "";
    const key = typedKey || savedKey;
    if (!key) return json({ error: "No API key. Paste a Resend key above, or Save one first, then Send test." }, 400);
    const cfg = row.data && row.data.config && typeof row.data.config === "object" ? row.data.config as Record<string, string> : {};
    const from = String(body.from || cfg.from || "Build Mate <onboarding@resend.dev>").trim();
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [testTo],
        subject: "Build Mate — Resend test",
        html: "<p>This is a test from Build Mate Admin → Settings.</p><p>If you received this, the Resend API key is working.</p>",
      }),
    });
    const raw = await res.text();
    if (!res.ok) {
      let detail = raw;
      try {
        const parsed = JSON.parse(raw);
        detail = parsed.message || parsed.error || (parsed.name ? parsed.name + ": " + (parsed.message || raw) : raw);
      } catch { /* keep raw */ }
      return json({ error: "Resend HTTP " + res.status + "\n" + detail }, 400);
    }
    return json({ ok: true, message: "Test email sent to " + testTo + "." });
  }

  async function listOrders() {
    const { data, error } = await db.from("orders")
      .select("id, wo, customer, machine, qty, mode, done, active, archived, complete, created_at, updated_at, finished_at")
      .order("created_at", { ascending: false });
    if (error) return json({ error: error.message }, 500);
    const ids = (data || []).map((row) => row.id);
    const logged: Record<string, number> = {};
    if (ids.length) {
      const runs = await db.from("runs").select("order_id, started_at, stopped_at").in("order_id", ids);
      if (runs.error) return json({ error: runs.error.message }, 500);
      for (const r of runs.data || []) {
        const a = new Date(r.started_at).getTime();
        const b = new Date(r.stopped_at).getTime();
        if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) continue;
        logged[r.order_id] = (logged[r.order_id] || 0) + (b - a);
      }
    }
    const orders = (data || []).map((row) => ({ ...row, logged_ms: logged[row.id] || 0 }));
    return json({ ok: true, orders });
  }

  if (action === "orders_list") return listOrders();

  if (action === "order_archive" || action === "order_restore" || action === "order_delete") {
    if (!id) return json({ error: "Pick a works order first." }, 400);
    const row = await db.from("orders").select("id, wo, active, archived").eq("id", id).maybeSingle();
    if (row.error) return json({ error: row.error.message }, 500);
    if (!row.data) return json({ error: "That works order was not found." }, 400);
    if (row.data.active) return json({ error: "Stop the timer on WO " + row.data.wo + " before you archive or delete it." }, 400);
    if (action === "order_delete") {
      const del = await db.from("orders").delete().eq("id", id);
      if (del.error) return json({ error: del.error.message }, 500);
      const listed = await listOrders();
      const payload = await listed.json();
      return json({ ...payload, message: "WO " + row.data.wo + " deleted." });
    }
    const archived = action === "order_archive";
    const up = await db.from("orders").update({ archived, updated_at: new Date().toISOString() }).eq("id", id);
    if (up.error) return json({ error: up.error.message }, 500);
    const listed = await listOrders();
    const payload = await listed.json();
    return json({ ...payload, message: archived ? "WO " + row.data.wo + " archived." : "WO " + row.data.wo + " restored to the shop list." });
  }

  if (action === "create") {
    if (!full_name || !email || password.length < 8) {
      return json({ error: "Name, email and a passphrase of at least 8 characters are required." }, 400);
    }
    const created = await db.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name },
    });
    if (created.error) return json({ error: created.error.message }, 400);
    const newId = created.data.user!.id;
    const up = await db.from("fitters").upsert({ id: newId, full_name, email, active: true, admin });
    if (up.error) return json({ error: up.error.message }, 500);
    return list();
  }

  if (!id) return json({ error: "Pick a person first." }, 400);
  if (id === uid && (action === "archive" || (action === "update" && admin === false))) {
    return json({ error: "You cannot archive or remove admin from your own login." }, 400);
  }

  if (action === "update") {
    if (!full_name) return json({ error: "Name is required." }, 400);
    const authUp = await db.auth.admin.updateUserById(id, { user_metadata: { full_name } });
    if (authUp.error) return json({ error: authUp.error.message }, 400);
    const up = await db.from("fitters").update({ full_name, admin }).eq("id", id);
    if (up.error) return json({ error: up.error.message }, 500);
    return list();
  }

  if (action === "password") {
    if (password.length < 8) return json({ error: "Passphrase must be at least 8 characters." }, 400);
    const authUp = await db.auth.admin.updateUserById(id, { password });
    if (authUp.error) return json({ error: authUp.error.message }, 400);
    return json({ ok: true, message: "Passphrase updated." });
  }

  if (action === "archive") {
    const lastAdmin = await db.from("fitters").select("id").eq("admin", true).eq("active", true);
    if (!lastAdmin.error && (lastAdmin.data || []).length <= 1) {
      const target = await db.from("fitters").select("admin").eq("id", id).maybeSingle();
      if (target.data?.admin) return json({ error: "Keep at least one active admin." }, 400);
    }
    const up = await db.from("fitters").update({ active: false }).eq("id", id);
    if (up.error) return json({ error: up.error.message }, 500);
    await db.auth.admin.updateUserById(id, { ban_duration: "876000h" });
    return list();
  }

  if (action === "restore") {
    const up = await db.from("fitters").update({ active: true }).eq("id", id);
    if (up.error) return json({ error: up.error.message }, 500);
    await db.auth.admin.updateUserById(id, { ban_duration: "none" });
    return list();
  }

  return json({ error: "Unknown action." }, 400);
});
