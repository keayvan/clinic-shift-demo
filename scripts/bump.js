// Usage: node scripts/bump.js 0.2.0 "تغییر اول" "تغییر دوم"
// Updates the version everywhere and adds a changelog entry shown to users after the update.
const fs = require("fs"), path = require("path");
const [v, ...changes] = process.argv.slice(2);
if (!/^\d+\.\d+\.\d+$/.test(v || "")) { console.error("version like 0.2.0 required"); process.exit(1); }
const root = path.join(__dirname, "..");
const rep = (f, re, to) => { const p = path.join(root, f); fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace(re, to)); };
rep("public/platform.js", /const APP_VERSION = "[^"]+"/, `const APP_VERSION = "${v}"`);
rep("public/sw.js", /const VERSION = "[^"]+"/, `const VERSION = "${v}"`);
rep("package.json", /"version": "[^"]+"/, `"version": "${v}"`);
const cl = path.join(root, "public/changelog.json"), list = JSON.parse(fs.readFileSync(cl, "utf8"));
list.unshift({ version: v, changes: changes.length ? changes : ["بهبودهای جزئی"] });
fs.writeFileSync(cl, JSON.stringify(list, null, 2) + "\n");
console.log("bumped to", v);
