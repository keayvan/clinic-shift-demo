// Run: node tests/patform.test.js  — فرم پروندهٔ بیمار (public/patform.js)
require("../public/patform.js");
const { PF } = globalThis;
let pass = 0, fail = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  if (!ok) console.log("✗", name, "\n   got :", JSON.stringify(got), "\n   want:", JSON.stringify(want));
}
const has = (name, s, sub) => eq(name, String(s).includes(sub), true);
const hasNot = (name, s, sub) => eq(name, String(s).includes(sub), false);

// سن از سال تولد
eq("age from birth year", PF.ageFromBirth(1370, 1405), 35);
eq("birth year in future", PF.ageFromBirth(1500, 1405), null);
eq("derive sets age", PF.derive({ birthYear: 1380 }, 1405).age, 25);
eq("derive keeps typed age when no birth year", PF.derive({ age: 40 }, 1405).age, 40);

// حساسیت و بیماری: ترکیب گزینه‌ها با متن آزاد
eq("allergy flags + text", PF.allergyText({ allergyFlags: ["painkiller", "food"], allergies: "لاتکس" }), "مسکن‌ها؛ غذای خاص؛ لاتکس");
eq("allergy only text (old record)", PF.allergyText({ allergies: "پنی‌سیلین" }), "پنی‌سیلین");
eq("allergy none", PF.allergyText({ name: "x" }), "");
eq("cond flags + text", PF.condText({ condFlags: ["diabetes", "hypertension"], conditions: "سابقهٔ سکته" }), "دیابت؛ فشارخون بالا؛ سابقهٔ سکته");

// پروندهٔ قدیمی (فقط فیلدهای قبلی) بدون خطا نمایش داده می‌شود
const old = { name: "الف", age: 30, nationalId: "0012345678", phone: "0912", conditions: "دیابت", medications: "متفورمین", allergies: "پنی‌سیلین", insurance: { name: "تامین", number: "123", cap: 5000000 } };
has("old record view: nid", PF.view(old), "0012345678");
has("old record view: insurance cap", PF.view(old), "۵۰۰۰۰۰۰ تومان");
has("old record view: allergy warn", PF.view(old), "⚠ حساسیت");
has("old record pdf", PF.pdf(old), "پنی‌سیلین");
eq("empty record view has note", PF.view({ name: "ب" }).includes("اطلاعاتی ثبت نشده"), true);

// فیلدهای تازهٔ فرم کاغذی
const nw = { fileNo: "A-17", fatherName: "علی", birthYear: 1370, age: 35, job: "معلم", address: "تهران", phoneHome: "021", phoneEmerg: "0935",
  referral: ["instagram", "friends"], insurance: { name: "تامین", supplementary: "دی", letterExpiry: "۱۴۰۵/۰۷/۳۰", franchise: "۱۰٪", cap: 1000000, opg: "پوشش دارد" },
  allergyFlags: ["antibiotic"], condFlags: ["cardio"], onMeds: true, medications: "آسپرین", pregnant: false, miscarriage: true };
const v = PF.view(nw);
for (const s of ["A-17", "علی", "معلم", "اینستاگرام؛" , "دی", "۱۴۰۵/۰۷/۳۰", "۱۰٪", "پوشش دارد", "بیماری‌های قلبی و عروقی", "آسپرین"]) has("new view: " + s, v, s);
has("on meds yes", v, "در حال مصرف دارو: </strong>بله");
has("pregnant no", v, "باردار: </strong>خیر");
has("miscarriage yes", v, "سابقهٔ سقط: </strong>بله");

// XSS: متن کاربر escape می‌شود
const evil = PF.view({ fatherName: '<img src=x onerror=alert(1)>', allergies: "<b>" });
hasNot("xss view", evil, "<img");
hasNot("xss pdf", PF.pdf({ fatherName: "<script>", allergies: "<script>" }), "<script>");

// فرم: همهٔ کلیدها هست و مقدار پیش‌نویس جای مقدار پرونده می‌نشیند
const f = PF.fields("e", nw);
for (const k of ["fileNo", "nationalId", "fatherName", "birthYear", "age", "job", "address", "phone", "phoneHome", "phoneEmerg", "ins.name", "ins.supplementary", "ins.number", "ins.letterExpiry", "ins.franchise", "ins.cap", "ins.opg", "allergies", "conditions", "medications", "onMeds", "pregnant", "miscarriage"])
  has("form key " + k, f, `data-pf="${k}"`);
eq("form checkbox count", (f.match(/type="checkbox"/g) || []).length, PF.REFERRAL.length + PF.ALLERGY.length + PF.COND.length);
has("form value from record", f, 'value="A-17"');
has("referral checked", f, 'data-opt="instagram" checked');
has("draft overrides record", PF.fields("i", nw, { fileNo: "Z-9" }), 'value="Z-9"');
hasNot("draft fully replaces", PF.fields("i", nw, { fileNo: "Z-9" }), 'value="A-17"');
has("select yes", f, '<option value="yes" selected>');
has("consent has signature", PF.consent(), "امضا");
eq("consent paragraphs", PF.CONSENT.length, 2);


// گروه‌های نمایش و اطلاعات آزمایشی
{
  const g = PF.viewGroups({ name: "الف", plan: [], fileNo: "12", insurance: { name: "رازی" }, onMeds: true, medications: "آسپرین" });
  eq("view groups keys", g.map(x => x.key), ["info", "ins", "med"]);
  has("info group has file no", g[0].html, "شمارهٔ پرونده");
  has("ins group has insurer", g[1].html, "رازی");
  has("med group has meds", g[2].html, "آسپرین");
  const d = PF.demo({ name: "ب", nationalId: "0012345678", insurance: { name: "رازی", cap: 1 } }, () => 0.5);
  eq("demo keeps existing id", d.nationalId, "0012345678");
  eq("demo keeps existing insurer", d.insurance.name, "رازی");
  eq("demo keeps existing cap", d.insurance.cap, 1);
  eq("demo fills file no", typeof d.fileNo, "string");
  eq("demo national id length kept", d.nationalId.length, 10);
  eq("demo fills age from birth year", d.age, PF.ageFromBirth(d.birthYear));
  const d2 = PF.demo({ name: "پ", plan: [] }, () => 0.1);
  eq("demo phone format", /^09\d{9}$/.test(d2.phone), true);
  eq("demo national id 10 digits", /^\d{10}$/.test(d2.nationalId), true);
  const d3 = PF.demo(d2, () => 0.9);
  eq("demo is idempotent on filled fields", [d3.fileNo, d3.phone, d3.nationalId], [d2.fileNo, d2.phone, d2.nationalId]);
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
