/* Platform layer for the offline demo:
   - LDB: tiny document store on localStorage with the same API the app used before (doc/collection/onSnapshot)
   - seedDemo: sample clinic (23 staff) with a week of availability
   - saveFile / loadVendor: downloads and lazy-loaded PDF/Excel libraries
   - FB: feedback + automatic logging for the developer (queued, sent to /api/feedback when online)
   - Shell: install-to-home-screen, update banner, guide, feedback button */
"use strict";
const APP_VERSION = "2.19.1";
const NS = "clinicdemo:";

/* ---------- local document store ---------- */
const LDB = (() => {
  const subs = [];
  const read = k => { try { const v = localStorage.getItem(NS + "db/" + k); return v ? JSON.parse(v) : null; } catch (e) { return null; } };
  const write = (k, v) => localStorage.setItem(NS + "db/" + k, JSON.stringify(v));
  const del = k => localStorage.removeItem(NS + "db/" + k);
  const clone = d => JSON.parse(JSON.stringify(d));
  const snapDoc = path => { const d = read(path); return { exists: !!d, id: path.split("/").pop(), data: () => d }; };
  const snapCol = c => {
    const docs = [], pre = NS + "db/" + c + "/";
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(pre)) { const id = k.slice(pre.length); if (!id.includes("/")) docs.push({ id, data: () => read(c + "/" + id) }); }
    }
    return { docs };
  };
  let pending = new Set(), scheduled = false;
  const emit = path => {
    pending.add(path);
    if (scheduled) return; scheduled = true;
    setTimeout(() => {
      scheduled = false; const paths = [...pending]; pending = new Set();
      for (const s of subs) {
        if (s.kind === "doc" && paths.includes(s.path)) s.cb(snapDoc(s.path));
        if (s.kind === "col" && paths.some(p => p.startsWith(s.path + "/"))) s.cb(snapCol(s.path));
      }
    }, 0);
  };
  let hook = null;
  const changed = path => { emit(path); if (hook) hook(path, read(path)); };
  const guard = fn => { try { fn(); } catch (e) { throw Object.assign(new Error("حافظه مرورگر پر است یا در دسترس نیست."), { code: "storage" }); } };
  return {
    doc: path => ({
      async get() { return snapDoc(path); },
      async set(d) { guard(() => write(path, clone(d))); changed(path); },
      async update(d) { guard(() => write(path, { ...(read(path) || {}), ...clone(d) })); changed(path); },
      async delete() { del(path); changed(path); },
      onSnapshot(cb) { subs.push({ kind: "doc", path, cb }); setTimeout(() => cb(snapDoc(path))); return () => {}; }
    }),
    collection: c => ({ async get() { return snapCol(c); }, onSnapshot(cb) { subs.push({ kind: "col", path: c, cb }); setTimeout(() => cb(snapCol(c))); return () => {}; } }),
    hasData: () => !!read("clinic/config"),
    hasAny: c => { const pre = NS + "db/" + c + "/"; for (let i = 0; i < localStorage.length; i++) { if ((localStorage.key(i) || "").startsWith(pre)) return true; } return false; },
    onChange(fn) { hook = fn; },
    applyRemote(path, d) { if (d) guard(() => write(path, d)); else del(path); emit(path); },
    all() { const out = {}, pre = NS + "db/"; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(pre)) out[k.slice(pre.length)] = read(k.slice(pre.length)); } return out; },
    wipe() {
      const keys = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(NS + "db/")) keys.push(k); }
      keys.forEach(k => localStorage.removeItem(k));
    }
  };
})();


/* ---------- sync with the clinic server (shared database) ----------
   Local changes go to an outbox and are pushed when online; remote changes are pulled every 15s.
   A path with an unsent local change ignores remote updates until it is pushed. */
