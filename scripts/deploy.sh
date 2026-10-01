#!/usr/bin/env bash
# انتشار نسخهٔ commit‌شده روی alwaysdata. اطلاعات و بازخوردها در ~/clinic-data هستند و دست نمی‌خورند.
# اگر server.js تغییر کرده، بعدش سایت را از پنل alwaysdata (Sites ← 🔄) ری‌استارت کن.
set -euo pipefail
cd "$(dirname "$0")/.."
HOST=clinic-shift@ssh-clinic-shift.alwaysdata.net
KEY=~/.ssh/alwaysdata_clinic
[ -z "$(git status --porcelain -- public server.js)" ] || { echo "اول تغییرها را commit کن."; exit 1; }
git archive --format=tar HEAD | ssh -i "$KEY" -o BatchMode=yes "$HOST" \
  'rm -rf ~/clinic-shift-demo.new && mkdir ~/clinic-shift-demo.new && tar -x -C ~/clinic-shift-demo.new && rm -rf ~/clinic-shift-demo.old && { [ ! -d ~/clinic-shift-demo ] || mv ~/clinic-shift-demo ~/clinic-shift-demo.old; } && mv ~/clinic-shift-demo.new ~/clinic-shift-demo'
V=$(grep -o '"[0-9.]*"' public/sw.js | head -1)
LIVE=$(curl -s -m 30 https://clinic-shift.alwaysdata.net/sw.js | grep -o '"[0-9.]*"' | head -1)
echo "نسخهٔ محلی $V — نسخهٔ روی سایت $LIVE"
[ "$V" = "$LIVE" ]
