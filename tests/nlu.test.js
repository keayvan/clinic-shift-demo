// Run: node tests/nlu.test.js
require("../public/nlu.js");
const { availability, request, rules, weekly } = globalThis.NLU;
const staff = [
  ["d1", "دکتر احمدی", "doctor"], ["d2", "دکتر رضایی", "doctor"], ["d3", "دکتر کریمی", "doctor"], ["d4", "دکتر موسوی", "doctor"],
  ["d6", "دکتر نوری", "doctor"], ["a1", "مریم", "assistant"], ["a2", "سارا", "assistant"], ["a3", "نگار", "assistant"],
  ["a4", "زهرا", "assistant"], ["a8", "لیلا", "assistant"], ["a11", "سپیده", "assistant"], ["r1", "آزاده", "reception"], ["r2", "شیما", "reception"]
].map(([id, name, role]) => ({ id, name, role }));
const settings = { chairs: 5, receptionPerShift: 2 };

let pass = 0, fail = 0;
const g2s = g => ["sat", "sun", "mon", "tue", "wed", "thu"].map(d => (g[d].m ? "M" : "-") + (g[d].e ? "E" : "-")).join(" ");
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  if (!ok) console.log("✗", name, "\n   got :", JSON.stringify(got), "\n   want:", JSON.stringify(want));
}
const A = (t, want) => eq("avail: " + t, g2s(availability(t).grid), want);

//            sat  sun  mon  tue  wed  thu
A("فقط شیفت عصر کار می‌کنم", "-E -E -E -E -E -E");
A("فقط عصرها میام", "-E -E -E -E -E -E");
A("صبح‌ها هستم", "M- M- M- M- M- M-");
A("شنبه و دوشنبه هستم، سه‌شنبه فقط صبح، پنج‌شنبه نیستم", "ME -- ME M- -- --");
A("هر روز هستم به جز دوشنبه", "ME ME -- ME ME ME");
A("همه روزها میام بجز پنجشنبه", "ME ME ME ME ME --");
A("روزهای زوج هستم", "ME -- ME -- ME --");
A("روزای فرد عصر", "-- -E -- -E -- -E");
A("فقط عصرها، ولی پنج‌شنبه نه", "-E -E -E -E -E --");
A("شنبه صبح هستم دوشنبه عصر", "M- -- -E -- -- --");
A("۵شنبه صبح میام", "-- -- -- -- -- M-");
A("یکشنبه و سه شنبه صبح و عصر", "-- ME -- ME -- --");
A("کل هفته هستم", "ME ME ME ME ME ME");
A("این هفته مرخصی هستم", "-- -- -- -- -- --");
A("شنبه تا چهارشنبه صبح", "M- M- M- M- M- --");
A("یکشنبه تا سه‌شنبه هستم", "-- ME ME ME -- --");
A("سه‌شنبه‌ها عصر میام", "-- -- -- -E -- --");
A("چهارشنبه شاید بیام، شنبه هستم", "ME -- -- -- -- --");
eq("unsure reported", availability("چهارشنبه شاید بیام").unclear.length, 1);
eq("miss reported", availability("سلام خوبی؟ من با دکتر فلانی مشکل دارم").misses.length > 0, true);

// staff requests
eq("req: cancel day", request("سه‌شنبه صبح نمیام", "a2", staff).actions, [{ op: "availability", day: "tue", shift: "m", present: false }]);
eq("req: cancel whole day", request("دوشنبه نمی‌تونم بیام", "a2", staff).actions, [{ op: "availability", day: "mon", shift: null, present: false }]);
eq("req: only evenings", request("از این به بعد فقط عصرها میام", "a2", staff).actions, [{ op: "availability", day: null, shift: "e", present: true }, { op: "availability", day: null, shift: "m", present: false }]);
eq("req: doc unit standing", request("از این به بعد روی یونیت ۲ کار میکنم", "d1", staff).actions, [{ op: "my_units", allowed: [2], preferred: [] }]);
eq("req: doc unit pref", request("ترجیحاً یونیت ۳ ولی ۴ هم میشه", "d1", staff).actions.length >= 1, true);
eq("req: doc unit week", request("دوشنبه میخوام روی یونیت 3 باشم", "d1", staff).actions, [{ op: "week_unit", day: "mon", shift: null, unit: 3 }]);
eq("req: doc assistants", request("از این به بعد با سارا و نگار کار می‌کنم", "d1", staff).actions, [{ op: "my_assistants", assistants: ["a2", "a3"] }]);
eq("req: doc week assistant", request("سه شنبه صبح با مریم کار کنم", "d1", staff).actions, [{ op: "week_assistant", day: "tue", shift: "m", assistant: "a1" }]);