const SYNC = (() => {
  const K = NS + "sync:";
  const get = (k, def) => { try { const v = localStorage.getItem(K + k); return v == null ? def : JSON.parse(v); } catch (e) { return def; } };
  const put = (k, v) => { try { v == null ? localStorage.removeItem(K + k) : localStorage.setItem(K + k, JSON.stringify(v)); } catch (e) {} };
  let state = { ok: null, at: 0, err: "" }, busy = false, listeners = [];
  const key = () => get("key", "");
  const setState = x => { state = { ...state, ...x }; listeners.forEach(f => f(state)); };
  const api = async (method, q, body) => {
    const r = await fetch("api/db" + (q || ""), { method, headers: { "X-Clinic-Key": key(), ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
    if (r.status === 401 || r.status === 429) throw Object.assign(new Error("رمز کلینیک درست نیست."), { code: "auth" });
    if (r.status === 503) throw Object.assign(new Error("سرور هنوز برای اطلاعات مشترک تنظیم نشده است."), { code: "off" });
    if (!r.ok) throw new Error("server " + r.status);
    return r.json();
  };
  LDB.onChange((path, d) => { if (!key()) return; const out = get("out", {}); out[path] = d; put("out", out); schedule(); });
  let timer = null;
  const schedule = () => { clearTimeout(timer); timer = setTimeout(run, 800); };
  async function run() {
    if (!key() || busy || !navigator.onLine) return;
    busy = true;
    try {
      const out = get("out", {}), paths = Object.keys(out);
      if (paths.length) {
        await api("POST", "", { ops: paths.map(p => ({ p, d: out[p] })) });
        const now = get("out", {}); for (const p of paths) if (JSON.stringify(now[p]) === JSON.stringify(out[p])) delete now[p]; put("out", now);
      }
      const r = await api("GET", "?since=" + get("seq", 0)), pend = get("out", {});
      for (const [p, d] of Object.entries(r.docs)) if (!(p in pend)) LDB.applyRemote(p, d);
      put("seq", r.seq); setState({ ok: true, at: Date.now(), err: "" });
    } catch (e) { setState({ ok: false, err: e.code ? e.message : "اتصال به سرور برقرار نشد؛ تغییرها روی گوشی می‌مانند و بعداً ارسال می‌شوند." }); }
    busy = false;
    if (Object.keys(get("out", {})).length) schedule();
  }
  setInterval(() => { if (document.visibilityState === "visible") run(); }, 15000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") run(); });
  addEventListener("online", run);
  return {
    enabled: () => !!key(),
    state: () => ({ ...state, pending: Object.keys(get("out", {})).length }),
    subscribe(f) { listeners.push(f); },
    sync: run,
    /* first pull at startup, so a newly connected phone does not seed demo data over the clinic's */
    async boot() { if (!key()) return; await Promise.race([run(), new Promise(r => setTimeout(r, 4000))]); },
    /* connect this phone: if the server is empty, upload this phone's data; otherwise replace local data with the server's */
    async connect(pass) {
      put("key", pass);
      let r;
      try { r = await api("GET", "?since=0"); } catch (e) { put("key", null); throw e; }
      if (!Object.values(r.docs).some(Boolean)) {
        const all = LDB.all(); await api("POST", "", { ops: Object.entries(all).map(([p, d]) => ({ p, d })) });
        put("out", {}); put("seq", 0); await run(); return "uploaded";
      }
      LDB.wipe(); for (const [p, d] of Object.entries(r.docs)) if (d) LDB.applyRemote(p, d);
      put("out", {}); put("seq", r.seq); return "downloaded";
    },
    async feedback() {
      const r = await fetch("api/feedback", { headers: { "X-Clinic-Key": key() }, cache: "no-store" });
      if (r.status === 401 || r.status === 429) throw Object.assign(new Error("رمز کلینیک درست نیست."), { code: "auth" });
      if (!r.ok) throw new Error("server " + r.status);
      if (!(r.headers.get("content-type") || "").includes("json")) throw Object.assign(new Error("سرور هنوز نسخهٔ قبلی را اجرا می‌کند و باید یک بار ری‌استارت شود."), { code: "old" });
      return r.json();
    },
    disconnect() { put("key", null); put("out", null); put("seq", null); setState({ ok: null, err: "" }); }
  };
})();

/* ---------- demo data ---------- */
async function seedDemo() {
  const S = (id, name, role, specialty) => ({ id, name, role, ...(specialty ? { specialty } : {}) });
  const staff = [
    S("d1", "دکتر احمدی", "doctor", "عمومی"), S("d2", "دکتر رضایی", "doctor", "عمومی"), S("d3", "دکتر کریمی", "doctor", "ارتودنسی"), S("d4", "دکتر موسوی", "doctor", "کودکان"),
    S("d5", "دکتر حسینی", "doctor", "اندو (ریشه)"), S("d6", "دکتر نوری", "doctor", "جراحی"), S("d7", "دکتر صادقی", "doctor", "عمومی"), S("d8", "دکتر جعفری", "doctor", "پریو (لثه)"),
    S("a1", "مریم", "assistant"), S("a2", "سارا", "assistant"), S("a3", "نگار", "assistant"), S("a4", "زهرا", "assistant"), S("a5", "الهام", "assistant"),
    S("a6", "مینا", "assistant"), S("a7", "فاطمه", "assistant"), S("a8", "لیلا", "assistant"), S("a9", "نسترن", "assistant"), S("a10", "پریسا", "assistant"),
    S("r1", "آزاده", "reception"), S("r2", "شیما", "reception"), S("r3", "رویا", "reception"), S("r4", "ندا", "reception"), S("r5", "هانیه", "reception"),
    S("i1", "کامران", "insurance")
  ];
  const pairings = { d1: ["a1", "a2", "a3"], d2: ["a3", "a4", "a5"], d3: ["a5", "a6", "a7"], d4: ["a7", "a8", "a9"], d5: ["a9", "a10", "a1"], d6: ["a2", "a4", "a6"], d7: ["a8", "a10", "a3"], d8: ["a1", "a5", "a9"] };
  await LDB.doc("clinic/config").set({ staff, pairings, rules: [], settings: { chairs: 5, receptionPerShift: 2 }, usedIds: staff.map(s => s.id) });
  let seed = 7; const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const days = ["sat", "sun", "mon", "tue", "wed", "thu"], leave = new Set(["r3", "a6"]);
  for (const s of staff) {
    const g = Object.fromEntries(days.map(d => [d, { m: false, e: false }]));
    let text;
    if (leave.has(s.id)) text = "این هفته مرخصی هستم.";
    else {
      const style = rnd();
      for (const d of days) {
        if (s.role === "doctor") {
          if (style < .25) g[d].e = rnd() < .85; else if (style < .5) g[d].m = rnd() < .85; else { g[d].m = rnd() < .6; g[d].e = rnd() < .6; }
        } else { const p = s.role === "assistant" ? .75 : .7; g[d].m = rnd() < p; g[d].e = rnd() < p; }
      }
      text = NLU.summarize(g);
    }
    await LDB.doc("avail/" + s.id).set({ staffId: s.id, text, grid: g, summary: leave.has(s.id) ? "کل هفته مرخصی" : NLU.summarize(g), confirmed: true, updatedAt: Date.now() });
  }
  await seedPatientsFor(staff, rnd);
  await seedInventory(rnd);
}

/* seed a few sample patients per doctor; reused for fresh installs and to
   backfill installs that predate the patients feature (LDB.hasAny check) */
async function seedPatientsFor(staff, rnd) {
  const names = ["علی رضایی", "مریم احمدی", "حسین قاسمی", "زهرا محمدی", "رضا کریمی", "نگین صادقی", "امیر حسینی", "سارا نوری", "بهروز یزدانی", "الهه رحیمی"];
  const TXS = [
    { tx: "root_canal", label: "عصب‌کشی" }, { tx: "scaling", label: "جرمگیری" }, { tx: "extraction", label: "کشیدن دندان" },
    { tx: "crown", label: "روکش" }, { tx: "filling", label: "پرکردن" }, { tx: "checkup", label: "معاینه" }
  ];
  const INS = [{ name: "تامین‌اجتماعی", cap: 50e6 }, { name: "بیمهٔ ملی", cap: 40e6 }, { name: "رازی", cap: 60e6 }, { name: null, cap: null }];
  const docs = staff.filter(s => s.role === "doctor");
  let pn = 0;
  for (const d of docs) {
    const n = 1 + Math.floor(rnd() * 2);
    for (let i = 0; i < n; i++) {
      const name = names[pn % names.length];
      const items = 1 + Math.floor(rnd() * 3), plan = [];
      for (let k = 0; k < items; k++) {
        const t = TXS[Math.floor(rnd() * TXS.length)];
        const tooth = rnd() < .7 ? String(1 + Math.floor(rnd() * 32)) : null;
        const done = rnd() < .4;
        plan.push({ id: "pi" + Date.now().toString(36) + pn + "_" + k, tooth, arch: null, tx: t.tx, label: t.label, text: `${t.label}${tooth ? " دندان " + tooth : ""}`, status: done ? "done" : "pending", addedAt: Date.now() - k * 86400000, doneAt: done ? Date.now() : null });
      }
      const ins = INS[Math.floor(rnd() * INS.length)];
      const pid = "p" + Date.now().toString(36) + pn;
      await LDB.doc("patients/" + pid).set({ id: pid, doctor: d.id, name, createdAt: Date.now(), plan, insurance: { name: ins.name, number: ins.name ? String(Math.floor(rnd() * 1e9)).padStart(9, "0") : null, cap: ins.cap } });
      pn++;
    }
  }
}
async function seedPatientsIfMissing() {
  const cfg = await LDB.doc("clinic/config").get(); if (!cfg.exists) return;
  await seedPatientsFor(cfg.data().staff || [], Math.random);
}

/* sample clinic supplies; reused for fresh installs and to backfill older installs */
async function seedInventory(rnd) {
  const items = [
    ["آمالگام", "ویال", 30], ["کامپوزیت دندانی", "بسته", 15], ["بی‌حسی لیدوکائین", "ویال", 60],
    ["گاز استریل", "بسته", 40], ["دستکش لاتکس", "جعبه", 20], ["ماسک جراحی", "جعبه", 25],
    ["پودر جرمگیری", "بسته", 12], ["روکش موقت", "بسته", 10], ["نخ بخیه", "بسته", 15], ["مته دندانپزشکی", "عدد", 8]
  ];
  let n = 0;
  for (const [name, unit, minQty] of items) {
    const qty = Math.round(rnd() < .3 ? rnd() * minQty : minQty + rnd() * minQty * 2);
    const id = "inv" + Date.now().toString(36) + (n++);
    await LDB.doc("inventory/" + id).set({ id, name, unit, qty, minQty, updatedAt: Date.now() });
  }
}
async function seedInventoryIfMissing() { await seedInventory(Math.random); }

/* ---------- files & lazy libraries ---------- */
const VENDOR = { html2pdf: ["vendor/html2pdf.bundle.min.js", () => window.html2pdf], xlsx: ["vendor/xlsx.full.min.js", () => window.XLSX] };
function loadVendor(name) {
  const [src, ok] = VENDOR[name];
  if (ok()) return Promise.resolve();
  return new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = () => ok() ? res() : rej(new Error("load")); s.onerror = rej; document.head.appendChild(s); });
}
async function saveFile({ filename, data }) {
  const type = filename.endsWith(".pdf") ? "application/pdf" : filename.endsWith(".xlsx") ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/html";
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const file = new File([blob], filename, { type });
  if (/Android|iPhone|iPad/i.test(navigator.userAgent) && navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: filename }); return; } catch (e) { if (e.name === "AbortError") throw Object.assign(e, { code: "declined" }); }
  }
  const url = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ---------- feedback & developer logging ---------- */
