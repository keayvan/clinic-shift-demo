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
  /* هر سفارش را مدیر و لابراتوار می‌بینند، و از کلینیک فقط دکتر و ثبت‌کنندهٔ سفارش و کسانی که مدیر به آن‌ها ارجاع داده */
  const visibleFor = (o, id, r) => r === "manager" || r === "lab" || o.doctor === id || o.createdBy === id || (o.refs || []).includes(id);
  const listAll = () => Object.values(orders).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const list = () => listAll().filter(o => visibleFor(o, typeof who !== "undefined" ? who : "", role()));
  const active = o => o.status !== "delivered";
  const badge = () => list().filter(active).length;

  /* ---------- پیوست فایل: عکس فشرده یا PDF کوچک. ذخیرهٔ دستگاه‌ها فضای محدودی دارد، پس حدها کوچک‌اند ---------- */
  const MAX_FILES = 4, PDF_MAX = 300 * 1024, ORDER_MAX = 700 * 1024;
  const bytes = s => Math.round(String(s || "").length * 0.75);
  const readData = f => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(f); });
  async function attach(prefix, fileList) {
    const d = (drafts[prefix] = drafts[prefix] || {}); d.files = d.files || [];
    for (const f of [...fileList]) {
      const bad = t => { msgs[prefix] = { bad: true, t }; };
      if (d.files.length >= MAX_FILES) { bad(`حداکثر ${fa(MAX_FILES)} فایل برای هر سفارش.`); break; }
      try {
        let data, type;
        if (f.type.startsWith("image/")) { data = await IMP.files.shrink(f, 1000, 0.6); type = "image/jpeg"; }
        else if (f.type === "application/pdf") { if (f.size > PDF_MAX) { bad(`«${f.name}» بزرگ است؛ PDF باید زیر ۳۰۰ کیلوبایت باشد.`); continue; } data = await readData(f); type = f.type; }
        else { bad(`«${f.name}» عکس یا PDF نیست.`); continue; }
        if (d.files.reduce((n, x) => n + bytes(x.data), 0) + bytes(data) > ORDER_MAX) { bad("حجم پیوست‌های این سفارش زیاد می‌شود؛ فایل کوچک‌تری بگذار."); continue; }
        d.files.push({ id: uid(), name: f.name.slice(0, 60), type, data }); msgs[prefix] = null;
      } catch (e) { bad(`«${f.name}» خوانده نشد.`); }
    }
    refresh();
  }
  const fileChips = o => (o.files || []).map((f, i) => `<button class="linkbtn" data-lab="file" data-id="${o.id}" data-i="${i}">${f.type === "application/pdf" ? "PDF" : "عکس"} ${fa(i + 1)}</button>`).join(" ");
  function openFile(id, i) {
    const o = orders[id], f = o && (o.files || [])[i]; if (!f) return;
    const canDel = role() === "manager" || o.createdBy === who;
    Shell.sheet(`<h2>${esc(o.patientName)}</h2><p class="note" style="margin:0 0 8px">${esc(f.name)}</p>
      ${f.type === "application/pdf" ? `<p><a class="btn primary" href="${f.data}" download="${esc(f.name)}">دانلود PDF</a></p>` : `<img src="${f.data}" alt="${esc(f.name)}" style="width:100%;border-radius:8px;background:#000">`}
      <div class="row" style="margin-top:10px"><button class="btn quiet" data-close-sheet>بستن</button>${canDel ? `<button class="x" id="labDelFile">حذف این فایل</button>` : ""}</div>`, root => {
      const b = root.querySelector("#labDelFile");
      if (b) b.onclick = async () => { b.disabled = true; await db.doc("lab/" + id).set({ ...o, files: o.files.filter((_, k) => k !== i), updatedAt: Date.now() }); Shell.close(); };
    });
  }

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
    await db.doc("lab/" + id).set({ id, ...n.ok, patientId: pat ? pat[0] : null, refs: [], files: d.files || [], status: "sent", createdAt: now, log: [{ s: "sent", at: now, by: who }] });
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
    if (openId === id) Shell.close();
  }
  /* داده‌های آزمایشی: چند سفارش در همهٔ مرحله‌ها تا کارکرد لابراتوار دیده شود؛ با demo:true علامت می‌خورند و پاک‌شدنی‌اند */
  const DEMO_PEOPLE = ["علی رضایی", "مریم حسینی", "رضا کریمی", "نگار احمدی", "حسین موسوی", "سارا نوری", "امیر صادقی", "زهرا جعفری", "پویا محمدی", "لیلا اکبری"];
  const DEMO_PLAN = [["sent", "روکش", 0, "رنگ A2، دندان ۱۶", 7], ["sent", "ونیر", 0, "شش دندان جلو، رنگ B1", 10], ["inlab", "دنچر", 1, "دنچر کامل بالا", 9],
    ["inlab", "بریج / پروتز ثابت", 2, "بریج سه‌واحدی ۲۴ تا ۲۶", 6], ["ready", "اباتمنت و پروتز ایمپلنت", 3, "اباتمنت ایمپلنت ۳۶", 3], ["ready", "نایت‌گارد", 4, null, 2],
    ["received", "روکش", 5, "رنگ A3 دندان ۱۱؛ منتظر نوبت تحویل", 1], ["received", "ترمیم و تعمیر", 6, "شکستگی دنچر پایین", null],
    ["delivered", "نگهدارنده و ارتودنسی", 9, "ریتینر بالا و پایین", null], ["delivered", "روکش", 12, "رنگ A2 دندان ۲۵", null]];
  function jalaliIn(days) {
    try { const d = new Date(Date.now() + days * 864e5), [y, m, dd] = gregorianToJalali(d.getFullYear(), d.getMonth() + 1, d.getDate()); return fa(`${y}/${String(m).padStart(2, "0")}/${String(dd).padStart(2, "0")}`); } catch (e) { return null; }
  }
  async function seedDemo() {
    const docs = ofRole("doctor"), recs = ofRole("reception"), lab = ofRole("lab")[0]; if (!docs.length) return;
    const pats = Object.values(patients), day = 864e5, now = Date.now();
    for (let i = 0; i < DEMO_PLAN.length; i++) {
      const [st, kind, ago, note, dueIn] = DEMO_PLAN[i], idx = ORDER.indexOf(st);
      const pat = pats.length ? pats[(i * 3) % pats.length] : null;
      const doctor = pat?.doctor || docs[i % docs.length].id, name = pat?.name || DEMO_PEOPLE[i % DEMO_PEOPLE.length];
      const age = ago ? ago * day : 3 * 36e5, created = now - age - (i % 4) * 36e5;
      const clinicBy = recs.length ? recs[i % recs.length].id : doctor;
      const by = s => (s === "sent" ? clinicBy : s === "inlab" || s === "ready" ? (lab?.id || "l1") : s === "received" ? clinicBy : doctor);
      const log = ORDER.slice(0, idx + 1).map((s, k) => ({ s, at: Math.round(created + age * k / (idx + 1)), by: by(s) }));
      const id = "demo-" + uid();
      await db.doc("lab/" + id).set({ id, demo: true, patientName: name, patientId: pat ? pat.id : null, doctor, kind, note, due: dueIn ? jalaliIn(dueIn) : null, createdBy: clinicBy, createdAt: created, status: st, log });
    }
  }
  async function clearDemo() { for (const o of list().filter(x => x.demo)) await db.doc("lab/" + o.id).delete(); }
  function refresh() {
    try {
      render();
      if (openId) { const o = orders[openId]; if (!o) Shell.close(); else if (!Shell.refresh(detail(o))) openId = null; }
      else if (patDraft.openId && Shell.kind() === "patient") renderPatientSheet();
    } catch (e) { }
  }

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
      <div style="margin-top:8px"><label class="note" style="display:block" for="lab-${prefix}-file">پیوست (عکس یا PDF کوچک؛ حداکثر ${fa(MAX_FILES)} فایل)</label>
        <input type="file" id="lab-${prefix}-file" data-labfile="${prefix}" accept="image/*,application/pdf" multiple>
        ${(d.files || []).length ? `<div class="row" style="flex-wrap:wrap;gap:6px;margin-top:6px">${d.files.map((f, i) => `<span class="chip assistant">${esc(f.name)} <button class="x" data-lab="rmfile" data-form="${prefix}" data-i="${i}" aria-label="برداشتن">✕</button></span>`).join("")}</div>` : ""}</div>
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
      <div class="note">${esc(o.kind)} · ${esc(nm(o.doctor))} · ثبت ${fdate(o.createdAt)}${o.due ? " · موعد " + esc(o.due) : ""}</div>
      ${o.note ? `<div style="margin:4px 0">${esc(o.note)}</div>` : ""}
      ${(o.files || []).length ? `<div style="margin:4px 0">${fileChips(o)}</div>` : ""}
      <div class="note" style="margin-top:2px">${esc(steps)}</div>
      <div class="row" style="flex-wrap:wrap;gap:6px;margin-top:6px">
        ${nx && canMoveFor(r, nx) ? `<button class="btn primary" data-lab="step" data-id="${o.id}" data-to="${nx}">${BTN[nx]}</button>` : ""}
        ${pv && canMoveFor(r, o.status) ? `<button class="btn quiet" data-lab="step" data-id="${o.id}" data-to="${pv}">برگرداندن به «${LABEL[pv]}»</button>` : ""}
        ${canDel ? `<button class="x" data-lab="del" data-id="${o.id}">حذف</button>` : ""}
      </div></div>`;
  }
  const counts = () => { const c = Object.fromEntries(ORDER.map(s => [s, 0])); list().forEach(o => c[o.status]++); return c; };
  const chips = () => { const c = counts(); return `<div class="row" style="flex-wrap:wrap;gap:6px;margin-bottom:8px">${STATUS.map(([k, l]) => `<span class="chip ${k === "delivered" ? "assistant" : "doctor"}">${l}: ${fa(c[k])}</span>`).join("")}</div>`; };

  /* همهٔ سفارش‌ها در یک جدول؛ کلیک روی اسم بیمار پروندهٔ او را باز می‌کند */
  function patientIdOf(o) {
    if (o.patientId && patients[o.patientId]) return o.patientId;
    const n = NLU.norm(o.patientName), e = Object.entries(patients).find(([, p]) => NLU.norm(p.name) === n);
    return e ? e[0] : null;
  }
  const SHORT = { sent: "ارسال شد", inlab: "در لابراتوار", ready: "آماده و فرستاده شد", received: "رسید به کلینیک", delivered: "تحویل شد" };
  const SBTN = { inlab: "دریافت شد", ready: "آماده شد", received: "رسید", delivered: "تحویل شد" };
  const who_ = id => id === "manager" ? "مدیر مجموعه" : nm(id);
  const cls = st => st === "delivered" ? "assistant" : st === "ready" || st === "received" ? "reception" : "doctor";
  const oneLine = o => { const note = String(o.note || "").split("\n")[0].trim(), cut = note.length > 26 ? note.slice(0, 26) + "…" : note; return o.kind + (cut ? " · " + cut : "") + ((o.files || []).length ? " · " + fa(o.files.length) + " پیوست" : ""); };
  function actions(o, small) {
    const r = role(), nx = nextOf(o.status), pv = prevOf(o.status), canDel = r === "manager" || (o.createdBy === who && o.status === "sent");
    const st = small ? ' style="padding:4px 8px;font-size:.8rem"' : "", lab = t => small ? SBTN[t] : BTN[t];
    return `${nx && canMoveFor(r, nx) ? `<button class="btn primary"${st} data-lab="step" data-id="${o.id}" data-to="${nx}">${lab(nx)}</button>` : ""}${pv && canMoveFor(r, o.status) ? `<button class="btn quiet"${st} title="برگرداندن به «${LABEL[pv]}»" data-lab="step" data-id="${o.id}" data-to="${pv}">برگرداندن</button>` : ""}${r === "manager" ? `<button class="btn quiet"${st} data-lab="refer" data-id="${o.id}">ارجاع</button>` : ""}${canDel ? `<button class="x" data-lab="del" data-id="${o.id}">حذف</button>` : ""}`;
  }
  /* در جدول فقط دکمهٔ مرحلهٔ بعد هست؛ برگرداندن، ارجاع و حذف داخل جزئیات سفارش‌اند */
  function actionsRow(o) {
    const nx = nextOf(o.status);
    return nx && canMoveFor(role(), nx) ? `<button class="btn primary" style="padding:4px 8px;font-size:.8rem" data-lab="step" data-id="${o.id}" data-to="${nx}">${SBTN[nx]}</button>` : "";
  }
  /* جدول: بیمار (با دکتر)، خلاصهٔ یک‌خطی کار، موعد، وضعیت، دکمه. کلیک روی بیمار یا ردیف، جزئیات و تاریخچه را باز می‌کند */
  function table(rows) {
    const tr = o => `<tr data-lab-row="${o.id}" style="cursor:pointer">
        <td><button class="linkbtn" data-lab="open" data-id="${o.id}">${esc(o.patientName)}</button><div class="note">${esc(nm(o.doctor))}</div></td>
        <td style="text-align:start;max-width:34vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(oneLine(o))}">${esc(oneLine(o))}</td>
        <td>${o.due ? esc(o.due) : "—"}</td>
        <td><span class="chip ${cls(o.status)}">${SHORT[o.status]}</span></td>
        <td>${actionsRow(o)}</td></tr>`;
    return `<div style="overflow-x:auto"><table class="av" style="min-width:0"><thead><tr><th>بیمار</th><th>کار</th><th>موعد</th><th>وضعیت</th><th></th></tr></thead><tbody>${rows.map(tr).join("")}</tbody></table></div>`;
  }

  /* ---------- جزئیات سفارش: همهٔ اطلاعات، تاریخچهٔ مرحله‌ها و پیوند به پروندهٔ بیمار ---------- */
  let openId = null;
  const span = ms => { const m = Math.round(ms / 6e4); if (m < 1) return "کمتر از یک دقیقه"; if (m < 60) return fa(m) + " دقیقه"; const h = Math.floor(m / 60); if (h < 24) return fa(h) + " ساعت" + (m % 60 ? " و " + fa(m % 60) + " دقیقه" : ""); const d = Math.floor(h / 24); return fa(d) + " روز" + (h % 24 ? " و " + fa(h % 24) + " ساعت" : ""); };
  function detail(o) {
    const r = role(), pid = patientIdOf(o), log = o.log || [];
    const rows = [["دکتر", nm(o.doctor)], ["نوع کار", o.kind], ["موعد تحویل", o.due || "—"], ["ثبت‌کننده", who_(o.createdBy) + " · " + fdate(o.createdAt)], ...(r === "manager" ? [["ارجاع", REF.names(o.refs)]] : [])];
    const files = (o.files || []).map((f, i) => f.type === "application/pdf"
      ? `<p><a class="btn" href="${f.data}" download="${esc(f.name)}">دانلود ${esc(f.name)}</a></p>`
      : `<p style="margin:6px 0"><img src="${f.data}" alt="${esc(f.name)}" style="max-width:100%;border-radius:8px;background:#000"><span class="note" style="display:block">${esc(f.name)}</span></p>`).join("");
    const hist = log.map((x, k) => `<li style="margin-bottom:6px"><strong>${LABEL[x.s]}</strong><div class="note">${fdate(x.at)} ساعت ${new Date(x.at).toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" })} · توسط ${esc(who_(x.by))}${k ? " · " + span(x.at - log[k - 1].at) + " بعد از مرحلهٔ قبل" : ""}</div></li>`).join("");
    const total = log.length > 1 ? `<p class="note">از ارسال تا آخرین مرحله: ${span(log[log.length - 1].at - log[0].at)}${o.status !== "delivered" ? " · از آخرین مرحله تا الان: " + span(Date.now() - log[log.length - 1].at) : ""}</p>` : "";
    return `<div class="row" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px"><h2 style="margin:0">${esc(o.patientName)}</h2><span class="chip ${cls(o.status)}">${LABEL[o.status]}</span></div>
      ${pid ? `<p class="row" style="margin:10px 0"><button class="btn primary" data-lab="rec" data-pid="${pid}">باز کردن پروندهٔ بیمار</button></p>` : `<p class="note" style="margin:8px 0">این اسم در فهرست بیماران نیست؛ پروندهٔ مستقلی برایش باز نمی‌شود.</p>`}
      <div class="panel" style="margin:10px 0">${rows.map(([l, v]) => `<div style="margin-bottom:4px"><strong>${l}: </strong>${esc(v)}</div>`).join("")}${o.note ? `<div style="margin-top:6px"><strong>توضیح: </strong><span style="white-space:pre-wrap">${esc(o.note)}</span></div>` : ""}</div>
      ${files ? `<div class="panel" style="margin:10px 0"><strong>پیوست‌ها</strong>${files}</div>` : ""}
      <div class="panel" style="margin:10px 0"><strong>تاریخچه</strong><ol class="clean" style="margin:8px 0 0;padding:0;list-style:none">${hist}</ol>${total}</div>
      <p class="row" style="flex-wrap:wrap;gap:6px">${actions(o, false)}</p>`;
  }
  function openOrder(id) {
    const o = orders[id]; if (!o) return;
    openId = id;
    Shell.sheet(`<div class="pagehead"><button class="btn quiet" data-close-sheet>‹ بازگشت</button><strong>جزئیات سفارش لابراتوار</strong></div><div id="pageBody">${detail(o)}</div>`, null, { page: true, kind: "laborder", onClose: () => { openId = null; } });
  }

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
      <div class="panel">${rows.length ? table(rows) : `<p class="note">${list().length ? "موردی با این فیلتر نیست." : "هنوز کاری برای لابراتوار ثبت نشده."}</p>`}</div>
      <div class="panel"><strong>سفارش تازه برای لابراتوار</strong><div style="margin-top:8px">${form("m")}</div></div>
      <div class="panel"><strong>داده‌های آزمایشی</strong><p class="note" style="margin:4px 0 8px">برای دیدن کارکرد لابراتوار، چند سفارش در مرحله‌های مختلف می‌سازد (${fa(list().filter(o => o.demo).length)} سفارش آزمایشی الان هست). بعداً با «پاک کردن» همه‌شان برداشته می‌شود و سفارش‌های واقعی دست نمی‌خورند.</p>
        <p class="row"><button class="btn" data-lab="demo">ساخت چند سفارش آزمایشی</button><button class="btn quiet" data-lab="demo-clear">پاک کردن سفارش‌های آزمایشی</button></p></div>`;
  }

  /* ---------- پورتال لابراتوار (دلارام) ---------- */
  function portal(id) {
    const q = NLU.norm(flt.q || ""), all = list().filter(o => !q || NLU.norm(o.patientName).includes(q));
    const sec = (title, st, hint) => { const rows = all.filter(o => o.status === st); return `<div class="panel"><strong>${title} (${fa(rows.length)})</strong>${hint ? `<p class="note" style="margin:2px 0 0">${hint}</p>` : ""}${rows.length ? table(rows) : '<p class="note" style="margin-top:6px">موردی نیست.</p>'}</div>`; };
    const done = all.filter(o => o.status === "delivered").slice(0, 15);
    return `<div class="panel"><div class="row" style="flex-wrap:wrap;gap:8px;align-items:flex-end"><div style="flex:1 1 160px"><label class="note" style="display:block" for="labfQ">جستجوی اسم بیمار</label><input type="text" id="labfQ" data-labf="labfQ" style="width:100%;box-sizing:border-box" value="${esc(flt.q)}"></div></div></div>` +
      sec("جدید: از کلینیک رسیده", "sent", "وقتی کار را تحویل گرفتی «دریافت شد» را بزن.") +
      sec("در لابراتوار", "inlab", "وقتی ساخته شد و فرستادی «آماده شد و فرستاده شد» را بزن.") +
      sec("فرستاده‌شده، منتظر رسیدن به کلینیک", "ready") + sec("رسیده به کلینیک", "received") +
      (done.length ? `<div class="panel"><strong>تحویل‌شده‌های اخیر</strong>${table(done)}</div>` : "");
  }

  /* ---------- پنل دکتر، دستیار و منشی ---------- */
  function staffPanel(id) {
    const r = byId(id)?.role; if (!["doctor", "assistant", "reception"].includes(r)) return "";
    const mine = list().filter(active);
    return `<div class="panel"><strong>لابراتوار</strong><p class="note" style="margin:2px 0 8px">کار تازه برای لابراتوار بفرست و مرحلهٔ کارهای قبلی را ببین.</p>${form("t")}
      <div style="margin-top:12px"><strong>${r === "doctor" ? "کارهای من" : "کارهای در جریان"} (${fa(mine.length)})</strong>${mine.length ? table(mine) : '<p class="note">کاری در جریان نیست.</p>'}</div></div>`;
  }
  /* در پروندهٔ بیمار: ارسال کار به لابراتوار و وضعیت کارهای همین بیمار */
  function sheetPanel(p) {
    const r = role(); if (!CLINIC.includes(r)) return "";
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
    document.addEventListener("change", async e => {
      const fi = e.target.closest("[data-labfile]"); if (fi) { const files = [...fi.files], p = fi.dataset.labfile; fi.value = ""; await attach(p, files); return; }
      const f = e.target.closest("[data-labform] [data-f]"); if (f) { const p = f.closest("[data-labform]").dataset.labform; (drafts[p] = drafts[p] || {})[f.dataset.f] = f.value; return; }
      const g = e.target.closest("[data-labf]"); if (!g) return;
      if (g.id === "labfStatus") flt.status = g.value; if (g.id === "labfDoc") flt.doc = g.value;
      render();
    });
    document.addEventListener("click", async e => {
      const row = e.target.closest("[data-lab-row]");
      if (row && !e.target.closest("button, a, input, select, textarea")) { openOrder(row.dataset.labRow); return; }
      const b = e.target.closest("[data-lab]"); if (!b) return;
      b.disabled = true;
      try {
        if (b.dataset.lab === "new") await create(b.dataset.form);
        else if (b.dataset.lab === "step") await move(b.dataset.id, b.dataset.to);
        else if (b.dataset.lab === "del") await remove(b.dataset.id);
        else if (b.dataset.lab === "refer") { const o = orders[b.dataset.id]; if (o) REF.open("ارجاع سفارش «" + o.patientName + "»", o.refs || [], ids => db.doc("lab/" + o.id).set({ ...o, refs: ids, updatedAt: Date.now() }), { exclude: ["lab"], always: "لابراتوار، دکتر سفارش و ثبت‌کننده" }); }
        else if (b.dataset.lab === "open") openOrder(b.dataset.id);
        else if (b.dataset.lab === "rec") openPatientSheet(b.dataset.pid);
        else if (b.dataset.lab === "file") openFile(b.dataset.id, +b.dataset.i);
        else if (b.dataset.lab === "rmfile") { const d = drafts[b.dataset.form]; if (d && d.files) d.files.splice(+b.dataset.i, 1); refresh(); }
        else if (b.dataset.lab === "demo") await seedDemo();
        else if (b.dataset.lab === "demo-clear") await clearDemo();
      } finally { b.disabled = false; }
    });
  }
  return { start, tab, portal, staffPanel, sheetPanel, badge, _t: { nextOf, prevOf, canMoveFor, normalize, visibleFor, STATUS, KINDS, DEMO_PLAN } };
})();
if (typeof globalThis !== "undefined") globalThis.LAB = LAB;
