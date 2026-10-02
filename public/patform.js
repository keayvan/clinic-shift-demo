/* فرم پروندهٔ بیمار، مطابق فرم کاغذی کلینیک: فیلدها، خواندن از فرم، نمایش و متن PDF.
   همهٔ فیلدهای تازه اختیاری‌اند؛ پروندهٔ بیمارهای قبلی بدون تغییر کار می‌کند. */
(function (root) {
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const fa = n => String(n).replace(/\d/g, d => "۰۱۲۳۴۵۶۷۸۹"[d]);
  const en = s => String(s ?? "").replace(/[۰-۹]/g, d => "۰۱۲۳۴۵۶۷۸۹".indexOf(d)).replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d));

  const REFERRAL = [["friends", "معرفی دوستان و آشنایان"], ["instagram", "اینستاگرام"], ["website", "سایت"], ["signage", "تابلو"], ["insurance", "بیمه"]];
  const ALLERGY = [["antibiotic", "آنتی‌بیوتیک‌ها (پنی‌سیلین، مترونیدازول، آزیترومایسین)"], ["anesthetic", "داروهای بی‌حسی موضعی"], ["painkiller", "مسکن‌ها"], ["food", "غذای خاص"]];
  const COND = [["gi", "بیماری‌های گوارشی"], ["diabetes", "دیابت"], ["kidney", "بیماری‌های کلیوی"], ["hyperthyroid", "تیروئید پرکار"], ["aids", "ایدز"],
    ["hypertension", "فشارخون بالا"], ["hypotension", "فشارخون پایین"], ["hepatitis", "هپاتیت"], ["hypothyroid", "تیروئید کم‌کار"], ["cardio", "بیماری‌های قلبی و عروقی"],
    ["respiratory", "بیماری‌های تنفسی"], ["blood", "بیماری‌های خونی"], ["epilepsy", "صرع"], ["joint", "بیماری‌های مفاصل"], ["asthma", "آسم و آلرژی"], ["bruxism", "دندان قروچه"]];
  const label = (list, k) => (list.find(x => x[0] === k) || [k, k])[1];
  const arr = v => (Array.isArray(v) ? v : []);

  /* سال شمسی جاری (برای محاسبهٔ سن از سال تولد) */
  function persianYear() {
    try { const m = new Intl.DateTimeFormat("en-u-ca-persian", { year: "numeric" }).format(new Date()).match(/\d{3,4}/); return m ? +m[0] : null; } catch (e) { return null; }
  }
  function ageFromBirth(by, now) { const y = now || persianYear(); return y && by >= 1250 && by <= y ? y - by : null; }

  /* آلرژی و بیماری‌ها: ترکیب گزینه‌های تیک‌خورده با متن آزاد */
  function allergyText(p) { return [...arr(p.allergyFlags).map(k => label(ALLERGY, k)), p.allergies].filter(Boolean).join("؛ "); }
  function condText(p) { return [...arr(p.condFlags).map(k => label(COND, k)), p.conditions].filter(Boolean).join("؛ "); }
  const yn = v => v === true ? "بله" : v === false ? "خیر" : "";

  /* ---------- فرم ورود اطلاعات ---------- */
  function fields(prefix, p, d) {
    p = p || {}; d = d || {};
    const ins = { ...(p.insurance || {}), ...(d.insurance || {}) };
    const g = k => (k in d ? d[k] : p[k]);
    const t = (k, lab, o = {}) => `<div style="flex:${o.flex || "1 1 130px"}"><label class="note" style="display:block" for="${prefix}-${k}">${lab}</label><input type="${o.type || "text"}" style="width:100%;box-sizing:border-box" id="${prefix}-${k}" data-pf="${k}" ${o.attr || ""} placeholder="${esc(o.ph || "")}" value="${esc(o.val ?? g(k) ?? "")}"></div>`;
    const ti = (k, lab, o = {}) => t("ins." + k, lab, { ...o, val: ins[k] ?? "" });
    const checks = (k, list, cur) => `<div class="row" style="flex-wrap:wrap;gap:6px 14px;margin-top:4px">${list.map(([key, lab]) => `<label class="row" style="gap:5px;align-items:center"><input type="checkbox" data-pf="${k}" data-opt="${key}" ${arr(cur).includes(key) ? "checked" : ""}><span>${lab}</span></label>`).join("")}</div>`;
    const sel = (k, lab) => { const v = g(k); const cur = v === true ? "yes" : v === false ? "no" : ""; return `<div style="flex:1 1 130px"><label class="note" style="display:block" for="${prefix}-${k}">${lab}</label><select style="width:100%;box-sizing:border-box" id="${prefix}-${k}" data-pf="${k}" data-yn="1">${[["", "—"], ["yes", "بله"], ["no", "خیر"]].map(([val, l]) => `<option value="${val}" ${cur === val ? "selected" : ""}>${l}</option>`).join("")}</select></div>`; };
    const area = (k, lab, ph, warn) => `<div style="margin-top:8px"><label class="note" for="${prefix}-${k}" style="display:block;${warn ? "color:var(--warn)" : ""}">${lab}</label><textarea id="${prefix}-${k}" data-pf="${k}" style="width:100%;box-sizing:border-box;min-height:48px;${warn ? "border-color:var(--warn)" : ""}" placeholder="${esc(ph)}">${esc(g(k) || "")}</textarea></div>`;
    const row = inner => `<div class="row" style="flex-wrap:wrap;gap:10px;margin-top:8px">${inner}</div>`;
    const sec = (title, open, inner) => `<details class="pfsec" ${open ? "open" : ""} style="margin-top:10px"><summary style="cursor:pointer;font-weight:700">${title}</summary>${inner}</details>`;
    return `<div data-pfroot="${prefix}">
      ${sec("مشخصات", true, row(t("fileNo", "شمارهٔ پرونده") + t("nationalId", "کد ملی", { attr: 'maxlength="10" inputmode="numeric"' })) +
        row(t("fatherName", "نام پدر") + t("birthYear", "سال تولد", { ph: "مثلاً ۱۳۷۰", attr: 'inputmode="numeric" maxlength="4"', flex: "1 1 90px" }) + t("age", "سن", { type: "number", attr: 'min="0" max="120"', flex: "1 1 70px" }) + t("job", "شغل")) +
        row(t("phone", "تلفن همراه", { type: "tel" }) + t("phoneHome", "تلفن ثابت", { type: "tel" }) + t("phoneEmerg", "تلفن اضطراری", { type: "tel" })) +
        area("address", "نشانی", "") +
        `<div style="margin-top:8px"><span class="note">از چه طریقی با ما آشنا شدید؟</span>${checks("referral", REFERRAL, g("referral"))}</div>`)}
      ${sec("بیمه", false, row(ti("name", "بیمهٔ پایه", { ph: "مثلاً: تامین‌اجتماعی" }) + ti("supplementary", "بیمهٔ مکمل") + ti("number", "شمارهٔ بیمه")) +
        row(ti("letterExpiry", "تاریخ اعتبار معرفی‌نامه", { ph: "۱۴۰۵/۰۷/۳۰" }) + ti("franchise", "فرانشیز") + ti("cap", "سقف بیمه (تومان)", { type: "number", attr: 'min="0"' }) + ti("opg", "OPG")))}
      ${sec("سابقهٔ پزشکی", true, `<div style="margin-top:8px"><span class="note" style="color:var(--warn)">حساسیت یا واکنش غیرعادی به:</span>${checks("allergyFlags", ALLERGY, g("allergyFlags"))}</div>` +
        area("allergies", "سایر موارد حساسیت", "مثلاً: لاتکس", true) +
        `<div style="margin-top:10px"><span class="note">به کدام‌یک از بیماری‌های زیر مبتلا شده‌اید؟</span>${checks("condFlags", COND, g("condFlags"))}</div>` +
        area("conditions", "سایر بیماری‌ها", "مثلاً: دیابت نوع ۲") +
        row(sel("onMeds", "آیا در حال حاضر دارو مصرف می‌کنید؟")) + area("medications", "نوع دارو", "مثلاً: آسپرین، وارفارین") +
        row(sel("pregnant", "ویژهٔ خانم‌ها: آیا باردار هستید؟") + sel("miscarriage", "آیا سابقهٔ سقط جنین داشته‌اید؟")))}
    </div>`;
  }

  /* مقدارهای فرم را از صفحه می‌خواند و یک شیء آمادهٔ ذخیره برمی‌گرداند */
  function read(prefix, doc) {
    doc = doc || root.document;
    const box = doc.querySelector(`[data-pfroot="${prefix}"]`); if (!box) return {};
    const o = { insurance: {}, referral: [], allergyFlags: [], condFlags: [] };
    box.querySelectorAll("[data-pf]").forEach(el => {
      const k = el.dataset.pf;
      if (el.type === "checkbox") { if (el.checked) o[k].push(el.dataset.opt); return; }
      let v = String(el.value || "").trim();
      if (el.dataset.yn) { o[k] = v === "yes" ? true : v === "no" ? false : null; return; }
      if (k.startsWith("ins.")) { const kk = k.slice(4); o.insurance[kk] = kk === "cap" ? (v ? Math.max(0, Math.floor(+en(v))) || null : null) : (v || null); return; }
      if (k === "nationalId") v = en(v).replace(/\D/g, "");
      if (k === "birthYear") { v = en(v).replace(/\D/g, ""); o[k] = v ? +v : null; return; }
      if (k === "age") { o[k] = v ? Math.max(0, Math.min(120, Math.floor(+en(v)))) : null; return; }
      o[k] = v || null;
    });
    return derive(o);
  }
  /* سال تولد، اگر نوشته شده باشد، سن را حساب می‌کند */
  function derive(o, now) { const a = o.birthYear ? ageFromBirth(o.birthYear, now) : null; if (a != null) o.age = a; return o; }

  /* ---------- نمایش ---------- */
  function lines(p) {
    const ins = p.insurance || {}, L = [];
    const add = (lab, v) => { if (v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && !v.length)) L.push([lab, v]); };
    add("شمارهٔ پرونده", p.fileNo); add("کد ملی", p.nationalId); add("نام پدر", p.fatherName);
    add("سال تولد", p.birthYear ? fa(p.birthYear) : ""); add("سن", p.age ? fa(p.age) : ""); add("شغل", p.job); add("نشانی", p.address);
    add("تلفن همراه", p.phone); add("تلفن ثابت", p.phoneHome); add("تلفن اضطراری", p.phoneEmerg);
    add("آشنایی با کلینیک", arr(p.referral).map(k => label(REFERRAL, k)).join("؛ "));
    add("بیمهٔ پایه", ins.name); add("بیمهٔ مکمل", ins.supplementary); add("شمارهٔ بیمه", ins.number); add("اعتبار معرفی‌نامه", ins.letterExpiry);
    add("فرانشیز", ins.franchise); add("سقف بیمه", ins.cap ? fa(ins.cap) + " تومان" : ""); add("OPG (بیمه)", ins.opg);
    add("بیماری‌ها", condText(p)); add("در حال مصرف دارو", yn(p.onMeds)); add("داروهای مصرفی", p.medications);
    add("باردار", yn(p.pregnant)); add("سابقهٔ سقط", yn(p.miscarriage));
    return L;
  }
  function view(p) {
    const L = lines(p), a = allergyText(p);
    return `<div style="margin:8px 0;font-size:.92rem">${L.length ? L.map(([l, v]) => `<div style="margin-top:2px"><strong>${l}: </strong>${esc(v)}</div>`).join("") : '<p class="note">اطلاعاتی ثبت نشده.</p>'}</div>` +
      (a ? `<p class="warn" style="margin-top:6px"><strong>⚠ حساسیت: </strong>${esc(a)}</p>` : "");
  }

  /* ---------- PDF و چاپ ---------- */
  const CONSENT = [
    "اینجانب ........................ رضایت شخصی و کامل خود را نسبت به پرداخت هزینهٔ مابه‌التفاوت درمان اعلام می‌دارم.",
    "اینجانب، ضمن تأیید مندرجات فوق و پاسخ دقیق به سؤالات مطرح‌شده، از درمان‌هایی که روی دهان و دندان‌هایم انجام می‌گیرد و همچنین طرح پیشنهادی که بر اساس اصول و مبانی علمی و مراجع معتبر دندانپزشکی انجام خواهد شد اطلاع کافی دارم. نتایج حاصل از درمان توسط دندانپزشک معالج کاملاً توضیح داده شده است. بدین‌وسیله رضایت کامل خود را نسبت به انجام آن و پرداخت هزینه‌های درمانی بر اساس تعرفه‌های درمانی کلینیک اعلام می‌نمایم."
  ];
  function pdf(p) {
    const L = lines(p), a = allergyText(p);
    const grid = L.length ? `<table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:10px"><tbody>${L.map(([l, v]) => `<tr><td style="border:1px solid #bbb;padding:4px 6px;background:#f3f3f3;width:150px;font-weight:700">${l}</td><td style="border:1px solid #bbb;padding:4px 6px">${esc(v)}</td></tr>`).join("")}</tbody></table>` : "";
    return (a ? `<div style="border:2px solid #b3261e;background:#fcecea;color:#b3261e;border-radius:6px;padding:8px 10px;margin-bottom:10px;font-weight:700">⚠ حساسیت: ${esc(a)}</div>` : "") + grid;
  }
  function consent() {
    const sig = `<div style="display:flex;justify-content:space-between;margin-top:22px;font-size:12px"><span>نام و نام خانوادگی: ....................</span><span>تاریخ: ............</span><span>امضا:</span></div>`;
    return `<div style="margin-top:16px;page-break-inside:avoid"><strong style="font-size:14px">رضایت‌نامه</strong>${CONSENT.map(t => `<p style="font-size:12px;line-height:1.9;margin:8px 0">${t}</p>${sig}`).join("")}</div>`;
  }

  root.PF = { fields, read, derive, view, pdf, consent, allergyText, condText, ageFromBirth, persianYear, lines, CONSENT, REFERRAL, ALLERGY, COND };
})(typeof globalThis !== "undefined" ? globalThis : this);
