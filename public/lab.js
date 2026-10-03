/* لابراتوار: سفارش کار از دکتر، دستیار یا منشی به لابراتوار، و پیگیری مرحله‌ها.
   مرحله‌ها: ارسال به لابراتوار ← در لابراتوار ← آماده و فرستاده شد ← رسید به کلینیک ← تحویل به بیمار.
   لابراتوار (دلارام) دو مرحلهٔ اول را می‌زند؛ کلینیک (دکتر، دستیار، منشی، مدیر) دو مرحلهٔ آخر را. داده در مجموعهٔ lab ذخیره می‌شود. */
const LAB = (() => {
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const fa = n => String(n).replace(/\d/g, d => "۰۱۲۳۴۵۶۷۸۹"[d]);
  const STATUS = [["sent", "ارسال شد به لابراتوار"], ["inlab", "در لابراتوار"], ["ready", "آماده؛ از لابراتوار فرستاده شد"], ["received", "رسید به کلینیک"], ["delivered", "تحویل به بیمار شد"]];
  const KINDS = ["روکش", "ونیر", "دنچر", "بریج / پروتز ثابت", "اباتمنت و پروتز ایمپلنت", "نایت‌گارد", "نگهدارنده و ارتودنسی", "ترمیم و تعمیر", "سایر"];
  const ORDER = STATUS.map(s => s[0]);
  const LABEL = Object.fromEntries(STATUS);
  const BTN = { inlab: "دریافت شد", ready: "آماده شد و فرستاده شد", received: "رسید به کلینیک", delivered: "تحویل به بیمار شد" };
  const SIDE = { inlab: "lab", ready: "lab", received: "clinic", delivered: "clinic" }; // چه کسی این مرحله را می‌زند
  const CLINIC = ["doctor", "assistant", "reception", "manager"];
  const nextOf = s => ORDER[ORDER.indexOf(s) + 1] || null;
  const prevOf = s => ORDER[ORDER.indexOf(s) - 1] || null;
  const canMoveFor = (role, to) => !!SIDE[to] && (SIDE[to] === "lab" ? role === "lab" : CLINIC.includes(role));

  let orders = {}, drafts = {}, msgs = {}, flt = { status: "active", doc: "", q: "" };
  const role = () => (typeof who !== "undefined" && who === "manager") ? "manager" : (byId(who)?.role || "");
  const fdate = at => at ? new Date(at).toLocaleDateString("fa-IR") : "";
  const ftime = at => at ? new Date(at).toLocaleString("fa-IR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
  const list = () => Object.values(orders).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const active = o => o.status !== "delivered";
  const badge = () => list().filter(active).length;

  /* ---------- ثبت و تغییر مرحله ---------- */
  function normalize(d, creator) {
    const patientName = String(d.patient || "").trim(), doctor = d.doctor || "", kind = KINDS.includes(d.kind) ? d.kind : KINDS[0];
    if (!patientName) return { err: "اسم بیمار را بنویس." };
    if (!doctor) return { err: "دکتر را انتخاب کن." };
    return { ok: { patientName: patientName.slice(0, 80), doctor, kind, note: String(d.note || "").trim().slice(0, 400) || null, due: String(d.due || "").trim().slice(0, 30) || null, createdBy: creator } };
  }
  function readForm(prefix) {
    const box = document.querySelector(`[data-labform="${prefix}"]`), o = {};
    if (box) box.querySelectorAll("[data-f]").forEach(el => { o[el.dataset.f] = el.value; });
    return o;
  }
  async function create(prefix) {
    const r = role(), d = { ...(drafts[prefix] || {}), ...readForm(prefix) };
    if (r === "doctor") d.doctor = who;
    if (!d.kind) d.kind = KINDS[0];
    const n = normalize(d, who);
    if (n.err) { msgs[prefix] = { bad: true, t: n.err }; return refresh(); }
    const pat = Object.entries(patients).find(([, p]) => NLU.norm(p.name) === NLU.norm(n.ok.patientName));
    const id = uid(), now = Date.now();
    await db.doc("lab/" + id).set({ id, ...n.ok, patientId: pat ? pat[0] : null, status: "sent", createdAt: now, log: [{ s: "sent", at: now, by: who }] });
    drafts[prefix] = { doctor: d.doctor }; msgs[prefix] = { t: "سفارش برای لابراتوار ثبت شد." };
    refresh();
  }
  async function move(id, to) {
    const o = orders[id]; if (!o) return;
    const back = ORDER.indexOf(to) < ORDER.indexOf(o.status), now = Date.now();
    if (!canMoveFor(role(), back ? o.status : to)) return; // برگرداندن را همان طرفی می‌زند که مرحله را زده بود
    if (!back && nextOf(o.status) !== to) return;
    if (back && prevOf(o.status) !== to) return;
    const log = back ? (o.log || []).filter(x => x.s !== o.status) : [...(o.log || []), { s: to, at: now, by: who }];
    await db.doc("lab/" + id).set({ ...o, status: to, log, updatedAt: now });
  }
  async function remove(id) {
    const o = orders[id]; if (!o) return;
    if (!(role() === "manager" || (o.createdBy === who && o.status === "sent"))) return;
    await db.doc("lab/" + id).delete();
  }
  function refresh() { try { render(); if (patDraft.openId && !$("#sheet").hidden) renderPatientSheet(); } catch (e) { } }

  /* ---------- فرم سفارش ---------- */
  function form(prefix, o = {}) {
    const d = drafts[prefix] || {}, r = role(), m = msgs[prefix];
    const docs = ofRole("doctor");
    const myPatients = Object.values(patients).filter(p => r !== "doctor" || p.doctor === who);
    const patient = o.patient ?? d.patient ?? "";
    const doc = r === "doctor" ? who : (d.doctor || o.doctor || "");
    const L = (k, t) => `<label class="note" style="display:block" for="lab-${prefix}-${k}">${t}</label>`;
    return `<div data-labform="${prefix}">
      <div class="row" style="flex-wrap:wrap;gap:10px">
        <div style="flex:2 1 160px">${L("patient", "اسم بیمار")}<input type="text" id="lab-${prefix}-patient" data-f="patient" list="lab-pl-${prefix}" style="width:100%;box-sizing:border-box" value="${esc(patient)}" ${o.lock ? "readonly" : ""}><datalist id="lab-pl-${prefix}">${myPatients.map(p => `<option value="${esc(p.name)}">`).join("")}</datalist></div>
        ${r === "doctor" ? "" : `<div style="flex:1 1 130px">${L("doctor", "دکتر")}<select id="lab-${prefix}-doctor" data-f="doctor" style="width:100%"><option value="">انتخاب کن</option>${docs.map(x => `<option value="${x.id}" ${doc === x.id ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select></div>`}
        <div style="flex:1 1 150px">${L("kind", "نوع کار")}<select id="lab-${prefix}-kind" data-f="kind" style="width:100%">${KINDS.map(k => `<option ${(d.kind || KINDS[0]) === k ? "selected" : ""}>${k}</option>`).join("")}</select></div>
        <div style="flex:1 1 130px">${L("due", "موعد تحویل (اختیاری)")}<input type="text" id="lab-${prefix}-due" data-f="due" placeholder="مثلاً ۱۴۰۵/۰۷/۲۵" style="width:100%;box-sizing:border-box" value="${esc(d.due || "")}"></div>
      </div>
      <div style="margin-top:8px">${L("note", "توضیح (اختیاری): رنگ، دندان، شرایط خاص")}<textarea id="lab-${prefix}-note" data-f="note" style="width:100%;box-sizing:border-box;min-height:48px">${esc(d.note || "")}</textarea></div>
      ${m ? `<p class="${m.bad ? "warn" : "okline"}" style="margin-top:8px">${esc(m.t)}</p>` : ""}
      <p class="row" style="margin-top:8px"><button class="btn primary" data-lab="new" data-form="${prefix}">ارسال به لابراتوار</button></p></div>`;
  }

  /* ---------- نمایش سفارش‌ها ---------- */
  function card(o) {
    const r = role(), nx = nextOf(o.status), pv = prevOf(o.status);
    const steps = (o.log || []).map(x => `${LABEL[x.s]}: ${ftime(x.at)}`).join(" · ");
    const canDel = r === "manager" || (o.createdBy === who && o.status === "sent");
    return `<div style="border-top:1px solid var(--line);padding:10px 0">
      <div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:6px"><strong>${esc(o.patientName)}</strong><span class="chip ${o.status === "delivered" ? "assistant" : o.status === "ready" || o.status === "received" ? "reception" : "doctor"}">${LABEL[o.status]}</span></div>
      <div class="note">${esc(o.kind)} · دکتر ${esc(nm(o.doctor))} · ثبت ${fdate(o.createdAt)}${o.due ? " · موعد " + esc(o.due) : ""}</div>
      ${o.note ? `<div style="margin:4px 0">${esc(o.note)}</div>` : ""}
      <div class="note" style="margin-top:2px">${esc(steps)}</div>
      <div class="row" style="flex-wrap:wrap;gap:6px;margin-top:6px">
        ${nx && canMoveFor(r, nx) ? `<button class="btn primary" data-lab="step" data-id="${o.id}" data-to="${nx}">${BTN[nx]}</button>` : ""}
        ${pv && canMoveFor(r, o.status) ? `<button class="btn quiet" data-lab="step" data-id="${o.id}" data-to="${pv}">برگرداندن به «${LABEL[pv]}»</button>` : ""}
        ${canDel ? `<button class="x" data-lab="del" data-id="${o.id}">حذف</button>` : ""}
      </div></div>`;
  }
  const counts = () => { const c = Object.fromEntries(ORDER.map(s => [s, 0])); list().forEach(o => c[o.status]++); return c; };
  const chips = () => { const c = counts(); return `<div class="row" style="flex-wrap:wrap;gap:6px;margin-bottom:8px">${STATUS.map(([k, l]) => `<span class="chip ${k === "delivered" ? "assistant" : "doctor"}">${l}: ${fa(c[k])}</span>`).join("")}</div>`; };

  /* ---------- تب مدیر ---------- */
  function tab() {
    const docs = ofRole("doctor"), q = NLU.norm(flt.q || "");
    const rows = list().filter(o => (flt.status === "all" || (flt.status === "active" ? active(o) : o.status === flt.status)) && (!flt.doc || o.doctor === flt.doc) && (!q || NLU.norm(o.patientName).includes(q)));
    const sel = (id, lab, inner) => `<div style="flex:1 1 130px"><label class="note" style="display:block" for="${id}">${lab}</label><select id="${id}" data-labf="${id}" style="width:100%">${inner}</select></div>`;
    const op = (v, l, cur) => `<option value="${v}" ${cur === v ? "selected" : ""}>${l}</option>`;
    return `<div class="panel"><strong>لابراتوار</strong><p class="note" style="margin:4px 0 8px">کارهایی که دکترها و منشی‌ها برای لابراتوار فرستاده‌اند و هر کدام الان در کدام مرحله است.</p>${chips()}
      <div class="row" style="flex-wrap:wrap;gap:8px">
        ${sel("labfStatus", "وضعیت", op("active", "در جریان (تحویل‌نشده)", flt.status) + op("all", "همه", flt.status) + STATUS.map(([k, l]) => op(k, l, flt.status)).join(""))}
        ${sel("labfDoc", "دکتر", op("", "همهٔ دکترها", flt.doc) + docs.map(d => op(d.id, esc(d.name), flt.doc)).join(""))}
        <div style="flex:1 1 130px"><label class="note" style="display:block" for="labfQ">اسم بیمار</label><input type="text" id="labfQ" data-labf="labfQ" style="width:100%;box-sizing:border-box" value="${esc(flt.q)}"></div>
      </div></div>
      <div class="panel">${rows.length ? rows.map(card).join("") : `<p class="note">${list().length ? "موردی با این فیلتر نیست." : "هنوز کاری برای لابراتوار ثبت نشده."}</p>`}</div>
      <div class="panel"><strong>سفارش تازه برای لابراتوار</strong><div style="margin-top:8px">${form("m")}</div></div>`;
  }

  /* ---------- پورتال لابراتوار (دلارام) ---------- */
  function portal(id) {
    const q = NLU.norm(flt.q || ""), all = list().filter(o => !q || NLU.norm(o.patientName).includes(q));
    const sec = (title, st, hint) => { const rows = all.filter(o => o.status === st); return `<div class="panel"><strong>${title} (${fa(rows.length)})</strong>${hint ? `<p class="note" style="margin:2px 0 0">${hint}</p>` : ""}${rows.length ? rows.map(card).join("") : '<p class="note" style="margin-top:6px">موردی نیست.</p>'}</div>`; };
    const done = all.filter(o => o.status === "delivered").slice(0, 15);
    return `<div class="panel"><div class="row" style="flex-wrap:wrap;gap:8px;align-items:flex-end"><div style="flex:1 1 160px"><label class="note" style="display:block" for="labfQ">جستجوی اسم بیمار</label><input type="text" id="labfQ" data-labf="labfQ" style="width:100%;box-sizing:border-box" value="${esc(flt.q)}"></div></div></div>` +
      sec("جدید: از کلینیک رسیده", "sent", "وقتی کار را تحویل گرفتی «دریافت شد» را بزن.") +
      sec("در لابراتوار", "inlab", "وقتی ساخته شد و فرستادی «آماده شد و فرستاده شد» را بزن.") +
      sec("فرستاده‌شده، منتظر رسیدن به کلینیک", "ready") + sec("رسیده به کلینیک", "received") +
      (done.length ? `<div class="panel"><strong>تحویل‌شده‌های اخیر</strong>${done.map(card).join("")}</div>` : "");
  }

  /* ---------- پنل دکتر، دستیار و منشی ---------- */
  function staffPanel(id) {
    const r = byId(id)?.role; if (!["doctor", "assistant", "reception"].includes(r)) return "";
    const mine = list().filter(o => active(o) && (r !== "doctor" || o.doctor === id));
    return `<div class="panel"><strong>لابراتوار</strong><p class="note" style="margin:2px 0 8px">کار تازه برای لابراتوار بفرست و مرحلهٔ کارهای قبلی را ببین.</p>${form("t")}
      <div style="margin-top:12px"><strong>${r === "doctor" ? "کارهای من" : "کارهای در جریان"} (${fa(mine.length)})</strong>${mine.length ? mine.map(card).join("") : '<p class="note">کاری در جریان نیست.</p>'}</div></div>`;
  }
  /* در پروندهٔ بیمار: ارسال کار به لابراتوار و وضعیت کارهای همین بیمار */
  function sheetPanel(p) {
    const r = role(); if (!["doctor", "assistant", "reception"].includes(r)) return "";
    const mine = list().filter(o => o.patientId ? o.patientId === p.id : NLU.norm(o.patientName) === NLU.norm(p.name));
    return `<details style="margin-top:10px" ${mine.some(active) ? "open" : ""}><summary style="cursor:pointer;font-weight:700">لابراتوار${mine.length ? " (" + fa(mine.length) + ")" : ""}</summary>
      ${mine.length ? mine.map(card).join("") : '<p class="note">برای این بیمار کاری به لابراتوار نرفته.</p>'}
      <div style="margin-top:8px">${form("s", { patient: p.name, lock: true, doctor: p.doctor })}</div></details>`;
  }

  /* ---------- رویدادها ---------- */
  function start() {
    db.collection("lab").onSnapshot(q => { orders = {}; q.docs.forEach(x => orders[x.id] = x.data()); refresh(); }, () => { });
    document.addEventListener("input", e => {
      const f = e.target.closest("[data-labform] [data-f]"); if (f) { const p = f.closest("[data-labform]").dataset.labform; (drafts[p] = drafts[p] || {})[f.dataset.f] = f.value; return; }
      if (e.target.id === "labfQ") { flt.q = e.target.value; clearTimeout(start._t); start._t = setTimeout(() => { render(); const el = document.getElementById("labfQ"); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, 250); }
    });
    document.addEventListener("change", e => {
      const f = e.target.closest("[data-labform] [data-f]"); if (f) { const p = f.closest("[data-labform]").dataset.labform; (drafts[p] = drafts[p] || {})[f.dataset.f] = f.value; return; }
      const g = e.target.closest("[data-labf]"); if (!g) return;
      if (g.id === "labfStatus") flt.status = g.value; if (g.id === "labfDoc") flt.doc = g.value;
      render();
    });
    document.addEventListener("click", async e => {
      const b = e.target.closest("[data-lab]"); if (!b) return;
      b.disabled = true;
      try {
        if (b.dataset.lab === "new") await create(b.dataset.form);
        else if (b.dataset.lab === "step") await move(b.dataset.id, b.dataset.to);
        else if (b.dataset.lab === "del") await remove(b.dataset.id);
      } finally { b.disabled = false; }
    });
  }
  return { start, tab, portal, staffPanel, sheetPanel, badge, _t: { nextOf, prevOf, canMoveFor, normalize, STATUS, KINDS } };
})();
if (typeof globalThis !== "undefined") globalThis.LAB = LAB;
