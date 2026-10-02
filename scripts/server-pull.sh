#!/usr/bin/env bash
# روی خود سرور alwaysdata اجرا می‌شود (نه روی لپ‌تاپ یا ابر). آخرین نسخهٔ یک شاخه را از GitHub می‌گیرد،
# تست‌ها را اجرا می‌کند و اگر قبول شد جایگزین نسخهٔ فعلی می‌کند. اطلاعات و بازخوردها در ~/clinic-data هستند و دست نمی‌خورند.
# نصب (یک بار، روی سرور):  cp این فایل به ~/server-pull.sh ؛ chmod +x ؛ و در alwaysdata ← Advanced ← Scheduled tasks هر ۵ دقیقه: BRANCH=main ~/server-pull.sh
# اگر server.js عوض شد، فایل ~/RESTART_NEEDED ساخته می‌شود؛ سایت را از پنل alwaysdata (Sites ← 🔄) ری‌استارت کن و فایل را پاک کن.
set -euo pipefail
REPO=keayvan/clinic-shift-demo
BRANCH=${BRANCH:-main}
APP=~/clinic-shift-demo
STATE=~/.deployed-sha
LOG=~/server-pull.log

log() { echo "$(date '+%F %T') $*" >> "$LOG"; }

NEW=$(curl -fsS -m 30 -H "Accept: application/vnd.github.sha" "https://api.github.com/repos/$REPO/commits/$BRANCH") || { log "گرفتن نسخهٔ $BRANCH ممکن نشد"; exit 0; }
[ "${#NEW}" = 40 ] || { log "پاسخ نامعتبر از GitHub"; exit 0; }
[ "$NEW" != "$(cat "$STATE" 2>/dev/null || true)" ] || exit 0

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
curl -fsSL -m 120 "https://codeload.github.com/$REPO/tar.gz/$NEW" | tar -xz -C "$TMP" --strip-components=1
[ -f "$TMP/server.js" ] && [ -f "$TMP/public/sw.js" ] || { log "$NEW: فایل‌های اصلی در بسته نیست؛ جایگزین نشد"; exit 0; }

if ! (cd "$TMP" && node tests/nlu.test.js > "$TMP/test.out" 2>&1); then
  log "$NEW: تست‌ها رد شدند؛ جایگزین نشد ($(tail -n 1 "$TMP/test.out"))"
  echo "$NEW" > "$STATE"   # برای این نسخه دوباره تلاش نکن
  exit 0
fi

if [ -f "$APP/server.js" ] && ! cmp -s "$APP/server.js" "$TMP/server.js"; then touch ~/RESTART_NEEDED; fi
rm -rf "$APP.new" "$APP.old"
mv "$TMP" "$APP.new"; trap - EXIT
[ ! -d "$APP" ] || mv "$APP" "$APP.old"
mv "$APP.new" "$APP"
echo "$NEW" > "$STATE"
log "$NEW ($BRANCH) منتشر شد؛ نسخهٔ $(grep -o '"[0-9.]*"' "$APP/public/sw.js" | head -1)$( [ -f ~/RESTART_NEEDED ] && echo ' — ری‌استارت لازم است')"
