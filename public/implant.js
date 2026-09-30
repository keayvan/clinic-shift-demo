/* Implant follow-up module (offline): implant cases per jaw region, contract + installments,
   payments (cash / card-to-card / POS / cheque) with amount confirmation, OPG images,
   installment reminders, daily money report, per-staff access (full / limited = no finance).
   Data: LDB "implants/*" (cases), "implant/settings" (access + clinic cards); OPG images in IndexedDB. */
"use strict";
const IMP = (() => {
  const REG = [["ur", "بالا راست"], ["ul", "بالا چپ"], ["lr", "پایین راست"], ["ll", "پایین چپ"]];
  const REGN = Object.fromEntries(REG);
  const STAGES = [["none", "بدون درمان"], ["planned", "برنامه‌ریزی شده"], ["deferred", "به تعویق افتاده"], ["surgery", "جراحی انجام شد"], ["healing", "دوره ترمیم"], ["prosthetic", "مرحله پروتز"], ["done", "تمام شده"]];
  const STN = Object.fromEntries(STAGES);
  const METHODS = [["cash", "نقد"], ["card2card", "کارت به کارت"], ["pos", "کارتخوان"], ["cheque", "چک"]];
  const METN = Object.fromEntries(METHODS);
  const DAY = 86400000;

  let cases = {}, settings = { access: {}, cards: [] }, loadedOnce = false;
  let filt = { q: "", doctor: "", stage: "", region: "", money: "", archived: false, sort: "recent" };
  let openId = null, view = "list", reportDate = null, msg = "", err = "";
  let money = null;   // pending amount confirmation {kind, data, amount}
  let delArm = null, sheetMsg = "", sheetErr = "";
  let newDraft = { name: "", phone: "", doctor: "" };
  let payDraft = { amount: "", method: "cash", from4: "", toCard: "", ref: "", note: "", date: null };
  let instDraft = { total: "", down: "", count: "6", start: null, every: "30" };
  let editRegion = null;

  /* ---------- money helpers ---------- */
  const digits = s => String(s ?? "").replace(/[۰-۹]/g, d => "۰۱۲۳۴۵۶۷۸۹".indexOf(d)).replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d));
  const parseMoney = s => { const t = digits(s).replace(/[^\d]/g, ""); return t ? Math.min(+t, 1e13) : 0; };
  const commas = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const toman = n => fa(n) + " تومان";
  const faD = s => String(s).replace(/\d/g, d => "۰۱۲۳۴۵۶۷۸۹"[d]);
  const ONES = ["", "یک", "دو", "سه", "چهار", "پنج", "شش", "هفت", "هشت", "نه"];
  const TEENS = ["ده", "یازده", "دوازده", "سیزده", "چهارده", "پانزده", "شانزده", "هفده", "هجده", "نوزده"];
  const TENS = ["", "", "بیست", "سی", "چهل", "پنجاه", "شصت", "هفتاد", "هشتاد", "نود"];
  const HUND = ["", "صد", "دویست", "سیصد", "چهارصد", "پانصد", "ششصد", "هفتصد", "هشتصد", "نهصد"];
  function words3(n) {
    const h = Math.floor(n / 100), r = n % 100, out = [];
    if (h) out.push(HUND[h]);
    if (r >= 10 && r < 20) out.push(TEENS[r - 10]);
    else { if (r >= 20) out.push(TENS[Math.floor(r / 10)]); if (r % 10) out.push(ONES[r % 10]); }
    return out.join(" و ");
  }
  function words(n) {
    if (!n) return "صفر";
    const units = ["", "هزار", "میلیون", "میلیارد", "هزار میلیارد"], parts = [];
    for (let i = 0; n > 0 && i < units.length; i++, n = Math.floor(n / 1000)) {
      const c = n % 1000; if (c) parts.unshift(words3(c) + (units[i] ? " " + units[i] : ""));
    }
    return parts.join(" و ");
  }
  const moneyInput = (id, val, ph) => `<input type="text" inputmode="numeric" dir="ltr" id="${id}" data-money value="${esc(val)}" placeholder="${esc(ph || "مثال: 100,000,000")}" autocomplete="off" style="text-align:left">
    <div class="note imp-words" data-words-for="${id}">${parseMoney(val) ? esc(words(parseMoney(val))) + " تومان" : "مبلغ به تومان"}</div>`;
  function wireMoney(root) {
    root.querySelectorAll("[data-money]").forEach(i => i.addEventListener("input", () => {
      const n = parseMoney(i.value), end = i.value.length - i.selectionEnd;
      i.value = n ? commas(n) : "";
      const pos = Math.max(0, i.value.length - end); try { i.setSelectionRange(pos, pos); } catch (e) {}
      const w = root.querySelector(`[data-words-for="${i.id}"]`); if (w) w.textContent = n ? words(n) + " تومان" : "مبلغ به تومان";
    }));
  }

  /* ---------- dates ---------- */
  const iso = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const isoAdd = (s, days) => { const [y, m, d] = s.split("-").map(Number); return iso(new Date(y, m - 1, d + days)); };
  const dayDiff = (a, b) => { const p = s => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); }; return Math.round((p(b) - p(a)) / DAY); };
  const jl = s => { const [y, m, d] = s.split("-").map(Number); const [jy, jm, jd] = gregorianToJalali(y, m, d); return `${fa(jd)} ${PERSIAN_MONTHS[jm - 1]} ${Number(jy).toLocaleString("fa-IR", { useGrouping: false })}`; };
  function dateSel(prefix, s) {
    const [y, m, d] = s.split("-").map(Number); const [jy, jm, jd] = gregorianToJalali(y, m, d), len = jalaliMonthLength(jy, jm), ty = todayJalali()[0];
    const fy = v => Number(v).toLocaleString("fa-IR", { useGrouping: false });
    return `<div class="row" style="gap:6px"><select data-dsel="${prefix}|d">${Array.from({ length: len }, (_, i) => `<option value="${i + 1}" ${jd === i + 1 ? "selected" : ""}>${fa(i + 1)}</option>`).join("")}</select>
      <select data-dsel="${prefix}|m">${PERSIAN_MONTHS.map((n, i) => `<option value="${i + 1}" ${jm === i + 1 ? "selected" : ""}>${n}</option>`).join("")}</select>
      <select data-dsel="${prefix}|y">${[ty - 1, ty, ty + 1, ty + 2].map(v => `<option value="${v}" ${jy === v ? "selected" : ""}>${fy(v)}</option>`).join("")}</select></div>`;
  }
  function readDate(root, prefix) {
    const g = k => +root.querySelector(`[data-dsel="${prefix}|${k}"]`).value;
    const jy = g("y"), jm = g("m"), jd = Math.min(g("d"), jalaliMonthLength(jy, jm));
    const [y, m, d] = jalaliToGregorian(jy, jm, jd); return iso(new Date(y, m - 1, d));
  }

  /* ---------- access ---------- */
  const level = id => id === "manager" ? "full" : (settings.access || {})[id] || "none";
  const canSee = id => level(id) !== "none";
  const canMoney = id => level(id) === "full";

  /* ---------- finance (payments fill installments oldest-first) ---------- */
  function fin(c) {
    const today = todayISO();
    const paid = (c.payments || []).reduce((s, p) => s + (p.amount || 0), 0);
    const total = c.contract?.total || 0;
    let pool = paid - (c.contract?.down || 0);
    const inst = (c.installments || []).slice().sort((a, b) => a.due.localeCompare(b.due)).map(i => {
      const got = Math.max(0, Math.min(i.amount, pool)); pool -= got;
      const left = i.amount - got, dd = dayDiff(today, i.due);
      return { ...i, got, left, days: dd, state: left <= 0 ? "paid" : dd < 0 ? "overdue" : dd === 0 ? "today" : dd <= 3 ? "soon" : "later" };
    });
    const overdue = inst.filter(i => i.state === "overdue").reduce((s, i) => s + i.left, 0);
    return { total, paid, balance: total - paid, inst, overdue, next: inst.find(i => i.left > 0) || null };
  }
  const stageOf = c => REG.map(([k]) => c.regions?.[k]?.status || "none");

  /* ---------- storage: OPG images in IndexedDB ---------- */
  const IDB = (() => {
    let p = null;
    const open = () => p || (p = new Promise((res, rej) => { const r = indexedDB.open("clinicdemo-files", 1); r.onupgradeneeded = () => r.result.createObjectStore("opg"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }));
    const tx = async (mode, fn) => { const d = await open(); return new Promise((res, rej) => { const t = d.transaction("opg", mode), q = fn(t.objectStore("opg")); t.oncomplete = () => res(q?.result); t.onerror = () => rej(t.error); }); };
    return { put: (k, v) => tx("readwrite", s => s.put(v, k)), get: k => tx("readonly", s => s.get(k)), del: k => tx("readwrite", s => s.delete(k)) };
  })();
  function shrink(file, max, q) {
    return new Promise((res, rej) => {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => { const k = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); res(c.toDataURL("image/jpeg", q)); };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("img")); };
      img.src = url;
    });
  }

  const save = async c => { c.updatedAt = Date.now(); await LDB.doc("implants/" + c.id).set(c); cases[c.id] = c; };

  /* ---------- list / filters ---------- */
  function filtered() {
    const q = NLU.norm(filt.q || ""), qd = digits(filt.q || "").replace(/\D/g, "");
    let rows = Object.values(cases).filter(c => !!c.archived === filt.archived);
    if (q) rows = rows.filter(c => NLU.norm(c.name).includes(q) || (qd.length >= 3 && digits(c.phone || "").includes(qd)));
    if (filt.doctor) rows = rows.filter(c => c.doctor === filt.doctor);
    if (filt.region) rows = rows.filter(c => (c.regions?.[filt.region]?.status || "none") !== "none");
    if (filt.stage) rows = rows.filter(c => REG.some(([k]) => (c.regions?.[k]?.status || "none") === filt.stage && (!filt.region || k === filt.region)));
    if (filt.money && canMoney(who)) rows = rows.filter(c => {
      const f = fin(c);
      return filt.money === "debt" ? f.balance > 0 : filt.money === "overdue" ? f.overdue > 0 : filt.money === "week" ? f.inst.some(i => i.left > 0 && i.days >= 0 && i.days <= 7) : f.total > 0 && f.balance <= 0;
    });
    const k = filt.sort;
    rows.sort((a, b) => k === "name" ? a.name.localeCompare(b.name, "fa") : k === "overdue" ? fin(b).overdue - fin(a).overdue : k === "debt" ? fin(b).balance - fin(a).balance : (b.createdAt || 0) - (a.createdAt || 0));
    return rows;
  }
  function remindersPanel() {
    if (!canMoney(who)) return "";
    const items = [];
    for (const c of Object.values(cases)) if (!c.archived) for (const i of fin(c).inst) if (i.left > 0 && i.days <= 3) items.push({ c, i });
    if (!items.length) return `<div class="panel"><strong>یادآوری اقساط</strong><p class="okline" style="margin:6px 0 0">قسط عقب‌افتاده یا نزدیکی نیست.</p></div>`;
    items.sort((a, b) => a.i.days - b.i.days);
    const lbl = d => d < 0 ? `${fa(-d)} روز عقب‌افتاده` : d === 0 ? "امروز سررسید" : d === 1 ? "فردا" : `${fa(d)} روز مانده`;
    return `<div class="panel imp-rem"><strong>یادآوری اقساط (${fa(items.length)})</strong>` + items.map(({ c, i }) =>
      `<button class="imp-remrow ${i.days < 0 ? "bad" : i.days === 0 ? "now" : ""}" data-imp-open="${c.id}"><span><b>${esc(c.name)}</b> <span class="note">${esc(c.phone || "")}</span></span><span>${toman(i.left)} · ${lbl(i.days)}</span></button>`).join("") + `</div>`;
  }
  function filterBar() {
    const docs = ofRole("doctor"), m = canMoney(who);
    const opt = (v, cur, t) => `<option value="${v}" ${v === cur ? "selected" : ""}>${t}</option>`;
    return `<div class="panel"><div class="row"><strong style="flex:1">پرونده‌های ایمپلنت</strong><button class="btn primary" data-imp="new">+ بیمار ایمپلنت</button></div>
      <div class="imp-filters">
        <input type="text" id="impQ" placeholder="جستجوی اسم یا شماره تلفن…" value="${esc(filt.q)}">
        <select data-f="doctor">${opt("", filt.doctor, "همه دکترها")}${docs.map(d => opt(d.id, filt.doctor, esc(d.name))).join("")}</select>
        <select data-f="region">${opt("", filt.region, "همه ناحیه‌ها")}${REG.map(([k, n]) => opt(k, filt.region, n)).join("")}</select>
        <select data-f="stage">${opt("", filt.stage, "همه مرحله‌ها")}${STAGES.filter(([k]) => k !== "none").map(([k, n]) => opt(k, filt.stage, n)).join("")}</select>
        ${m ? `<select data-f="money">${opt("", filt.money, "وضعیت مالی: همه")}${opt("overdue", filt.money, "قسط عقب‌افتاده")}${opt("week", filt.money, "قسط در ۷ روز آینده")}${opt("debt", filt.money, "بدهکار")}${opt("settled", filt.money, "تسویه‌شده")}</select>` : ""}
        <select data-f="sort">${opt("recent", filt.sort, "مرتب: جدیدترین")}${opt("name", filt.sort, "مرتب: اسم")}${m ? opt("overdue", filt.sort, "مرتب: بیشترین معوقه") + opt("debt", filt.sort, "مرتب: بیشترین بدهی") : ""}</select>
      </div>
      <label class="row note" style="margin-top:8px"><input type="checkbox" data-f="archived" ${filt.archived ? "checked" : ""}> نمایش بایگانی‌شده‌ها</label>
      ${Object.values(filt).some((v, i) => i < 5 && v) ? `<p style="margin:6px 0 0"><button class="btn quiet" data-imp="clear">پاک کردن فیلترها</button></p>` : ""}
      ${msg ? `<p class="okline" style="margin:8px 0 0">${msg}</p>` : ""}${err ? `<p class="warn">${esc(err)}</p>` : ""}</div>`;
  }
  function listHtml() {
    const rows = filtered(), m = canMoney(who);
    if (!rows.length) return `<div class="panel"><p class="note">${Object.keys(cases).length ? "با این فیلترها پرونده‌ای پیدا نشد." : "هنوز پرونده ایمپلنتی ثبت نشده."}</p></div>`;
    return `<p class="note">${fa(rows.length)} پرونده</p><div class="imp-list">` + rows.map(c => {
      const f = fin(c), st = stageOf(c);
      return `<button class="imp-card" data-imp-open="${c.id}">
        <div class="row" style="justify-content:space-between"><b>${esc(c.name)}</b><span class="note">${esc(nm(c.doctor))}</span></div>
        <div class="imp-regs">${REG.map(([k, n], i) => `<span class="imp-reg st-${st[i]}" title="${n}: ${STN[st[i]]}">${n}<small>${STN[st[i]]}</small></span>`).join("")}</div>
        ${m && f.total ? `<div class="note" style="margin-top:6px">${f.balance > 0 ? `مانده: <b>${toman(f.balance)}</b>` : `<span class="okline">تسویه</span>`}${f.overdue ? ` · <b style="color:var(--warn)">معوقه ${toman(f.overdue)}</b>` : ""}${f.next && !f.overdue ? ` · قسط بعدی ${jl(f.next.due)}` : ""}</div>` : ""}
        ${c.opg?.length ? `<div class="note">📷 ${fa(c.opg.length)} OPG</div>` : ""}
      </button>`;
    }).join("") + `</div>`;
  }
  function newForm() {
    const docs = ofRole("doctor");
    return `<div class="panel"><strong>بیمار ایمپلنت جدید</strong>
      <div class="row" style="margin-top:8px"><input type="text" id="impNName" placeholder="اسم بیمار" value="${esc(newDraft.name)}" style="flex:2 1 160px">
      <input type="tel" id="impNPhone" placeholder="شماره تلفن" value="${esc(newDraft.phone)}" style="flex:1 1 120px">
      <select id="impNDoc" style="flex:1 1 120px">${docs.map(d => `<option value="${d.id}" ${(newDraft.doctor || docs.find(x => x.specialty === "جراحی")?.id) === d.id ? "selected" : ""}>${esc(d.name)}</option>`).join("")}</select></div>
      ${err ? `<p class="warn">${esc(err)}</p>` : ""}
      <p class="row" style="margin-top:8px"><button class="btn primary" data-imp="create">ثبت و باز کردن پرونده</button><button class="btn quiet" data-imp="cancel-new">انصراف</button></p></div>`;
  }

  /* ---------- daily report ---------- */
  function reportHtml() {
    const d = reportDate || todayISO(), rows = [];
    for (const c of Object.values(cases)) for (const p of c.payments || []) if (p.date === d) rows.push({ c, p });
    const by = Object.fromEntries(METHODS.map(([k]) => [k, 0])); let sum = 0;
    for (const { p } of rows) { by[p.method] = (by[p.method] || 0) + p.amount; sum += p.amount; }
    let overdue = 0, overdueN = 0, week = 0, debt = 0;
    for (const c of Object.values(cases)) { if (c.archived) continue; const f = fin(c); debt += Math.max(0, f.balance); if (f.overdue) { overdue += f.overdue; overdueN++; } for (const i of f.inst) if (i.left > 0 && i.days >= 0 && i.days <= 7) week += i.left; }
    return `<div class="panel"><div class="row" style="justify-content:space-between"><strong>گزارش مالی روزانه</strong><button class="btn" data-imp="xlsx">دانلود Excel</button></div>
      <div style="margin-top:8px">${dateSel("rep", d)}</div>
      <div class="imp-stats">
        <div><small>دریافتی این روز</small><b>${toman(sum)}</b></div>
        ${METHODS.map(([k, n]) => `<div><small>${n}</small><b>${toman(by[k] || 0)}</b></div>`).join("")}
      </div>
      ${rows.length ? `<div class="scroll"><table class="imp-table"><thead><tr><th>بیمار</th><th>مبلغ</th><th>روش</th><th>جزئیات</th></tr></thead><tbody>${rows.map(({ c, p }) => `<tr><td><button class="linkbtn" data-imp-open="${c.id}">${esc(c.name)}</button></td><td>${toman(p.amount)}</td><td>${METN[p.method] || "—"}</td><td class="note">${payDetail(p)}</td></tr>`).join("")}</tbody></table></div>` : `<p class="note">در این روز پرداختی ثبت نشده.</p>`}
      <hr><strong>وضعیت کلی</strong>
      <div class="imp-stats"><div><small>کل مانده طلب</small><b>${toman(debt)}</b></div><div><small>معوقه (${fa(overdueN)} بیمار)</small><b style="color:var(--warn)">${toman(overdue)}</b></div><div><small>اقساط ۷ روز آینده</small><b>${toman(week)}</b></div></div></div>`;
  }
  function payDetail(p) {
    if (p.method === "card2card") return [p.card?.from4 ? "از کارت ****" + faD(p.card.from4) : "", p.card?.to ? "به " + esc(p.card.to) : "", p.card?.ref ? "پیگیری " + faD(p.card.ref) : ""].filter(Boolean).join(" · ") + (p.note ? " — " + esc(p.note) : "");
    return esc(p.note || "");
  }
  async function exportXlsx() {
    try { await loadVendor("xlsx"); } catch (e) { err = "فایل Excel بارگذاری نشد."; return render(); }
    const casesSheet = Object.values(cases).map(c => { const f = fin(c); return { "بیمار": c.name, "تلفن": c.phone || "", "دکتر": nm(c.doctor), ...Object.fromEntries(REG.map(([k, n]) => [n, STN[c.regions?.[k]?.status || "none"]])), "قرارداد (تومان)": f.total, "پرداخت‌شده": f.paid, "مانده": f.balance, "معوقه": f.overdue, "بایگانی": c.archived ? "بله" : "" }; });
    const pays = []; for (const c of Object.values(cases)) for (const p of c.payments || []) pays.push({ "تاریخ": jl(p.date), "بیمار": c.name, "مبلغ (تومان)": p.amount, "روش": METN[p.method] || "", "کارت مبدأ": p.card?.from4 || "", "کارت مقصد": p.card?.to || "", "پیگیری": p.card?.ref || "", "یادداشت": p.note || "" });
    const inst = []; for (const c of Object.values(cases)) for (const i of fin(c).inst) inst.push({ "بیمار": c.name, "تلفن": c.phone || "", "سررسید": jl(i.due), "مبلغ": i.amount, "پرداخت‌شده": i.got, "مانده": i.left, "وضعیت": { paid: "پرداخت شده", overdue: "عقب‌افتاده", today: "امروز", soon: "نزدیک", later: "آینده" }[i.state] });
    const wb = XLSX.utils.book_new();
    for (const [n, d] of [["پرونده‌ها", casesSheet], ["پرداخت‌ها", pays], ["اقساط", inst]]) { const ws = XLSX.utils.json_to_sheet(d); ws["!views"] = [{ RTL: true }]; XLSX.utils.book_append_sheet(wb, ws, n); }
    try { await saveFile({ filename: `ایمپلنت-${todayISO()}.xlsx`, data: new Blob([XLSX.write(wb, { type: "array", bookType: "xlsx" })]) }); } catch (e) {}
  }

  /* ---------- settings: access + clinic cards ---------- */
  function settingsHtml() {
    const staff = (cfg?.staff || []).filter(s => s.role !== "doctor");
    return `<div class="panel"><strong>دسترسی کارکنان به ایمپلنت</strong>
      <p class="note" style="margin:4px 0 8px">«کامل»: پرونده، پرداخت و اقساط. «محدود»: فقط پرونده و طرح درمان، بدون اطلاعات مالی. دکترها پرونده‌های خودشان را می‌بینند (محدود).</p>
      ${staff.map(s => `<div class="rule"><span>${esc(s.name)} <span class="note">(${ROLEN[s.role]})</span></span><select data-acc="${s.id}">${[["none", "بدون دسترسی"], ["limited", "محدود"], ["full", "کامل"]].map(([k, n]) => `<option value="${k}" ${(settings.access?.[s.id] || "none") === k ? "selected" : ""}>${n}</option>`).join("")}</select></div>`).join("")}
    </div>
    <div class="panel"><strong>کارت‌های کلینیک (برای کارت به کارت)</strong>
      <p class="note" style="margin:4px 0 8px">فقط اسم و ۴ رقم آخر کارت ذخیره می‌شود.</p>
      ${(settings.cards || []).map((c, i) => `<div class="rule"><span>${esc(c)}</span><button class="x" data-card-del="${i}">حذف</button></div>`).join("") || `<p class="note">کارتی ثبت نشده.</p>`}
      <div class="row" style="margin-top:8px"><input type="text" id="impCardName" placeholder="مثلاً: ملت – دکتر نوری" style="flex:2 1 150px"><input type="text" id="impCard4" inputmode="numeric" maxlength="4" placeholder="۴ رقم آخر" style="flex:1 1 80px"><button class="btn" data-imp="card-add">افزودن</button></div></div>`;
  }

  /* ---------- tab ---------- */
  function tab() {
    if (!canSee(who)) return "";
    const m = canMoney(who);
    const views = [["list", "پرونده‌ها"], ...(m ? [["report", "گزارش روزانه"]] : []), ...(who === "manager" ? [["settings", "دسترسی و کارت‌ها"]] : [])];
    if (!views.some(([k]) => k === view)) view = "list";
    let h = `<nav class="imp-sub">${views.map(([k, n]) => `<button data-imp-view="${k}" aria-pressed="${view === k}">${n}</button>`).join("")}</nav>`;
    if (view === "report") return h + reportHtml();
    if (view === "settings") return h + settingsHtml();
    return h + (view === "new" ? newForm() : "") + remindersPanel() + filterBar() + listHtml();
  }
  function staffPanel(id) {
    const me = byId(id); if (!me) return "";
    if (me.role === "doctor") {
      const mine = Object.values(cases).filter(c => c.doctor === id && !c.archived);
      if (!mine.length) return "";
      return `<div class="panel"><strong>بیماران ایمپلنت من</strong><div class="row" style="margin-top:8px">${mine.map(c => `<button class="btn quiet" data-imp-open="${c.id}">${esc(c.name)}</button>`).join("")}</div></div>`;
    }
    if (!canSee(id)) return "";
    return `<h3 style="margin:18px 0 8px">ایمپلنت ${canMoney(id) ? "" : `<span class="note">(دسترسی محدود)</span>`}</h3>` + tab();
  }
  const docCanOpen = c => byId(who)?.role === "doctor" && c.doctor === who;

  /* ---------- case sheet ---------- */
  function sheetHtml(c) {
    const m = canMoney(who), f = fin(c);
    let h = `<h2>${esc(c.name)}${c.archived ? ` <span class="note">(بایگانی)</span>` : ""}</h2>
      <p class="note" style="margin:0 0 8px">${esc(nm(c.doctor))} · ${esc(c.phone || "بدون تلفن")}</p>
      ${sheetMsg ? `<p class="okline">${sheetMsg}</p>` : ""}${sheetErr ? `<p class="warn">${esc(sheetErr)}</p>` : ""}`;
    if (money) return h + confirmHtml();
    h += `<strong>ناحیه‌های درمان</strong><div class="imp-regbox">` + REG.map(([k, n]) => {
      const r = c.regions?.[k] || { status: "none" };
      if (editRegion === k) return `<div class="imp-regedit"><b>${n}</b>
        <label class="note">مرحله</label><select id="impRS">${STAGES.map(([s, t]) => `<option value="${s}" ${r.status === s ? "selected" : ""}>${t}</option>`).join("")}</select>
        <label class="note">طرح درمان</label><textarea id="impRP" style="min-height:60px" placeholder="مثلاً: ۲ ایمپلنت دندان ۱۵ و ۱۶، پیوند استخوان">${esc(r.plan || "")}</textarea>
        <label class="note">تاریخ مرحله بعد (اختیاری)</label><label class="row note"><input type="checkbox" id="impRHas" ${r.next ? "checked" : ""}> تاریخ دارد</label>${dateSel("reg", r.next || isoAdd(todayISO(), 90))}
        <p class="row" style="margin-top:8px"><button class="btn primary" data-imp="reg-save">ذخیره</button><button class="btn quiet" data-imp="reg-cancel">انصراف</button></p></div>`;
      return `<div class="imp-regcell st-${r.status}"><div class="row" style="justify-content:space-between"><b>${n}</b><button class="btn quiet" data-reg="${k}" style="padding:2px 10px">✏️ اصلاح</button></div>
        <div>${STN[r.status]}</div>${r.plan ? `<div class="note">${esc(r.plan)}</div>` : ""}${r.next ? `<div class="note">مرحله بعد: ${jl(r.next)}</div>` : ""}</div>`;
    }).join("") + `</div>`;

    h += `<hr><div class="row" style="justify-content:space-between"><strong>OPG و تصاویر</strong><label class="btn">📷 آپلود OPG<input type="file" id="impOpg" accept="image/*" hidden multiple></label></div>
      <div class="imp-opgs">${(c.opg || []).map(o => `<figure><button data-opg="${o.id}"><img src="${o.thumb}" alt="OPG ${esc(o.name)}"></button><figcaption>${jl(o.date)}<button class="x" data-opg-del="${o.id}">حذف</button></figcaption></figure>`).join("") || `<p class="note">هنوز تصویری آپلود نشده.</p>`}</div>`;

    if (m) {
      h += `<hr><strong>امور مالی</strong>
        <div class="imp-stats"><div><small>مبلغ قرارداد</small><b>${toman(f.total)}</b></div><div><small>پرداخت‌شده</small><b style="color:var(--ok)">${toman(f.paid)}</b></div><div><small>مانده</small><b style="color:${f.balance > 0 ? "var(--warn)" : "var(--ok)"}">${f.balance > 0 ? toman(f.balance) : f.balance < 0 ? toman(-f.balance) + " طلبکار" : "تسویه"}</b></div>${f.overdue ? `<div><small>معوقه</small><b style="color:var(--warn)">${toman(f.overdue)}</b></div>` : ""}</div>`;
      h += f.inst.length ? `<div class="scroll"><table class="imp-table"><thead><tr><th>سررسید</th><th>مبلغ</th><th>وضعیت</th></tr></thead><tbody>${f.inst.map(i => `<tr class="is-${i.state}"><td>${jl(i.due)}</td><td>${toman(i.amount)}</td><td>${i.state === "paid" ? "✓ پرداخت شده" : i.state === "overdue" ? `${fa(-i.days)} روز عقب‌افتاده` + (i.got ? ` (مانده ${toman(i.left)})` : "") : i.state === "today" ? "امروز" : `${fa(i.days)} روز مانده`}</td></tr>`).join("")}</tbody></table></div>` : "";
      h += `<details class="imp-det" ${f.total ? "" : "open"}><summary>${f.total ? "تغییر قرارداد و اقساط" : "ثبت قرارداد و اقساط"}</summary>
        <label class="note">مبلغ کل قرارداد</label>${moneyInput("impTotal", instDraft.total || (f.total ? commas(f.total) : ""))}
        <label class="note">پیش‌پرداخت (بخشی از پرداخت‌ها که قسط حساب نمی‌شود)</label>${moneyInput("impDown", instDraft.down || (c.contract?.down ? commas(c.contract.down) : ""), "مثال: 20,000,000")}
        <div class="row" style="margin-top:6px"><label class="note">تعداد قسط <input type="number" id="impCount" min="0" max="36" value="${esc(instDraft.count)}" style="width:70px"></label>
        <label class="note">هر چند روز <input type="number" id="impEvery" min="1" max="120" value="${esc(instDraft.every)}" style="width:70px"></label></div>
        <label class="note">تاریخ اولین قسط</label>${dateSel("inst", instDraft.start || isoAdd(todayISO(), 30))}
        <p class="note">اقساط مساوی ساخته می‌شوند؛ هر پرداخت از قدیمی‌ترین قسط کم می‌شود.</p>
        <p class="row"><button class="btn" data-imp="contract">بررسی و ثبت</button></p></details>`;
      const pays = (c.payments || []).slice().sort((a, b) => b.date.localeCompare(a.date) || b.at - a.at);
      h += `<div style="margin-top:10px"><strong>پرداخت‌ها</strong>${pays.map(p => `<div class="rule"><span><b>${toman(p.amount)}</b> <span class="note">${jl(p.date)} · ${METN[p.method] || ""}</span><div class="note">${payDetail(p)}</div></span><button class="x" data-pay-del="${p.id}">حذف</button></div>`).join("") || `<p class="note">پرداختی ثبت نشده.</p>`}</div>`;
      h += `<div class="imp-payform"><strong>ثبت پرداخت</strong>
        ${moneyInput("impPay", payDraft.amount)}
        <div class="imp-methods">${METHODS.map(([k, n]) => `<button data-meth="${k}" aria-pressed="${payDraft.method === k}">${n}</button>`).join("")}</div>
        ${payDraft.method === "card2card" ? `<div class="row"><input type="text" id="impFrom4" inputmode="numeric" maxlength="4" placeholder="۴ رقم آخر کارت بیمار" value="${esc(payDraft.from4)}" style="flex:1 1 120px">
          <select id="impTo" style="flex:1 1 140px"><option value="">کارت مقصد…</option>${(settings.cards || []).map(x => `<option ${payDraft.toCard === x ? "selected" : ""}>${esc(x)}</option>`).join("")}</select>
          <input type="text" id="impRef" inputmode="numeric" placeholder="شماره پیگیری" value="${esc(payDraft.ref)}" style="flex:1 1 120px"></div>` : ""}
        <label class="note">تاریخ پرداخت</label>${dateSel("pay", payDraft.date || todayISO())}
        <input type="text" id="impPNote" placeholder="یادداشت (اختیاری)" value="${esc(payDraft.note)}" style="width:100%;margin-top:6px">
        <p class="row" style="margin-top:8px"><button class="btn primary" data-imp="pay">بررسی و ثبت پرداخت</button></p></div>`;
    }
    if (who === "manager" || canMoney(who)) {
      const hasMoney = (c.payments || []).length || (c.installments || []).length || c.contract?.total;
      h += `<hr><div class="row">${c.archived ? `<button class="btn" data-imp="unarchive">برگرداندن از بایگانی</button>` : `<button class="btn quiet" data-imp="archive">بایگانی پرونده</button>`}
        ${delArm === c.id ? `<span class="warn">${hasMoney ? "این بیمار اطلاعات مالی دارد و حذف نمی‌شود؛ به‌جایش بایگانی کنید." : "مطمئنید؟ پرونده و تصاویرش برای همیشه پاک می‌شود."}</span>${hasMoney ? "" : `<button class="btn danger" data-imp="del-yes">بله، حذف کن</button>`}<button class="btn quiet" data-imp="del-no">انصراف</button>` : `<button class="btn danger" data-imp="del">🗑 حذف پرونده</button>`}</div>`;
    }
    return h;
  }
  function confirmHtml() {
    const x = money;
    const lines = x.kind === "pay" ? [`روش: ${METN[x.data.method]}`, x.data.method === "card2card" ? payDetail(x.data) : "", `تاریخ: ${jl(x.data.date)}`]
      : [`پیش‌پرداخت: ${toman(x.data.down)}`, x.data.count ? `${fa(x.data.count)} قسط ${toman(x.data.per)}${x.data.rest ? ` (قسط آخر ${toman(x.data.per + x.data.rest)})` : ""}، هر ${fa(x.data.every)} روز، از ${jl(x.data.start)}` : "بدون قسط"];
    return `<div class="imp-confirm"><div class="note">${x.kind === "pay" ? "مبلغ پرداخت" : "مبلغ کل قرارداد"}</div>
      <div class="imp-big" dir="ltr">${commas(x.amount)}</div><div class="imp-bigfa">${toman(x.amount)}</div><div class="note">${esc(words(x.amount))} تومان</div>
      <ul class="clean">${lines.filter(Boolean).map(l => `<li>${l}</li>`).join("")}</ul>
      <p style="font-weight:700">آیا مبلغ درست است؟</p>
      <p class="row"><button class="btn primary" data-imp="money-ok">✅ تأیید و ثبت</button><button class="btn" data-imp="money-edit">✏️ اصلاح مبلغ</button></p></div>`;
  }
  function openCase(id) { openId = id; money = null; delArm = null; editRegion = null; sheetMsg = ""; sheetErr = ""; instDraft = { total: "", down: "", count: "6", start: null, every: "30" }; payDraft = { amount: "", method: "cash", from4: "", toCard: "", ref: "", note: "", date: null }; renderSheet(); }
  function renderSheet() {
    const c = cases[openId]; if (!c) return;
    Shell.sheet(sheetHtml(c), root => {
      wireMoney(root);
      const keep = () => {
        const v = s => root.querySelector(s)?.value;
        if (root.querySelector("#impPay")) payDraft = { ...payDraft, amount: v("#impPay"), note: v("#impPNote") || "", from4: v("#impFrom4") ?? payDraft.from4, toCard: v("#impTo") ?? payDraft.toCard, ref: v("#impRef") ?? payDraft.ref, date: readDate(root, "pay") };
        if (root.querySelector("#impTotal")) instDraft = { total: v("#impTotal"), down: v("#impDown"), count: v("#impCount"), every: v("#impEvery"), start: readDate(root, "inst") };
      };
      root.querySelectorAll("[data-meth]").forEach(b => b.onclick = () => { keep(); payDraft.method = b.dataset.meth; renderSheet(); });
      root.querySelectorAll("[data-reg]").forEach(b => b.onclick = () => { keep(); editRegion = b.dataset.reg; renderSheet(); });
      root.querySelectorAll("[data-dsel]").forEach(s => s.onchange = () => { if (s.dataset.dsel.endsWith("|m") || s.dataset.dsel.endsWith("|y")) { keep(); renderSheet(); } });
      root.querySelectorAll("[data-pay-del]").forEach(b => b.onclick = async () => { if (b.dataset.arm !== "1") { b.dataset.arm = "1"; b.textContent = "مطمئنید؟"; return; } const x = structuredClone(c); x.payments = x.payments.filter(p => p.id !== b.dataset.payDel); await save(x); sheetMsg = "پرداخت حذف شد."; renderSheet(); });
      root.querySelectorAll("[data-opg]").forEach(b => b.onclick = () => viewOpg(c, b.dataset.opg));
      root.querySelectorAll("[data-opg-del]").forEach(b => b.onclick = async () => { if (b.dataset.arm !== "1") { b.dataset.arm = "1"; b.textContent = "مطمئنید؟"; return; } const x = structuredClone(c); x.opg = x.opg.filter(o => o.id !== b.dataset.opgDel); try { await IDB.del(b.dataset.opgDel); } catch (e) {} await save(x); renderSheet(); });
      const up = root.querySelector("#impOpg"); if (up) up.onchange = () => uploadOpg(c, [...up.files]);
      root.querySelectorAll("[data-imp]").forEach(b => b.onclick = () => { keep(); sheetAct(b.dataset.imp, root, b); });
    });
  }
  async function uploadOpg(c, files) {
    sheetErr = ""; sheetMsg = "در حال ذخیره تصویر…"; renderSheet();
    const x = structuredClone(c); x.opg = x.opg || [];
    for (const f of files) {
      if (!f.type.startsWith("image/")) { sheetErr = "فقط فایل تصویری (عکس OPG) قابل آپلود است."; continue; }
      try {
        const full = await shrink(f, 2000, .85), thumb = await shrink(f, 240, .7), id = "opg" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
        await IDB.put(id, full); x.opg.push({ id, name: f.name.slice(0, 60), date: todayISO(), thumb });
      } catch (e) { sheetErr = "ذخیره تصویر انجام نشد (شاید حافظه گوشی پر است)."; }
    }
    await save(x); sheetMsg = sheetErr ? "" : "تصویر ذخیره شد."; renderSheet();
  }
  async function viewOpg(c, id) {
    let src = null; try { src = await IDB.get(id); } catch (e) {}
    const o = (c.opg || []).find(x => x.id === id); src = src || o?.thumb;
    Shell.sheet(`<h2>OPG — ${esc(c.name)}</h2><p class="note">${o ? jl(o.date) + " · " + esc(o.name) : ""}</p><img src="${src}" alt="OPG" style="width:100%;border-radius:8px;background:#000">
      <p class="row" style="margin-top:8px"><button class="btn" data-back>بازگشت به پرونده</button><a class="btn quiet" href="${src}" download="OPG-${esc(c.name)}.jpg">ذخیره تصویر</a></p>`, root => { root.querySelector("[data-back]").onclick = renderSheet; });
  }
  async function sheetAct(a, root, btn) {
    const c = cases[openId]; if (!c) return;
    sheetErr = ""; sheetMsg = "";
    if (a === "reg-cancel") { editRegion = null; return renderSheet(); }
    if (a === "reg-save") {
      const x = structuredClone(c); x.regions = x.regions || {};
      x.regions[editRegion] = { status: root.querySelector("#impRS").value, plan: root.querySelector("#impRP").value.trim(), next: root.querySelector("#impRHas").checked ? readDate(root, "reg") : null, at: Date.now() };
      await save(x); sheetMsg = `طرح درمان ${REGN[editRegion]} به‌روز شد.`; editRegion = null; return renderSheet();
    }
    if (a === "pay") {
      const amount = parseMoney(payDraft.amount);
      if (!amount) { sheetErr = "مبلغ پرداخت را بنویسید."; return renderSheet(); }
      if (payDraft.method === "card2card" && payDraft.from4 && !/^\d{4}$/.test(digits(payDraft.from4))) { sheetErr = "۴ رقم آخر کارت باید دقیقاً ۴ رقم باشد."; return renderSheet(); }
      money = { kind: "pay", amount, data: { method: payDraft.method, date: payDraft.date || todayISO(), note: payDraft.note.trim(), card: payDraft.method === "card2card" ? { from4: digits(payDraft.from4) || null, to: payDraft.toCard || null, ref: digits(payDraft.ref).trim() || null } : null } };
      return renderSheet();
    }
    if (a === "contract") {
      const total = parseMoney(instDraft.total), down = parseMoney(instDraft.down), count = Math.max(0, Math.min(36, Math.floor(+digits(instDraft.count) || 0))), every = Math.max(1, Math.floor(+digits(instDraft.every) || 30));
      if (!total) { sheetErr = "مبلغ کل قرارداد را بنویسید."; return renderSheet(); }
      if (down > total) { sheetErr = "پیش‌پرداخت از مبلغ کل بیشتر است."; return renderSheet(); }
      const rem = total - down, per = count ? Math.floor(rem / count / 1000) * 1000 : 0;
      money = { kind: "contract", amount: total, data: { down, count, every, start: instDraft.start || isoAdd(todayISO(), 30), per, rest: count ? rem - per * count : 0 } };
      return renderSheet();
    }
    if (a === "money-edit") { money = null; return renderSheet(); }
    if (a === "money-ok") {
      const x = structuredClone(c), m = money; money = null;
      if (m.kind === "pay") {
        x.payments = [...(x.payments || []), { id: uid(), amount: m.amount, ...m.data, by: who, at: Date.now() }];
        payDraft = { amount: "", method: "cash", from4: "", toCard: "", ref: "", note: "", date: null };
        sheetMsg = `پرداخت ${toman(m.amount)} ثبت شد.`;
      } else {
        const d = m.data;
        x.contract = { total: m.amount, down: d.down, at: Date.now() };
        x.installments = Array.from({ length: d.count }, (_, i) => ({ id: uid() + i, due: isoAdd(d.start, i * d.every), amount: d.per + (i === d.count - 1 ? d.rest : 0) }));
        instDraft = { total: "", down: "", count: "6", start: null, every: "30" };
        sheetMsg = `قرارداد ${toman(m.amount)}${d.count ? ` با ${fa(d.count)} قسط` : ""} ثبت شد.`;
      }
      await save(x); return renderSheet();
    }
    if (a === "archive" || a === "unarchive") { const x = structuredClone(c); x.archived = a === "archive"; await save(x); sheetMsg = x.archived ? "پرونده بایگانی شد (هر وقت خواستید برمی‌گردد)." : "پرونده از بایگانی برگشت."; return renderSheet(); }
    if (a === "del") { delArm = c.id; return renderSheet(); }
    if (a === "del-no") { delArm = null; return renderSheet(); }
    if (a === "del-yes") {
      if ((c.payments || []).length || (c.installments || []).length || c.contract?.total) { delArm = null; return renderSheet(); }
      for (const o of c.opg || []) { try { await IDB.del(o.id); } catch (e) {} }
      await LDB.doc("implants/" + c.id).delete(); delete cases[c.id]; delArm = null; openId = null; Shell.close(); msg = `پرونده «${esc(c.name)}» حذف شد.`; return render();
    }
  }

  /* ---------- tab bindings ---------- */
  function bind() {
    const app = $("#app"); if (!app) return;
    wireMoney(app);
    app.querySelectorAll("[data-imp-open]").forEach(b => b.onclick = () => openCase(b.dataset.impOpen));
    app.querySelectorAll("[data-imp-view]").forEach(b => b.onclick = () => { view = b.dataset.impView; msg = ""; err = ""; render(); });
    const q = $("#impQ"); if (q) q.oninput = e => { filt.q = e.target.value; clearTimeout(q._t); q._t = setTimeout(() => { render(); const n = $("#impQ"); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }, 250); };
    app.querySelectorAll("[data-f]").forEach(s => s.onchange = () => { filt[s.dataset.f] = s.type === "checkbox" ? s.checked : s.value; render(); });
    app.querySelectorAll("[data-acc]").forEach(s => s.onchange = async () => { settings = { ...settings, access: { ...settings.access, [s.dataset.acc]: s.value } }; await LDB.doc("implant/settings").set(settings); });
    app.querySelectorAll("[data-card-del]").forEach(b => b.onclick = async () => { settings.cards = settings.cards.filter((_, i) => i !== +b.dataset.cardDel); await LDB.doc("implant/settings").set(settings); });
    app.querySelectorAll("[data-dsel^='rep|']").forEach(s => s.onchange = () => { reportDate = readDate(app, "rep"); render(); });
    for (const [id, k] of [["impNName", "name"], ["impNPhone", "phone"], ["impNDoc", "doctor"]]) { const e = $("#" + id); if (e) e.oninput = e.onchange = () => newDraft[k] = e.value; }
    app.querySelectorAll("[data-imp]").forEach(b => b.onclick = async () => {
      const a = b.dataset.imp; msg = ""; err = "";
      if (a === "new") { view = "new"; return render(); }
      if (a === "cancel-new") { view = "list"; return render(); }
      if (a === "clear") { filt = { q: "", doctor: "", stage: "", region: "", money: "", archived: false, sort: filt.sort }; return render(); }
      if (a === "xlsx") return exportXlsx();
      if (a === "card-add") {
        const n = $("#impCardName").value.trim(), d = digits($("#impCard4").value).trim();
        if (!n || !/^\d{4}$/.test(d)) { err = "اسم کارت و ۴ رقم آخر را درست بنویسید."; view = "settings"; return render(); }
        settings.cards = [...(settings.cards || []), `${n} (****${d})`]; await LDB.doc("implant/settings").set(settings); return render();
      }
      if (a === "create") {
        const name = (newDraft.name || "").trim(); if (!name) { err = "اسم بیمار را بنویسید."; return render(); }
        const doctor = $("#impNDoc")?.value || newDraft.doctor, id = "imp" + uid();
        const dup = Object.values(cases).find(c => NLU.norm(c.name) === NLU.norm(name));
        await save({ id, name, phone: (newDraft.phone || "").trim() || null, doctor, createdAt: Date.now(), regions: {}, payments: [], installments: [], opg: [] });
        newDraft = { name: "", phone: "", doctor }; view = "list"; msg = dup ? `ثبت شد. توجه: بیمار دیگری هم با اسم «${esc(name)}» وجود دارد.` : "ثبت شد."; render(); return openCase(id);
      }
    });
  }

  /* ---------- demo data ---------- */
  function fakeOpg(label, seed, k = 1) {
    const c = document.createElement("canvas"); c.width = 900 * k; c.height = 420 * k; const g = c.getContext("2d"); g.scale(k, k);
    let s = seed; const r = () => (s = (s * 9301 + 49297) % 233280) / 233280;
    g.fillStyle = "#0b0b0b"; g.fillRect(0, 0, 900, 420);
    const grd = g.createRadialGradient(450, 210, 40, 450, 210, 430); grd.addColorStop(0, "#5a5a5a"); grd.addColorStop(1, "#111"); g.fillStyle = grd;
    g.beginPath(); g.ellipse(450, 215, 400, 170, 0, 0, Math.PI * 2); g.fill();
    for (const [y0, dir] of [[205, -1], [225, 1]]) for (let i = 0; i < 16; i++) {
      const x = 130 + i * 41, curve = Math.pow((i - 7.5) / 7.5, 2) * 40, y = y0 - dir * curve;
      g.fillStyle = `rgba(235,235,235,${.75 + r() * .2})`; g.beginPath(); g.ellipse(x, y + dir * 28, 16, 30, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = "rgba(190,190,190,.55)"; g.fillRect(x - 6, y + dir * 50 - (dir < 0 ? 55 : 0), 12, 55);
      if (r() < .12) { g.fillStyle = "#fff"; g.fillRect(x - 5, y + dir * 55 - (dir < 0 ? 60 : 0), 10, 60); }
    }
    g.fillStyle = "#cfcfcf"; g.font = "bold 22px Vazirmatn, Tahoma"; g.textAlign = "right"; g.fillText("OPG نمونه — " + label, 880, 400);
    return c.toDataURL("image/jpeg", k < 1 ? .7 : .8);
  }
  async function seed() {
    const t = todayISO(), docs = (cfg?.staff || []).filter(s => s.role === "doctor");
    const surg = docs.find(d => d.specialty === "جراحی")?.id || docs[0]?.id, perio = docs.find(d => d.specialty?.startsWith("پریو"))?.id || surg;
    const P = (days, amount, method, card, note) => ({ id: uid() + Math.random().toString(36).slice(2, 4), amount, date: isoAdd(t, days), method, card: card || null, note: note || "", at: Date.now() + days });
    const INST = (firstIn, n, amount, every = 30) => Array.from({ length: n }, (_, i) => ({ id: uid() + i, due: isoAdd(t, firstIn + i * every), amount }));
    const R = (status, plan, nextIn) => ({ status, plan, next: nextIn == null ? null : isoAdd(t, nextIn), at: Date.now() });
    const K = (from4, to, ref) => ({ from4, to, ref });
    const card1 = "ملت – کلینیک (****4821)", card2 = "سامان – دکتر نوری (****1093)";
    const list = [
      ["سکینه اله‌قلی", "09121234567", surg, { ur: R("deferred", "۲ ایمپلنت دندان ۱۵ و ۱۶ — ۳ ماه بعد", 90), ul: R("planned", "ایمپلنت دندان ۲۴", 5) }, 120e6, 30e6, INST(-2, 6, 15e6), [P(-40, 30e6, "cash")], 0],
      ["محمود اسکندری", "09351112233", surg, { ll: R("healing", "ایمپلنت ۳۶ و ۳۷ + پیوند استخوان", 45) }, 85e6, 25e6, INST(-65, 4, 15e6), [P(-95, 25e6, "card2card", K("6037", card1, "448213")), P(-64, 15e6, "pos"), P(-33, 15e6, "card2card", K("6037", card1, "501977"))], 1],
      ["فرشته کاظمی", "09198887766", perio, { ur: R("prosthetic", "ایمپلنت ۱۴", 10), lr: R("done", "ایمپلنت ۴۶") }, 60e6, 20e6, INST(1, 4, 10e6), [P(-120, 20e6, "cash"), P(-29, 10e6, "card2card", K("5892", card2, "730115")), P(-1, 10e6, "pos")], 2],
      ["رضا تهرانی", "09124445566", surg, { ul: R("surgery", "ایمپلنت ۲۵ و ۲۶", 60), ll: R("planned", "ایمپلنت ۳۶", 30) }, 150e6, 50e6, INST(0, 5, 20e6), [P(-15, 50e6, "cheque", null, "چک صیادی ۱۴۰۵/۰۷")], 0],
      ["پروین سلیمانی", "09367778899", perio, { lr: R("planned", "ایمپلنت ۴۵ و ۴۶", 20) }, 70e6, 10e6, INST(3, 6, 10e6), [P(0, 10e6, "card2card", K("6219", card1, "912004"))], 0],
      ["حمید رستمی", "09151231234", surg, { ur: R("done", "ایمپلنت ۱۶"), ul: R("done", "ایمپلنت ۲۶") }, 90e6, 30e6, INST(-150, 3, 20e6), [P(-180, 30e6, "cash"), P(-150, 20e6, "pos"), P(-120, 20e6, "pos"), P(-90, 20e6, "card2card", K("6037", card2, "118220"))], 1],
      ["نازنین مرادی", "09381239876", surg, { ll: R("healing", "ایمپلنت ۳۶", 20), lr: R("healing", "ایمپلنت ۴۶", 20) }, 110e6, 30e6, INST(-20, 4, 20e6), [P(-50, 30e6, "card2card", K("5022", card1, "663401"))], 0],
      ["علی‌اکبر یوسفی", "09133334444", perio, { ur: R("planned", "سینوس لیفت + ۲ ایمپلنت", 14) }, 0, 0, [], [], 0],
      ["مهسا نیک‌نام", "09105556677", surg, { ul: R("surgery", "ایمپلنت ۲۱ فوری", 90) }, 45e6, 15e6, INST(7, 3, 10e6), [P(0, 15e6, "pos")], 1],
      ["جواد فرهادی", "09189990011", surg, { lr: R("prosthetic", "روکش روی ایمپلنت ۴۶", 3) }, 55e6, 15e6, INST(-45, 4, 10e6), [P(-75, 15e6, "cash"), P(-44, 10e6, "cash")], 0]
    ];
    await LDB.doc("implant/settings").set({ access: { a1: "full", a2: "limited", r1: "full", r2: "limited" }, cards: [card1, card2] });
    let n = 0;
    for (const [name, phone, doctor, regions, total, down, installments, payments, opgN] of list) {
      const id = "imp" + uid() + n++, opg = [];
      for (let k = 0; k < opgN; k++) { const sd = 17 + n * 7 + k, oid = "opg" + id + k; try { await IDB.put(oid, fakeOpg(name, sd)); } catch (e) {} opg.push({ id: oid, name: "OPG نمونه", date: isoAdd(t, -30 * (k + 1)), thumb: fakeOpg(name, sd, .27) }); }
      await LDB.doc("implants/" + id).set({ id, name, phone, doctor, createdAt: Date.now() - n * 3600e3, regions, contract: total ? { total, down, at: Date.now() } : null, installments, payments, opg });
    }
  }

  function start() {
    LDB.collection("implants").onSnapshot(q => { cases = {}; q.docs.forEach(x => cases[x.id] = x.data()); loadedOnce = true; render(); if (openId && !$("#sheet").hidden && !money) renderSheet(); });
    LDB.doc("implant/settings").onSnapshot(sn => { settings = sn.exists ? sn.data() : { access: {}, cards: [] }; render(); });
  }
  const badge = () => canMoney(who) ? Object.values(cases).filter(c => !c.archived && fin(c).inst.some(i => i.left > 0 && i.days <= 0)).length : 0;
  return { start, seed, tab, staffPanel, bind, badge, canSee, _t: { parseMoney, commas, words, fin } };
})();