const FB = (() => {
  const QK = NS + "fb/queue", AK = NS + "fb/archive", DK = NS + "device", UK = NS + "user";
  const get = k => { try { return JSON.parse(localStorage.getItem(k) || "[]"); } catch (e) { return []; } };
  const put = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  let device = localStorage.getItem(DK); if (!device) { device = Math.random().toString(36).slice(2, 10); try { localStorage.setItem(DK, device); } catch (e) {} }
  /* اسم کاربری: هر کس بار اول یکی انتخاب می‌کند و کنار همهٔ نظرها و گزارش‌هایش ثبت می‌شود */
  const cleanUser = s => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, 30);
  const userOk = s => { const n = cleanUser(s); return n.length >= 2 && /[A-Za-z\u0600-\u06FF]/.test(n) ? n : null; };
  let userName = ""; try { userName = cleanUser(localStorage.getItem(UK)); } catch (e) {}
  const user = () => userName;
  const setUser = n => { const c = userOk(n); if (!c) return null; userName = c; try { localStorage.setItem(UK, c); } catch (e) {} return c; };
  const trail = [];
  const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  function push(ev) {
    const e = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), at: Date.now(), v: APP_VERSION, device, user: userName || null, role: typeof who !== "undefined" ? who : null, tab: typeof tab !== "undefined" ? tab : null, standalone: standalone(), ...ev };
    const q = get(QK); q.push(e); put(QK, q.slice(-500));
    const a = get(AK); a.push(e); put(AK, a.slice(-300));
    Shell.badge(); flush();
  }
  let flushing = false;
  async function flush() {
    if (flushing || !navigator.onLine) return;
    const q = get(QK); if (!q.length) return;
    flushing = true;
    try {
      const batch = q.slice(0, 50);
      const r = await fetch("api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ events: batch }) });
      if (r.ok) { put(QK, get(QK).filter(x => !batch.some(b => b.id === x.id))); Shell.badge(); }
    } catch (e) { /* offline or no server: keep queued */ }
    flushing = false;
  }
  addEventListener("online", flush); setInterval(flush, 60000);
  return {
    note: (kind, text) => push({ type: "feedback", kind, text, trail: trail.slice(-10) }),
    nlu: (kind, text, r) => {
      const miss = (r.misses && r.misses.length) || (r.rejected && r.rejected.length) || (r.unclear && r.unclear.length);
      push({ type: miss ? "nlu_miss" : "nlu_ok", kind, text, misses: r.misses || [], rejected: r.rejected || [], unclear: r.unclear || [], actions: r.actions ? r.actions.length : undefined });
    },
    correction: (kind, text, parsed, final) => push({ type: "nlu_correction", kind, text, parsed, final }),
    act: a => { trail.push(a); if (trail.length > 30) trail.shift(); },
    error: (msg, src, line) => push({ type: "error", msg: String(msg).slice(0, 500), src, line }),
    flush, pending: () => get(QK).length,
    exportText() {
      const lab = { feedback: "نظر", nlu_miss: "جمله نفهمیده", nlu_correction: "اصلاح برداشت", error: "خطا", nlu_ok: "جمله فهمیده‌شده" };
      const rows = get(AK).filter(e => e.type !== "nlu_ok").map(e => {
        const t = new Date(e.at).toLocaleString("fa-IR");
        if (e.type === "feedback") return `• [${lab.feedback}${e.kind ? " / " + e.kind : ""}] ${e.text}\n  (${t}، نقش: ${e.role || "-"}، صفحه: ${e.tab || "-"})`;
        if (e.type === "nlu_miss") return `• [${lab.nlu_miss} / ${e.kind}] «${e.text}» → ${[...(e.misses || []), ...(e.rejected || []), ...(e.unclear || [])].join(" | ")}\n  (${t})`;
        if (e.type === "nlu_correction") return `• [${lab.nlu_correction}] «${e.text}»\n  (${t})`;
        return `• [${lab.error}] ${e.msg}\n  (${t})`;
      });
      return `بازخورد دموی شیفت کلینیک (نسخه ${APP_VERSION}، دستگاه ${device}${userName ? "، کاربر " + userName : ""})\n\n` + (rows.join("\n") || "هنوز موردی ثبت نشده.");
    },
    standalone, user, setUser, userOk
  };
})();
addEventListener("error", e => FB.error(e.message, (e.filename || "").split("/").pop(), e.lineno));
addEventListener("unhandledrejection", e => FB.error("promise: " + (e.reason && e.reason.message || e.reason)));

