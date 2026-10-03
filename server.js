/* Zero-dependency server for the clinic shift demo.
   - serves the PWA from ./public
   - GET  /api/feedback     latest feedback for the manager's in-app tab (X-Clinic-Key)
   - POST /api/feedback     stores feedback/log events (JSON lines) in DATA_DIR/feedback.jsonl
   - GET  /admin            developer dashboard (HTTP Basic auth, password from ADMIN_PASSWORD)
   - GET  /admin/export.json | /admin/export.csv
   - GET/POST /api/db       shared clinic database (DATA_DIR/db.json), header X-Clinic-Key = CLINIC_PASSWORD
   - GET  /healthz
   Env: PORT (default 3000), DATA_DIR (default ./data), ADMIN_PASSWORD (required for /admin), ADMIN_USER (default "dev"),
        CLINIC_PASSWORD (required for /api/db) */
"use strict";
const http = require("http"), fs = require("fs"), path = require("path"), crypto = require("crypto");

const PORT = +process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, "public");
const DATA = path.resolve(process.env.DATA_DIR || path.join(__dirname, "data"));
const FILE = path.join(DATA, "feedback.jsonl");
const ADMIN_USER = process.env.ADMIN_USER || "dev";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const CLINIC_PASSWORD = process.env.CLINIC_PASSWORD || "";
fs.mkdirSync(DATA, { recursive: true });

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8", ".ico": "image/x-icon" };
const SECURITY = {
  "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY",
  "Content-Security-Policy": "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-eval'; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
};

function send(res, code, body, headers = {}) { res.writeHead(code, { ...SECURITY, ...headers }); res.end(body); }

/* ---- static files ---- */
function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath);
  if (rel.endsWith("/")) rel += "index.html";
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) return send(res, 403, "forbidden");
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      // unknown paths fall back to the app (so /?source=home etc. work)
      if (!path.extname(rel)) return serveStatic(req, res, "/index.html");
      return send(res, 404, "not found", { "Content-Type": "text/plain; charset=utf-8" });
    }
    const ext = path.extname(file).toLowerCase();
    const etag = `"${st.size.toString(36)}-${st.mtimeMs.toString(36)}"`;
    const longCache = /\/(fonts|icons|vendor)\//.test(file);
    const headers = { "Content-Type": MIME[ext] || "application/octet-stream", ETag: etag,
      "Cache-Control": longCache ? "public, max-age=604800" : "no-cache" };
    if (path.basename(file) === "sw.js") headers["Service-Worker-Allowed"] = "/";
    if (req.headers["if-none-match"] === etag) return send(res, 304, "", headers);
    res.writeHead(200, { ...SECURITY, ...headers });
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

/* ---- feedback API ---- */
const buckets = new Map(); // simple rate limit: 30 requests/minute per client
function limited(req) {
  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
  const now = Date.now(), b = buckets.get(ip) || { n: 0, t: now };
  if (now - b.t > 60000) { b.n = 0; b.t = now; }
  b.n++; buckets.set(ip, b);
  return b.n > 30;
}
setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (now - b.t > 120000) buckets.delete(k); }, 60000).unref();

const clip = (v, n) => typeof v === "string" ? v.slice(0, n) : v;
function cleanEvent(e) {
  if (!e || typeof e !== "object") return null;
  const type = ["feedback", "nlu_miss", "nlu_ok", "nlu_correction", "error"].includes(e.type) ? e.type : null;
  if (!type) return null;
  const out = { id: clip(String(e.id || ""), 40), type, at: +e.at || Date.now(), v: clip(String(e.v || ""), 20), device: clip(String(e.device || ""), 20), user: clip(e.user == null ? null : String(e.user), 40),
    role: clip(e.role == null ? null : String(e.role), 20), tab: clip(e.tab == null ? null : String(e.tab), 20), standalone: !!e.standalone, receivedAt: Date.now() };
  for (const k of ["kind", "text", "msg", "src"]) if (e[k] != null) out[k] = clip(String(e[k]), 2000);
  if (e.line != null) out.line = +e.line || 0;
  for (const k of ["misses", "rejected", "unclear", "trail"]) if (Array.isArray(e[k])) out[k] = e[k].slice(0, 20).map(x => clip(String(x), 400));
  if (e.parsed && typeof e.parsed === "object") out.parsed = e.parsed;
  if (e.final && typeof e.final === "object") out.final = e.final;
  if (e.actions != null) out.actions = +e.actions || 0;
  return out;
}
function readBody(req, max) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", c => { size += c.length; if (size > max) { reject(new Error("too large")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
const seen = new Set();
function loadEvents() {
  if (!fs.existsSync(FILE)) return [];
  return fs.readFileSync(FILE, "utf8").split("\n").filter(Boolean).map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
}
for (const e of loadEvents()) seen.add(e.id);

