import { getStore } from "@netlify/blobs";

export const config = { path: ["/api/deliveries", "/api/photo/:id", "/api/check"] };

const ID_RE = /^FD-[A-Za-z0-9-]{6,60}$/;
const MAX_PHOTO = 10 * 1024 * 1024;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

const clean = (v, max = 120) => String(v ?? "").slice(0, max).trim();

export default async (req, context) => {
  const url = new URL(req.url);
  const pin = process.env.ACCESS_PIN || "";
  const given = req.headers.get("x-pin") || url.searchParams.get("pin") || "";
  if (!pin || given !== pin) return json({ error: "bad_pin" }, 401);

  if (url.pathname === "/api/check") return json({ ok: true });

  const store = getStore({ name: "fuel-deliveries", consistency: "strong" });

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
    return json(recs.filter(Boolean));
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
    const litres = Number(meta.litres);
    if (!(litres > 0 && litres < 100000)) return json({ error: "bad_litres" }, 400);

    const rec = {
      id,
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
