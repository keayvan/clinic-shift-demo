// Run: node tests/lab.test.js  — منطق لابراتوار (public/lab.js)
require("../public/lab.js");
const { nextOf, prevOf, canMoveFor, normalize, STATUS, KINDS } = globalThis.LAB._t;
let pass = 0, fail = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  if (!ok) console.log("✗", name, "\n   got :", JSON.stringify(got), "\n   want:", JSON.stringify(want));
}

// ترتیب مرحله‌ها
eq("steps", STATUS.map(s => s[0]), ["sent", "inlab", "ready", "received", "delivered"]);
eq("next of sent", nextOf("sent"), "inlab");
eq("next of received", nextOf("received"), "delivered");
eq("no next after delivered", nextOf("delivered"), null);
eq("no prev before sent", prevOf("sent"), null);
eq("prev of ready", prevOf("ready"), "inlab");

// چه کسی کدام مرحله را می‌زند
for (const to of ["inlab", "ready"]) {
  eq("lab can " + to, canMoveFor("lab", to), true);
  for (const r of ["doctor", "assistant", "reception", "manager", "insurance", ""]) eq(r + " cannot " + to, canMoveFor(r, to), false);
}
for (const to of ["received", "delivered"]) {
  for (const r of ["doctor", "assistant", "reception", "manager"]) eq(r + " can " + to, canMoveFor(r, to), true);
  for (const r of ["lab", "insurance", ""]) eq(r + " cannot " + to, canMoveFor(r, to), false);
}
eq("nobody moves into sent", canMoveFor("manager", "sent"), false);

// ساخت سفارش: اعتبارسنجی و تمیز کردن ورودی
eq("needs patient", normalize({ doctor: "d1" }, "d1").err, "اسم بیمار را بنویس.");
eq("needs doctor", normalize({ patient: "الف" }, "a1").err, "دکتر را انتخاب کن.");
const ok = normalize({ patient: "  علی  ", doctor: "d1", kind: "روکش", note: " رنگ A2 ", due: "۱۴۰۵/۰۷/۲۵" }, "a1").ok;
eq("trims", [ok.patientName, ok.note, ok.due, ok.kind, ok.createdBy], ["علی", "رنگ A2", "۱۴۰۵/۰۷/۲۵", "روکش", "a1"]);
eq("unknown kind falls back", normalize({ patient: "ب", doctor: "d1", kind: "هر چیزی" }, "d1").ok.kind, KINDS[0]);
eq("empty note is null", normalize({ patient: "ب", doctor: "d1", note: "  " }, "d1").ok.note, null);
eq("long input is cut", normalize({ patient: "x".repeat(500), doctor: "d1", note: "y".repeat(900) }, "d1").ok.patientName.length, 80);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