/* خلاصهٔ کار انجام‌شده برای هر نظر (فقط با رمز admin نوشته می‌شود): { [eventId]: "یک جمله" } */
const RESFILE = path.join(DATA, "resolutions.json");
function loadRes() { try { return JSON.parse(fs.readFileSync(RESFILE, "utf8")); } catch (e) { return {}; } }
async function postResolutions(req, res) {
  const J = { "Content-Type": "application/json; charset=utf-8" };
  let body;
  try { body = JSON.parse(await readBody(req, 64 * 1024)); } catch (e) { return send(res, 400, JSON.stringify({ error: "bad json" }), J); }
  const cur = loadRes(); let n = 0;
  for (const [id, t] of Object.entries(body && typeof body === "object" ? body : {})) {
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(id) || typeof t !== "string") continue;
    cur[id] = t.slice(0, 300); n++;
  }
  const tmp = RESFILE + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(cur)); fs.renameSync(tmp, RESFILE);
  send(res, 200, JSON.stringify({ ok: true, stored: n }), J);
}

async function postFeedback(req, res) {
  if (limited(req)) return send(res, 429, JSON.stringify({ error: "rate" }), { "Content-Type": "application/json" });
  let body;
  try { body = JSON.parse(await readBody(req, 256 * 1024)); } catch (e) { return send(res, 400, JSON.stringify({ error: "bad json" }), { "Content-Type": "application/json" }); }
  const events = (Array.isArray(body.events) ? body.events : []).slice(0, 50).map(cleanEvent).filter(e => e && !seen.has(e.id));
  if (events.length) { fs.appendFileSync(FILE, events.map(e => JSON.stringify(e)).join("\n") + "\n"); events.forEach(e => seen.add(e.id)); }
  send(res, 200, JSON.stringify({ ok: true, stored: events.length }), { "Content-Type": "application/json" });
}