// manager
const M = (t, f = weekly) => f(t, staff, settings);
eq("mgr: fired", M("زهرا اخراج شد").actions, [{ op: "remove_staff", id: "a4" }]);
eq("mgr: no longer works", M("زهرا دیگه اینجا کار نمیکنه").actions, [{ op: "remove_staff", id: "a4" }]);
eq("mgr: resigned", M("دکتر رضایی استعفا داد").actions, [{ op: "remove_staff", id: "d2" }]);
eq("mgr: new assistant", M("رها دستیار جدید ماست").actions, [{ op: "add_staff", name: "رها", role: "assistant", specialty: null }]);
eq("mgr: new doctor", M("دکتر سلیمی متخصص کودکان به ما اضافه شد").actions, [{ op: "add_staff", name: "دکتر سلیمی", role: "doctor", specialty: "کودکان" }]);
eq("mgr: apart", M("مریم و سارا با هم نباشند").actions, [{ op: "add_rule", rule: { type: "not_together", ids: ["a1", "a2"] } }]);
eq("mgr: apart 2", M("لیلا و سپیده نباید با هم تو یه شیفت باشن").actions.length, 1);
eq("mgr: max", M("سپیده حداکثر ۴ شیفت در هفته").actions, [{ op: "add_rule", rule: { type: "max_shifts", id: "a11", n: 4 } }]);
eq("mgr: unit only", M("دکتر احمدی فقط روی یونیت ۲ کار می‌کند").actions, [{ op: "add_rule", rule: { type: "unit_pref", id: "d1", allowed: [2], preferred: null } }]);
eq("mgr: unit pref", M("دکتر کریمی ترجیحاً یونیت 3").actions, [{ op: "add_rule", rule: { type: "unit_pref", id: "d3", allowed: null, preferred: [3] } }]);
eq("mgr: unit multi", M("دکتر رضایی روی یونیت ۲ و ۳ و ۴ کار می‌کند").actions, [{ op: "add_rule", rule: { type: "unit_pref", id: "d2", allowed: [2, 3, 4], preferred: null } }]);
eq("mgr: pairing add", M("سپیده دستیار دکتر کریمی و دکتر موسوی هم باشد").actions, [{ op: "add_to_pairing", doctor: "d3", assistant: "a11" }, { op: "add_to_pairing", doctor: "d4", assistant: "a11" }]);
eq("mgr: pairing only", M("دکتر احمدی فقط با نگار کار می‌کند").actions, [{ op: "set_pairing", doctor: "d1", assistants: ["a3"] }]);
eq("mgr: pairing remove", M("لیلا را از دستیارهای دکتر نوری حذف کن").actions, [{ op: "remove_from_pairing", doctor: "d6", assistant: "a8" }]);
eq("mgr: spec req day", M("هر روز حداقل یک ارتودنتیست باشد").actions, [{ op: "add_rule", rule: { type: "require_specialty", specialty: "ارتودنسی", per: "day", day: null, shift: null, n: 1 } }]);
eq("mgr: spec req shift", M("هر شیفت یک دکتر عمومی لازم است").actions[0].rule.per, "shift");
eq("mgr: set spec", M("تخصص دکتر کریمی ارتودنسی است").actions, [{ op: "set_specialty", id: "d3", specialty: "ارتودنسی" }]);
eq("mgr: ask count total", M("امروز چند نفر تو مجموعه حضور دارن").actions, [{ op: "ask_count", role: null, day: null }]);
eq("mgr: ask count doctors", M("امروز چند دکتر هست").actions, [{ op: "ask_count", role: "doctor", day: null }]);
eq("mgr: ask count reception", M("امروز چند منشی داریم").actions, [{ op: "ask_count", role: "reception", day: null }]);
eq("mgr: ask count assistants", M("چند دستیار امروز حضور دارن").actions, [{ op: "ask_count", role: "assistant", day: null }]);
eq("mgr: chairs", M("ما ۶ یونیت داریم").actions, [{ op: "set_setting", key: "chairs", value: 6 }]);
eq("mgr: reception per shift", M("هر شیفت ۲ منشی لازم است").actions, [{ op: "set_setting", key: "receptionPerShift", value: 2 }]);
eq("mgr: leave this week", M("زهرا سه‌شنبه مرخصی است").actions, [{ op: "block_week", id: "a4", day: "tue", shift: null }]);
eq("mgr: standing block", M("سارا سه‌شنبه‌ها کار نمی‌کند").actions, [{ op: "add_rule", rule: { type: "block", id: "a2", day: "tue", shift: null, temporary: false } }]);
eq("mgr: place doctor", M("دکتر نوری را سه‌شنبه صبح روی یونیت ۲ بگذار").actions, [{ op: "place_doctor", doctor: "d6", day: "tue", shift: "m", unit: 2 }]);
eq("mgr: set assistant", M("زهرا دوشنبه عصر دستیار دکتر کریمی باشد").actions, [{ op: "set_assistant", doctor: "d3", day: "mon", shift: "e", assistant: "a4" }]);
eq("mgr: move unit", M("دکتر احمدی شنبه صبح بره یونیت ۵").actions, [{ op: "set_unit", doctor: "d1", day: "sat", shift: "m", unit: 5 }]);
eq("mgr: reception", M("آزاده را پنج‌شنبه عصر در پذیرش بگذار").actions, [{ op: "add_reception", person: "r1", day: "thu", shift: "e" }]);
eq("mgr: remove from shift", M("سارا را از شنبه صبح بردار").actions, [{ op: "remove", person: "a2", day: "sat", shift: "m" }]);
eq("mgr: rules tab redirect", rules("دکتر نوری را سه‌شنبه صبح روی یونیت ۲ بگذار", staff, settings).rejected.length, 1);
eq("mgr: rules tab block", rules("زهرا این هفته سه شنبه نیست", staff, settings).actions, [{ op: "add_rule", rule: { type: "block", id: "a4", day: "tue", shift: null, temporary: true } }]);
eq("mgr: miss", M("لطفا یه کاری بکن که همه راضی باشن").misses.length, 1);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
