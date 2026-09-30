# شیفت کلینیک — راهنمای Claude Code

## پروژه
دمو PWA برنامه‌ریزی شیفت کلینیک دندانپزشکی برای استفاده داخل ایران.
کاربر نهایی مدیر یک کلینیک دندانپزشکی با ۲۳ کارمند است.

## محدودیت‌های سخت
- **هیچ سرویس خارجی اضافه نشود:** نه API، نه CDN خارجی (گوگل، cdnjs، unpkg)، نه مدل زبانی آنلاین. همه‌چیز باید آفلاین کار کند.
- رابط کاربری فارسی و RTL است. متن‌های جدید فارسی باشند.
- وابستگی جدید به `package.json` اضافه نشود؛ سرور باید بدون `npm install` اجرا شود.

## ساختار فایل‌ها
```
server.js          سرور Node (بدون وابستگی): static + /api/feedback + /admin
public/nlu.js      موتور فهم متن فارسی (قاعده‌محور، بدون شبکه)
public/platform.js ذخیره محلی (LDB)، seed داده، بازخورد (FB)، shell نصب (Shell)
public/app.js      منطق اصلی اپ: شیفت‌چینی، قوانین، درخواست‌ها، UI
public/styles.css  استایل‌ها (RTL، dark mode، PWA)
public/sw.js       service worker: کش آفلاین + اعلام نسخه جدید
public/index.html  پوسته HTML
public/manifest.webmanifest, icons/  تنظیمات نصب اپ
public/vendor/     html2pdf و SheetJS (همراه مجوز)
public/fonts/      فونت وزیرمتن (SIL OFL)
tests/nlu.test.js  تست جمله‌های فارسی
scripts/bump.js    بالا بردن نسخه + changelog
```

## قوانین کار
1. قبل از هر تغییر در `nlu.js`، جمله مربوط را به `tests/nlu.test.js` اضافه کن و `npm test` بزن.
2. بعد از هر تغییر قابل توجه: `npm test` و بعد سرور را تست کن.
3. هر انتشار با `node scripts/bump.js X.Y.Z "توضیح فارسی تغییر"` انجام شود.
4. فایل‌های `public/vendor/` و `public/fonts/` را تغییر نده.
5. `ADMIN_PASSWORD` هرگز در کد یا git نماند؛ از متغیر محیطی بخوان.

## اجرا
```bash
npm test                          # تست موتور NLU
ADMIN_PASSWORD=test PORT=3000 node server.js   # سرور
```
داشبورد: http://localhost:3000/admin (user: dev, pass: test)

## بعدی‌ها (اولویت‌بندی‌شده)
1. انتشار روی هاست ایرانی (لیارا) برای تست روی گوشی مدیر
2. بهبود موتور NLU بر اساس بازخوردهای داشبورد
3. نسخه واقعی: دیتابیس مشترک + ورود پیامکی + اطلاع‌رسانی پیامکی