/* ---- shared database: { seq, docs: { path: { d: data|null, s: seq } } }, last write wins in arrival order ---- */
const DBFILE = path.join(DATA, "db.json");
const store = (() => { try { return JSON.parse(fs.readFileSync(DBFILE, "utf8")); } catch (e) { return { seq: 0, docs: {} }; } })();
let saveTimer = null;
function saveStore() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; const tmp = DBFILE + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(store)); fs.renameSync(tmp, DBFILE); }, 200);
}
function flushStore() { if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; const tmp = DBFILE + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(store)); fs.renameSync(tmp, DBFILE); } }
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => { flushStore(); process.exit(0); });
function clinicAuthed(req) {
  if (!CLINIC_PASSWORD) return false;
  const a = crypto.createHash("sha256").update(String(req.headers["x-clinic-key"] || "")).digest();
  const b = crypto.createHash("sha256").update(CLINIC_PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}
const DOC_PATH = /^[A-Za-z0-9_\-]{1,80}(\/[A-Za-z0-9_\-]{1,80}){1,3}$/;
async function dbApi(req, res, url) {
  const J = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
  if (!CLINIC_PASSWORD) return send(res, 503, JSON.stringify({ error: "disabled" }), J);
  if (!clinicAuthed(req)) return send(res, limited(req) ? 429 : 401, JSON.stringify({ error: "auth" }), J);
  if (req.method === "GET") {
    const since = +url.searchParams.get("since") || 0, docs = {};
    for (const [p, v] of Object.entries(store.docs)) if (v.s > since) docs[p] = v.d;
    return send(res, 200, JSON.stringify({ seq: store.seq, docs }), J);
  }
  if (req.method === "POST") {
    let body;
    try { body = JSON.parse(await readBody(req, 8 * 1024 * 1024)); } catch (e) { return send(res, 400, JSON.stringify({ error: "bad json" }), J); }
    const ops = Array.isArray(body.ops) ? body.ops.slice(0, 5000) : [];
    for (const o of ops) {
      if (!o || typeof o.p !== "string" || !DOC_PATH.test(o.p)) continue;
      store.seq++; store.docs[o.p] = { d: o.d && typeof o.d === "object" ? o.d : null, s: store.seq };
    }
    if (ops.length) saveStore();
    return send(res, 200, JSON.stringify({ seq: store.seq }), J);
  }
  return send(res, 405, "method not allowed");
}

/* ---- admin ---- */
function authed(req) {
  if (!ADMIN_PASSWORD) return false;
  const h = req.headers.authorization || "";
  if (!h.startsWith("Basic ")) return false;
  const [u, p] = Buffer.from(h.slice(6), "base64").toString("utf8").split(":");
  const a = Buffer.from(`${u}:${p}`), b = Buffer.from(`${ADMIN_USER}:${ADMIN_PASSWORD}`);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const escH = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const LABEL = { feedback: "نظر", nlu_miss: "جمله نفهمیده", nlu_correction: "اصلاح برداشت", error: "خطا", nlu_ok: "جمله فهمیده‌شده" };
function adminPage(q) {
  const all = loadEvents().reverse();
  const type = q.get("type") || "important";
  const list = all.filter(e => type === "all" ? true : type === "important" ? e.type !== "nlu_ok" : e.type === type).slice(0, 500);
  const count = t => all.filter(e => e.type === t).length;
  const devices = new Set(all.map(e => e.device)).size;
  const okRate = count("nlu_ok") + count("nlu_miss") ? Math.round(100 * count("nlu_ok") / (count("nlu_ok") + count("nlu_miss"))) : 0;
  const row = e => {
    let what = "";
    if (e.type === "feedback") what = `${e.kind ? `<b>${escH(e.kind)}</b> ` : ""}${escH(e.text)}${e.trail ? `<div class="m">مسیر: ${escH(e.trail.join(" ← "))}</div>` : ""}`;
    else if (e.type === "nlu_miss") what = `<b>${escH(e.kind)}</b>: «${escH(e.text)}»<div class="m">${escH([...(e.misses || []), ...(e.rejected || []), ...(e.unclear || [])].join(" | "))}</div>`;
    else if (e.type === "nlu_correction") what = `<b>${escH(e.kind)}</b>: «${escH(e.text)}» — کاربر برداشت را اصلاح کرد`;
    else if (e.type === "nlu_ok") what = `<b>${escH(e.kind)}</b>: «${escH(e.text)}»`;
    else what = `${escH(e.msg)} <span class="m">${escH(e.src || "")}:${e.line || ""}</span>`;
    return `<tr class="t-${e.type}"><td>${new Date(e.at).toLocaleString("fa-IR", { timeZone: "Asia/Tehran" })}</td><td>${LABEL[e.type]}</td><td>${what}</td><td class="m">${escH(e.role || "-")} / ${escH(e.tab || "-")}<br>${e.user ? "<b>" + escH(e.user) + "</b> · " : ""}v${escH(e.v)} · ${escH(e.device)}${e.standalone ? " · اپ" : " · مرورگر"}</td></tr>`;
  };
  const tabs = [["important", "مهم‌ها"], ["feedback", "نظرها"], ["nlu_miss", "نفهمیده‌ها"], ["nlu_correction", "اصلاح‌ها"], ["error", "خطاها"], ["nlu_ok", "فهمیده‌ها"], ["all", "همه"]];
  return `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>داشبورد توسعه‌دهنده</title>
<style>@font-face{font-family:V;src:url(/fonts/Vazirmatn-wght.woff2) format("woff2");font-weight:100 900}body{font-family:V,Tahoma,sans-serif;margin:0;padding:20px;background:#F3F6F7;color:#15232B}h1{font-size:1.3rem;margin:0 0 12px}
.stats{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px}.stat{background:#fff;border:1px solid #D9E1E5;border-radius:10px;padding:10px 14px}.stat b{display:block;font-size:1.3rem}
nav a{display:inline-block;margin:0 0 8px 6px;padding:6px 12px;border-radius:8px;border:1px solid #D9E1E5;background:#fff;color:#15232B;text-decoration:none}nav a.on{background:#15232B;color:#fff}
.wrap{overflow-x:auto}table{border-collapse:collapse;width:100%;background:#fff;font-size:.9rem;min-width:720px}td{border-bottom:1px solid #E5EBEE;padding:8px;vertical-align:top}.m{color:#5A6A73;font-size:.8rem}
.t-feedback td:nth-child(2){color:#1D5FA6;font-weight:700}.t-nlu_miss td:nth-child(2){color:#9A5B00;font-weight:700}.t-error td:nth-child(2){color:#B3261E;font-weight:700}.exp a{margin-left:10px}</style></head><body>
<h1>داشبورد بازخورد دمو</h1>
<div class="stats"><div class="stat"><b>${count("feedback")}</b>نظر</div><div class="stat"><b>${count("nlu_miss")}</b>جمله نفهمیده</div><div class="stat"><b>${okRate}٪</b>جمله‌های فهمیده‌شده</div><div class="stat"><b>${count("nlu_correction")}</b>اصلاح برداشت</div><div class="stat"><b>${count("error")}</b>خطا</div><div class="stat"><b>${devices}</b>دستگاه</div></div>
<nav>${tabs.map(([k, n]) => `<a href="?type=${k}" class="${k === type ? "on" : ""}">${n}</a>`).join("")}</nav>
<p class="exp"><a href="/admin/export.json">دانلود JSON</a><a href="/admin/export.csv">دانلود CSV</a></p>
<div class="wrap"><table><tbody>${list.map(row).join("") || `<tr><td>هنوز موردی نیست.</td></tr>`}</tbody></table></div></body></html>`;
}
function csv(events) {
  const cols = ["at", "type", "kind", "text", "msg", "misses", "rejected", "unclear", "user", "role", "tab", "v", "device", "standalone"];
  const cell = v => { v = Array.isArray(v) ? v.join(" | ") : v == null ? "" : String(v); return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
  return "\ufeff" + cols.join(",") + "\n" + events.map(e => cols.map(c => cell(c === "at" ? new Date(e.at).toISOString() : e[c])).join(",")).join("\n");
}

/* ---- router ---- */
http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  try {
    if (url.pathname === "/healthz") return send(res, 200, "ok", { "Content-Type": "text/plain" });
    if (url.pathname === "/api/feedback" && req.method === "POST") return await postFeedback(req, res);
    if (url.pathname === "/api/feedback" && req.method === "GET") {
      const J = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
      if (!CLINIC_PASSWORD) return send(res, 503, JSON.stringify({ error: "disabled" }), J);
      if (!clinicAuthed(req)) return send(res, limited(req) ? 429 : 401, JSON.stringify({ error: "auth" }), J);
      const R = loadRes();
      return send(res, 200, JSON.stringify(loadEvents().filter(e => e.type !== "nlu_ok").slice(-500).reverse().map(e => R[e.id] ? { ...e, resolution: R[e.id] } : e)), J);
    }
    if (url.pathname === "/api/db") return await dbApi(req, res, url);
    if (url.pathname.startsWith("/admin")) {
      if (!ADMIN_PASSWORD) return send(res, 503, "Admin is disabled: set ADMIN_PASSWORD.", { "Content-Type": "text/plain; charset=utf-8" });
      if (!authed(req)) return send(res, 401, "auth required", { "WWW-Authenticate": 'Basic realm="dev", charset="UTF-8"', "Content-Type": "text/plain" });
      const h = { "Cache-Control": "no-store" };
      if (url.pathname === "/admin/resolutions" && req.method === "POST") return await postResolutions(req, res);
      if (url.pathname === "/admin/export.json") return send(res, 200, JSON.stringify(loadEvents(), null, 1), { ...h, "Content-Type": "application/json; charset=utf-8", "Content-Disposition": 'attachment; filename="feedback.json"' });
      if (url.pathname === "/admin/export.csv") return send(res, 200, csv(loadEvents()), { ...h, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="feedback.csv"' });
      return send(res, 200, adminPage(url.searchParams), { ...h, "Content-Type": "text/html; charset=utf-8" });
    }
    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "method not allowed");
    return serveStatic(req, res, url.pathname);
  } catch (e) {
    console.error(e);
    send(res, 500, "server error");
  }
}).listen(PORT, () => console.log(`clinic-shift-demo on :${PORT} (data: ${DATA})`));