/* ---------- shell: install, update, guide, feedback UI ---------- */
const Shell = (() => {
  let deferred = null, swReg = null, updateReady = false;
  const $ = s => document.querySelector(s);
  const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const iosSafari = ios && !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(navigator.userAgent);
  addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferred = e; banners(); });
  addEventListener("appinstalled", () => { deferred = null; FB.act("installed"); banners(); });

  let locked = false, pendingNews = null, onCloseCb = null;
  /* opts: locked (بدون راه بستن)، page (برگهٔ تمام‌صفحه با دکمهٔ بازگشت خودش)، onClose (وقتی بسته یا جایگزین شد) */
  function sheet(html, onOpen, opts) {
    if (onCloseCb) { const f = onCloseCb; onCloseCb = null; try { f(); } catch (e) {} }
    const root = $("#sheet"); locked = !!(opts && opts.locked); onCloseCb = (opts && opts.onClose) || null;
    const page = !!(opts && opts.page);
    root.innerHTML = `<div class="sheet-back" ${locked ? "" : "data-close-sheet"}></div><div class="sheet-card${page ? " page" : ""}" data-kind="${(opts && opts.kind) || ""}" role="dialog" aria-modal="true">${locked || page ? "" : `<button class="sheet-x" data-close-sheet aria-label="بستن">✕</button>`}${html}</div>`;
    root.hidden = false; document.body.style.overflow = "hidden";
    root.querySelectorAll("[data-close-sheet]").forEach(b => b.onclick = close);
    onOpen && onOpen(root);
    const card = root.querySelector(".sheet-card"); card.setAttribute("tabindex", "-1"); card.scrollTop = 0; card.focus({ preventScroll: true });
  }
  function close() { locked = false; const r = $("#sheet"); r.hidden = true; r.innerHTML = ""; document.body.style.overflow = ""; if (onCloseCb) { const f = onCloseCb; onCloseCb = null; try { f(); } catch (e) {} } }
  /* محتوای برگهٔ تمام‌صفحه را بدون پرش اسکرول و بدون از دست رفتن فوکوس نو می‌کند */
  function refresh(html) {
    const body = $("#pageBody"); if (!body) return false;
    const card = body.closest(".sheet-card"), top = card ? card.scrollTop : 0, ae = document.activeElement;
    const keep = ae && body.contains(ae) && ae.id ? { id: ae.id, s: ae.selectionStart, e: ae.selectionEnd } : null;
    body.innerHTML = html;
    if (card) card.scrollTop = top;
    if (keep) { const el = document.getElementById(keep.id); if (el) { el.focus({ preventScroll: true }); try { if (keep.s != null) el.setSelectionRange(keep.s, keep.e); } catch (e) {} } }
    return true;
  }
  addEventListener("keydown", e => { if (e.key === "Escape" && !$("#sheet").hidden && !locked) close(); });

  /* اسم کاربری: بار اول (و برای کسانی که اپ را از قبل دارند، بعد از این به‌روزرسانی) اجباری است */
  const esc = x => String(x ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  function askUser(forced) {
    const cur = FB.user();
    sheet(`<h2>اسم کاربری</h2>
      <p class="lead">برای اینکه نظرها و مشکلاتی که می‌فرستی به اسم خودت ثبت شود و بتوانیم دقیق‌تر پیگیری کنیم، یک اسم کاربری انتخاب کن. اسم کوچک یا اسم و فامیل کافی است.</p>
      <label class="note" for="unameIn">اسم کاربری</label>
      <input type="text" id="unameIn" maxlength="30" autocomplete="off" value="${esc(cur)}" placeholder="مثلاً: سارا احمدی">
      <p class="warn" id="unameErr" hidden>اسم باید حداقل ۲ حرف باشد و حرف داشته باشد.</p>
      <div class="row" style="margin-top:12px"><button class="btn primary" id="unameSave">ذخیره</button>${forced ? "" : `<button class="btn quiet" data-close-sheet>بستن</button>`}</div>
      <p class="note" style="margin-top:8px">این اسم فقط کنار نظرها و گزارش‌هایی که می‌فرستی دیده می‌شود. بعداً از دکمهٔ «راهنما» می‌توانی عوضش کنی.</p>`, root => {
      const inp = root.querySelector("#unameIn"), err = root.querySelector("#unameErr");
      const save = () => {
        const n = FB.setUser(inp.value);
        if (!n) { err.hidden = false; inp.focus(); return; }
        FB.act("username-set"); close();
        if (!localStorage.getItem(NS + "seenGuide")) guide(true); else if (pendingNews) { const h = pendingNews; pendingNews = null; sheet(h); }
      };
      root.querySelector("#unameSave").onclick = save;
      inp.onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); save(); } };
      setTimeout(() => inp.focus(), 50);
    }, { locked: !!forced });
  }

  function banners() {
    const b = $("#banners"); if (!b) return;
    let h = "";
    if (updateReady) h += `<div class="banner update"><span>نسخه جدید آماده است.</span><button class="btn primary" id="doUpdate">به‌روزرسانی</button></div>`;
    const dismissed = +(localStorage.getItem(NS + "installDismissed") || 0);
    if (!FB.standalone() && Date.now() - dismissed > 3 * 864e5 && (deferred || ios || /Android/i.test(navigator.userAgent)))
      h += `<div class="banner install"><span>این را به صفحه اصلی گوشی اضافه کنید تا مثل اپ، تمام‌صفحه باز شود.</span><span class="row"><button class="btn primary" id="doInstall">نصب</button><button class="btn quiet" id="noInstall">بعداً</button></span></div>`;
    b.innerHTML = h;
    const u = $("#doUpdate"); if (u) u.onclick = () => { if (swReg && swReg.waiting) swReg.waiting.postMessage("skip"); else location.reload(); };
    const i = $("#doInstall"); if (i) i.onclick = install;
    const n = $("#noInstall"); if (n) n.onclick = () => { localStorage.setItem(NS + "installDismissed", String(Date.now())); banners(); };
  }
  async function install() {
    FB.act("install-tap");
    if (deferred) { deferred.prompt(); try { await deferred.userChoice; } catch (e) {} deferred = null; banners(); return; }
    if (ios) {
      sheet(`<h2>نصب روی آیفون</h2>${iosSafari ? "" : `<p class="warn">اول این صفحه را با <strong>Safari</strong> باز کنید؛ در مرورگرهای دیگر آیفون این گزینه نیست.</p>`}
        <ol class="steps"><li>پایین صفحه، دکمه <strong>Share</strong> (مربع با فلش رو به بالا) را بزنید.</li><li>کمی پایین بروید و <strong>Add to Home Screen</strong> را بزنید.</li><li>بالا سمت راست <strong>Add</strong> را بزنید.</li><li>از این به بعد اپ را با آیکون روی صفحه اصلی باز کنید.</li></ol>`);
      return;
    }
    sheet(`<h2>نصب روی اندروید</h2><ol class="steps"><li>این صفحه را با <strong>Chrome</strong> باز کنید.</li><li>منوی سه‌نقطه بالای صفحه را بزنید.</li><li><strong>Install app</strong> یا <strong>Add to Home screen</strong> را بزنید.</li></ol>`);
  }

  function guide(first) {
    sheet(`<h2>دموی برنامه شیفت کلینیک <span class="note" style="font-weight:400;font-size:.7em">نسخه ${APP_VERSION}</span></h2>
      <p class="lead">این نسخه آزمایشی است. ${SYNC.enabled() ? "این گوشی به سرور کلینیک وصل است و اطلاعات بین گوشی‌های کلینیک مشترک است." : "تا وقتی مدیر این گوشی را به سرور کلینیک وصل نکرده، اطلاعات فقط روی همین گوشی است."} نظرهایی که می‌فرستید و جمله‌هایی که برنامه نفهمیده برای بهتر شدن برنامه به سرور فرستاده می‌شوند.</p>
      <p>از منوی «من:» بالای صفحه می‌توانید جای هر کدام از کارکنان باشید. پیشنهاد می‌کنیم این کارها را به ترتیب امتحان کنید:</p>
      <ol class="steps">
        <li><strong>ساخت برنامه:</strong> با «مدیر مجموعه»، در تب برنامه «ساخت برنامه» و بعد «تأیید و ارسال برای همه» را بزنید.</li>
        <li><strong>نبودن یک کارمند:</strong> «من: سارا» را انتخاب کنید و در کادر درخواست بنویسید «دوشنبه صبح نمیام».</li>
        <li><strong>جواب آنکال‌ها:</strong> یکی از دستیارهای آنکال را انتخاب کنید و «هستم» را بزنید. بعد با دکتر همان شیفت «ترجیح من» را بزنید.</li>
        <li><strong>تصمیم مدیر:</strong> به «مدیر مجموعه» برگردید؛ هشدار بالای صفحه را ببینید و تأیید یا رد کنید.</li>
        <li><strong>قانون با جمله:</strong> در تب قوانین بنویسید «مریم و سارا با هم نباشند».</li>
        <li><strong>خروجی:</strong> PDF یا Excel برنامه را بگیرید.</li>
      </ol>
      <p>هر جا نظری داشتید یا چیزی درست کار نکرد، دکمه <strong>نظر</strong> پایین صفحه را بزنید.</p>
      <div class="row" style="margin-top:14px"><button class="btn primary" data-close-sheet>${first ? "شروع" : "بستن"}</button><button class="btn quiet" id="changeUser">اسم کاربری: ${esc(FB.user() || "—")} (تغییر)</button><button class="btn quiet" id="resetDemo">شروع دوباره دمو</button></div>`, root => {
      root.querySelector("#changeUser").onclick = () => askUser(false);
      const r = root.querySelector("#resetDemo");
      r.onclick = async () => {
        if (r.dataset.sure !== "1") { r.dataset.sure = "1"; r.textContent = "همه تغییرات پاک شود؟ دوباره بزنید"; return; }
        FB.act("reset"); LDB.wipe(); await seedDemo(); localStorage.removeItem("who"); location.reload();
      };
    });
    localStorage.setItem(NS + "seenGuide", "1");
  }

  function feedback() {
    let kind = "";
    sheet(`<h2>نظر شما</h2><p class="note">صفحه و نقشی که الان در آن هستید همراه نظر ثبت می‌شود.</p>
      <div class="row chips" role="group" aria-label="نوع نظر">${["مشکل دارد", "پیشنهاد", "سؤال", "خوب بود"].map(k => `<button class="btn quiet chipbtn" data-kind="${k}" aria-pressed="false">${k}</button>`).join("")}</div>
      <textarea id="fbText" placeholder="مثلاً: وقتی نوشتم «دوشنبه‌ها نمیام» درست نفهمید." style="margin-top:10px"></textarea>
      <div class="row" style="margin-top:10px"><button class="btn primary" id="fbSend">ثبت نظر</button></div>
      <p class="note" id="fbState" style="margin-top:10px"></p>
      <hr><p class="note">اگر اینترنت یا سرور در دسترس نیست، همه نظرها را از طریق پیام‌رسان بفرستید:</p>
      <div class="row"><button class="btn quiet" id="fbShare">ارسال همه نظرها با پیام‌رسان</button></div>`, root => {
      const st = root.querySelector("#fbState");
      const upd = () => { const n = FB.pending(); st.textContent = n ? `${n.toLocaleString("fa-IR")} مورد هنوز به سرور نرسیده؛ با اتصال اینترنت خودکار ارسال می‌شود.` : "همه موارد ارسال شده‌اند."; };
      upd();
      root.querySelectorAll("[data-kind]").forEach(b => b.onclick = () => { kind = b.dataset.kind; root.querySelectorAll("[data-kind]").forEach(x => x.setAttribute("aria-pressed", x === b)); });
      root.querySelector("#fbSend").onclick = () => {
        const t = root.querySelector("#fbText").value.trim();
        if (!t && !kind) { st.textContent = "اول چیزی بنویسید یا یکی از گزینه‌ها را انتخاب کنید."; return; }
        FB.note(kind, t); root.querySelector("#fbText").value = ""; st.textContent = "ثبت شد. ممنون!"; setTimeout(upd, 1500);
      };
      root.querySelector("#fbShare").onclick = async () => {
        const text = FB.exportText();
        try { if (navigator.share) { await navigator.share({ text, title: "بازخورد دمو" }); return; } } catch (e) { if (e.name === "AbortError") return; }
        try { await navigator.clipboard.writeText(text); st.textContent = "متن نظرها کپی شد؛ در پیام‌رسان بچسبانید."; } catch (e) { st.textContent = "کپی نشد."; }
      };
    });
  }

  function badge() { const b = $("#fbBtn"); if (b) b.dataset.pending = FB.pending() ? "1" : ""; }

  function start() {
    $("#fbBtn").onclick = () => { FB.act("feedback-open"); feedback(); };
    $("#guideBtn").onclick = () => guide(false);
    banners(); badge();
    if (!FB.user()) setTimeout(() => askUser(true), 400);
    else if (!localStorage.getItem(NS + "seenGuide")) setTimeout(() => guide(true), 400);
    const last = localStorage.getItem(NS + "lastVersion");
    if (last && last !== APP_VERSION) fetch("changelog.json").then(r => r.json()).then(cl => {
      const items = (cl.find(x => x.version === APP_VERSION) || {}).changes || [];
      if (items.length) { const h = `<h2>چه چیزهایی عوض شد</h2><p class="note">نسخه ${APP_VERSION}</p><ul>${items.map(i => `<li>${i}</li>`).join("")}</ul><div class="row"><button class="btn primary" data-close-sheet>متوجه شدم</button></div>`; if (locked || !FB.user()) pendingNews = h; else sheet(h); }
    }).catch(() => {});
    localStorage.setItem(NS + "lastVersion", APP_VERSION);
    if ("serviceWorker" in navigator && location.protocol !== "file:") {
      navigator.serviceWorker.register("sw.js").then(reg => {
        swReg = reg;
        const watch = w => w && w.addEventListener("statechange", () => { if (w.state === "installed" && navigator.serviceWorker.controller) { updateReady = true; banners(); } });
        if (reg.waiting && navigator.serviceWorker.controller) { updateReady = true; banners(); }
        reg.addEventListener("updatefound", () => watch(reg.installing));
        setInterval(() => reg.update().catch(() => {}), 30 * 60000);
        document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") reg.update().catch(() => {}); });
      }).catch(() => {});
      let reloaded = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => { if (!reloaded) { reloaded = true; location.reload(); } });
    }
    FB.flush();
  }
  const kind = () => { const c = $("#sheet .sheet-card"); return $("#sheet").hidden || !c ? "" : c.dataset.kind || ""; };
  return { start, badge, sheet, close, refresh, kind };
})();
