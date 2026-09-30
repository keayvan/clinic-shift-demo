# GitHub Push برای Clinic Shift Demo

برای push کردن کدِ پروژه به GitHub، دستورات زیر را اجرا کنید:

## ۱. Repository شخصی خود را در GitHub بسازید
اگر هنوز repository نساخته‌اید:
- گیت‌هاب.کام را باز کنید
- روی "+" سمت بالا کلیک کنید
- "New repository" را انتخاب کنید
- نام: `clinic-shift-demo`
- **برای محرمانه بودن:**  "Private" را انتخاب کنید
- "Create repository" را کلیک کنید

## ۲. Push کردن کد

```bash
cd /home/k1/clinic-shift-demo

# اگر GitHub account را setup نکرده‌اید:
# git config --global user.name "Your Name"
# git config --global user.email "your@email.com"

# Repository remote را اضافه کنید (URL را جایگزین کنید):
git remote add origin https://github.com/YOUR_USERNAME/clinic-shift-demo.git

# یا اگر repository قبلاً remote دارد:
# git remote set-url origin https://github.com/YOUR_USERNAME/clinic-shift-demo.git

# Branch را به main تغییر دهید:
git branch -M main

# Push کنید:
git push -u origin main
```

## ۳. بعدی‌ها

هر دفعه که نسخهٔ جدید ساخته می‌شود:
```bash
cd /home/k1/clinic-shift-demo
git add -A
git commit -m "نسخهٔ X.Y.Z: توضیح تغییرات"
git push
```

## ۴. اطلاع‌رسانی در اپ

وقتی version در این فایل‌ها بالا برود، کاربران خودکار می‌بینند:
- `public/sw.js` (SERVICE_WORKER version)
- `public/platform.js` (APP_VERSION)
- `package.json` (version)

بنر "نسخهٔ جدید آماده است" نمایش داده می‌شود و کاربران می‌توانند با دکمهٔ "به‌روزرسانی" به نسخهٔ جدید برگردند.

---

**نکته امنیتی:** اگر اطلاعات کلینیک‌تان را repository میں قرار می‌دهید:
- ✓ Repository را **Private** نگه دارید
- ✓ Sensitive اطلاعات (passwords، API keys) را از کد حذف کنید
- ✓ `.gitignore` را بررسی کنید تا file‌های حساس commit نشوند
