import { getStore } from "@netlify/blobs";

export const config = { path: ["/api/deliveries", "/api/photo/:id", "/api/check", "/api/ping"] };

const ID_RE = /^FD-[A-Za-z0-9-]{6,60}$/;
const MAX_PHOTO = 10 * 1024 * 1024;
// Official start of the live register. Entries stamped before this (tests, stuck uploads) are discarded.
const REGISTER_START = "2026-10-13T19:05:00Z";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

const clean = (v, max = 120) => String(v ?? "").slice(0, max).trim();

export default async (req, context) => {
  const url = new URL(req.url);
  let pin = "";
  try { pin = (globalThis.Netlify?.env?.get("ACCESS_PIN") ?? process.env.ACCESS_PIN ?? "").trim(); } catch { pin = (process.env.ACCESS_PIN || "").trim(); }
  if (url.pathname === "/api/ping") return json({ ok: true, server: "running", pinConfigured: Boolean(pin), time: new Date().toISOString() });
  if (!pin) return json({ error: "not_configured" }, 503);
  const given = (req.headers.get("x-pin") || url.searchParams.get("pin") || "").replace(/\s+/g, "");
  if (given !== pin) return json({ error: "bad_pin" }, 401);

  if (url.pathname === "/api/check") return json({ ok: true });

  const store = getStore({ name: "fuel-register-oyingbo", consistency: "strong" });

  // Photo
  if (url.pathname.startsWith("/api/photo/")) {
    const id = context.params.id || "";
    if (!ID_RE.test(id)) return json({ error: "bad_id" }, 400);
    const buf = await store.get("img/" + id, { type: "arrayBuffer" });
    if (!buf) return json({ error: "not_found" }, 404);
    return new Response(buf, {
      headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=31536000, immutable" },
    });
  }

  // List register
  if (req.method === "GET") {
    const { blobs } = await store.list({ prefix: "rec/" });
    const recs = await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" })));
    return json(recs.filter((r) => r && String(r.stampedAt || "") >= REGISTER_START));
  }

  // Save a delivery (write-once: records and photos can never be overwritten or deleted)
  if (req.method === "POST") {
    let form;
    try { form = await req.formData(); } catch { return json({ error: "bad_form" }, 400); }
    let meta;
    try { meta = JSON.parse(form.get("meta")); } catch { return json({ error: "bad_meta" }, 400); }
    const photo = form.get("photo");
    const id = clean(meta.id, 80);
    if (!ID_RE.test(id)) return json({ error: "bad_id" }, 400);
    if (!photo || typeof photo.arrayBuffer !== "function") return json({ error: "no_photo" }, 400);
    if (photo.size > MAX_PHOTO) return json({ error: "photo_too_large" }, 413);
    if (!(String(meta.stampedAt || "") >= REGISTER_START)) return json({ ok: true, discarded: "before_register_start" });
    const type = meta.type === "decant" ? "decant" : "delivery";
    const stage = type === "delivery" && meta.stage === "start" ? "start" : "";
    const litres = Number(meta.litres);
    if (stage === "start" ? litres !== 0 : !(litres > 0 && litres < 100000)) return json({ error: "bad_litres" }, 400);
    const fromLoco = type === "decant" ? clean(meta.fromLoco, 20) : "";
    if (type === "decant" && (!fromLoco || fromLoco === clean(meta.loco, 20))) return json({ error: "bad_decant" }, 400);
    const rec = {
      id,
      type,
      fromLoco,
      stage,
      truckMeter: clean(meta.truckMeter, 20),
      locoMeter: clean(meta.locoMeter, 20),
      loco: clean(meta.loco, 20),
      litres,
      supplier: clean(meta.supplier),
      station: clean(meta.station, 60),
      waybill: clean(meta.waybill, 60),
      receivedBy: clean(meta.receivedBy, 80),
      witness: clean(meta.witness, 80),
      notes: clean(meta.notes, 200),
      capturedAt: clean(meta.capturedAt, 40),
      stampedAt: clean(meta.stampedAt, 40),
      fingerprint: clean(meta.fingerprint, 40),
      savedAt: new Date().toISOString(),
    };

    await store.set("img/" + id, await photo.arrayBuffer(), { onlyIfNew: true });
    const r = await store.setJSON("rec/" + id, rec, { onlyIfNew: true });
    return json({ ok: true, duplicate: !r.modified });
  }

  return json({ error: "method_not_allowed" }, 405);
};
