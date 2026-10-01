# شیفت کلینیک — آماده برای استقرار 🚀

**نسخهٔ:** ۲.۵.۰  
**تاریخ:** ۳۰ مهرماه ۱۴۰۵  
**وضعیت:** ✅ کامل و تست‌شده

---

## ✅ آنچه آماده است

### ۱. **ماژول شیفت**
- برنامه‌ریزی هفتگی دکترها، دستیارها و منشی‌ها
- درخواست شیفت و تأیید خودکار
- قوانین برای تعداد شیفت، تخصص، یونیت و محدودیت‌ها
- گزارش ماهانه کارکنان

### ۲. **ماژول بیماران**
- ثبت و پذیرش بیماران
- طرح درمان برای هر دندان
- پرداخت‌ها و فاکتور
- اطلاعات پزشکی (آلرژی، داروها، بیماری‌های زمینه‌ای)
- جستجو و فیلتر

### ۳. **ماژول ایمپلنت**
- پرونده ایمپلنت با ۴ ناحیهٔ فک
- قرارداد و اقساط مساوی
- ۴ روش پرداخت (نقد، کارت‌به‌کارت، کارتخوان، چک)
- تأیید مبلغ با ویرگول خودکار
- آپلود OPG
- یادآوری اقساط عقب‌افتاده
- دسترسی کامل/محدود برای کارکنان

### ۴. **ماژول بیمه (Kamran)**
- ثبت بیمه برای بیماران
- گزارش گروه‌بندی‌شده براساس بیمه‌ها
- خروجی Excel

---

## 🏗️ معماری

```
server.js (Node)
  ├─ /api/feedback → ثبت بازخورد
  ├─ /admin → داشبورد توسعه‌دهنده
  └─ /static → فایل‌های public/

public/
  ├─ index.html (PWA shell)
  ├─ sw.js (Service Worker: cache + offline)
  ├─ app.js (منطق اصلی)
  ├─ platform.js (LDB: localStorage store)
  ├─ nlu.js (موتور فهم متن فارسی)
  ├─ implant.js (ماژول ایمپلنت)
  └─ styles.css (RTL + dark mode)

localStorage (LDB):
  ├─ clinic/config (تنظیمات کلینیک)
  ├─ avail/* (حضور کارکنان)
  ├─ clinic/schedule (برنامه هفتگی)
  ├─ patients/* (پرونده‌های بیماران)
  ├─ implants/* (پرونده‌های ایمپلنت)
  └─ ...

IndexedDB (clinicdemo-files):
  └─ opg/* (تصاویر OPG ایمپلنت)
```

---

## 🔐 امنیت

- ✅ **هیچ سرویس خارجی وصل نیست**
- ✅ **همهٔ داده‌ها محلی** (localStorage + IndexedDB)
- ✅ **آفلاین‌کار کامل** (بعد از بار اول)
- ✅ **رمزگذاری ندارد** ← نیاز است اگر در بیرون استقرار شود
- ✅ **ADMIN_PASSWORD** از env variable خوانده می‌شود

### برای استقرار در لیارا (یا هر server ایرانی):

```bash
# فقط اجرا کنید:
ADMIN_PASSWORD=your-strong-password node server.js

# یا با Docker:
docker run -e ADMIN_PASSWORD=... -p 3000:3000 ...
```

---

## 📱 PWA (نصب روی گوشی)

**اندروید:**
1. Chrome: Menu → Install app
2. یا: Add to Home Screen

**آیفون:**
1. Safari: Share → Add to Home Screen

بعد از نصب: بدون اینترنت هم کار می‌کند! 📴

---

## 🔄 Update Notification

وقتی نسخهٔ جدید منتشر شود:
1. Version در `public/sw.js` بالا رفته‌ایم
2. کاربر می‌بیند: "نسخهٔ جدید آماده است"
3. دکمهٔ "به‌روزرسانی" کلیک می‌کند
4. نسخهٔ جدید بارگذاری می‌شود

---

## 📊 نسخه‌های موجود

- **۲.۵.۰**: هر ۴ ماژول کامل + بیمه
- **۲.۴.۰**: ایمپلنت اضافه شد
- **۲.۳.۱**: نسخهٔ اول (شیفت + بیماران)

---

## 🚀 برای استقرار روی لیارا

### ۱. Repository را ساخت کنید
- GitHub: private repository
- URL: `https://github.com/YOUR_USERNAME/clinic-shift-demo.git`

### ۲. Push کنید
```bash
cd /home/k1/clinic-shift-demo
git remote add origin https://github.com/YOUR_USERNAME/clinic-shift-demo.git
git branch -M main
git push -u origin main
```

### ۳. در لیارا
```bash
# لیارا CLI:
lara login
lara up

# یا استفاده از liara.json و GitHub integration
```

### ۴. Environment Variables
```
ADMIN_PASSWORD=your-strong-password
CLINIC_PASSWORD=رمز-کلینیک   # برای دیتابیس مشترک؛ گوشی‌ها با همین رمز وصل می‌شوند
NODE_ENV=production
PORT=3000
```

---

## ✅ Checklist استقرار

- [ ] GitHub repository ساخته شد (Private)
- [ ] تمام کد push شده است
- [ ] Node.js ۱۸+ روی سرور نصب است
- [ ] ADMIN_PASSWORD set شده است
- [ ] CLINIC_PASSWORD set شده است (دیتابیس مشترک در DATA_DIR/db.json روی دیسک feedback-data)
- [ ] Port ۳۰۰۰ (یا دیگری) در دسترس است
- [ ] HTTPS فعال شده است (برای PWA)
- [ ] مرورگر آخرین نسخه است

---

## 📞 پشتیبانی

برای مشکل‌ها:
1. Dashboard: `/admin` (user: dev, pass: ADMIN_PASSWORD)
2. Feedback: دکمهٔ "نظر" در اپ
3. Logs: `stdout` سرور Node

---

**حالا آماده برای استقرار هستید!** 🎉
