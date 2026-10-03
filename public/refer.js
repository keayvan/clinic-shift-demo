/* ارجاع: مدیر مشخص می‌کند هر سفارش لابراتوار یا هر پروندهٔ ایمپلنت را چه کسانی ببینند.
   REF.open(عنوان، شناسه‌های فعلی، ذخیره) برگهٔ کوچکی با فهرست افراد (عنوان گروه‌ها پررنگ) و تیک باز می‌کند. */
const REF = (() => {
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const GROUPS = [["doctor", "دکترها"], ["assistant", "دستیارها"], ["reception", "منشی‌ها"], ["insurance", "مسئول بیمه"], ["lab", "لابراتوار"]];
  const names = ids => (ids || []).map(id => (byId(id) ? byId(id).name : "")).filter(Boolean).join("، ") || "—";
  function open(title, current, onSave, opts = {}) {
    const ex = new Set(opts.exclude || []), cur = new Set(current || []);
    const body = GROUPS.filter(([r]) => !ex.has(r)).map(([r, t]) => {
      const rows = ofRole(r); if (!rows.length) return "";
      return `<div class="cathead" style="margin-top:12px">${t}</div>` + rows.map(s => `<label class="row" style="gap:8px;align-items:center;padding:4px 6px"><input type="checkbox" data-refid="${s.id}" ${cur.has(s.id) ? "checked" : ""}><span>${esc(s.name)}</span></label>`).join("");
    }).join("");
    Shell.sheet(`<h2>${esc(title)}</h2><p class="note" style="margin:0 0 4px">فقط کسانی که اینجا تیک بزنی (و مدیر${opts.always ? " و " + opts.always : ""}) این مورد را می‌بینند.</p>${body}
      <div class="row" style="margin-top:14px"><button class="btn primary" id="refSave">ذخیره</button><button class="btn quiet" data-close-sheet>انصراف</button></div>`, root => {
      root.querySelector("#refSave").onclick = async e => {
        e.target.disabled = true;
        const ids = [...root.querySelectorAll("[data-refid]")].filter(x => x.checked).map(x => x.dataset.refid);
        try { await onSave(ids); } finally { Shell.close(); }
      };
    });
  }
  return { open, names };
})();
if (typeof globalThis !== "undefined") globalThis.REF = REF;
