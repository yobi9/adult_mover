# Implementation Plan - Adult Media Mover

خطة تنفيذ من إعداد المشروع حتى الاختبار والبناء النهائي. كل مرحلة تنتهي بـ **تحقق** (typecheck + اختبارات) و**تصحيح** قبل الانتقال للتالية.

التحقق القياسي بكل مرحلة: `npm run typecheck` ثم `npm test`.

> **ملاحظة تحديث (سلسلة 0.2):** خطة 0.1.0 أدناه نُفّذت بالكامل (التحقق في كل
> مرحلة). منذ **0.2.0** تحول التطبيق إلى معمارية **Scan-First** (فحص وتصنيف
> يليهما تنفيذ منفصل) — التفاصيل في قسم «تحديث سلسلة 0.2» أسفل هذا الملف
> وفي `Architecture.md` (الأقسام 16–17).

---

## المرحلة 0 — التحليل والتخطيط (تمت الآن)

- [x] قراءة Requirements.md وتحليله.
- [x] توثيق التعارضات/الغموض/النواقص (في قسم 14 من Architecture.md).
- [x] قرار التقنية: Node.js + Electron + TypeScript (التبرير في Architecture.md).
- [x] ملف Architecture.md.
- [x] ملف ImplementationPlan.md.
- [x] هيكل المشروع الأساسي (المجلدات + package.json + tsconfig + .gitignore + git init + electron-builder.yml).
- ✅ **تحقق**: الملفات موجودة، `node/npm` يعملان، البنية المتفق عليها واضحة.

---

## المرحلة 1 — إعداد المشروع وتثبيت التبعيات

مهام:
- `git init` (مؤكد — موجود أصلاً)؛ إنشاء `.gitignore` شامل (node_modules, dist, test-data, *.local, مفاتيح).
- إنشاء `package.json` بالscripts والعمل النهائي.
- إضافة التبعيات التطويرية: `electron`, `electron-builder`, `typescript`, `tsx` (تبعيات تشغيل صفرية — fetch مدمج).
- إعداد `tsconfig.json` (strict) و `tsconfig.test.json` (يشمل tests للـ typecheck).
- إعداد `electron-builder.yml`.
- **تحقق**: `npm install` ينجح، `npm run typecheck` يمرّ على مصدر فارغ/أول ملف، `node --import tsx --test` يعمل مع اختبار Smoketest واحد.

---

## المرحلة 2 — MediaParser (استخراج الاسم والسنة والنوع)

مهام:
- `source/core/media-parser/tokens.ts`: قواميس العناصر التقنية (القرارات 720p/1080p/2160p/4K، المصادر WEB/WEB-DL/WEBRip/BluRay/BDRip/BRRip/HDTV/HDRip/DVDRip/REMUX، الترميز HEVC/H264/H265/x264/x265، الصوت AAC/AC3/DTS/DDP، الموسم/الحلقة S01/S01E01).
- `source/core/media-parser/parser.ts`:
  - تطبيع الأسماء (نقاط → مسافات، trim).
  - إزالة العناصر التقنية دون كسر أسماء حقيقية (مثل أفلام تحمل كلمة عامة).
  - استخراج السنة `(19|20)\d{2}`.
  - استخراج Season/Episode → `isSeriesHint`.
  - دالة `parseMediaName(folderName)` ترجع `{ title, year, season, isSeriesHint }`.
- اختبارات `tests/media-parser.test.ts`: حالات من البند 12 و 13 (Breaking.Bad.S05, The.Matrix.1999, Game.of.Thrones.Season.01, Movie.Name.2024, عربية، مختلطة).
- توثيق Docstring لكل دالة عامة (البند 44).
- ✅ **تحقق**: typecheck + الاختبارات.

---

## المرحلة 3 — Ratings (تطبيع التصنيف والتصنيفات المستهدفة)

مهام:
- `normalization.ts`: `normalizeRating(input)` — trim + lowercase + توحيد أشكال (`tv-ma`, `TV-MA`, ` TV-MA`, وحدات فرعية مثل `18+`/`18`/`adult`).
- `targets.ts`: القائمة `TV-MA, R, NC-17, X, 18+, ADULT, 18` + `isTargetRating(rating)` و `classifyDecision(rating)`.
- قرار أمني: لا «adult» من اسم المجلد إطلاقاً (البند 21).
- اختبارات `tests/ratings.test.ts` — تطبيع + تحديد هدف + حالات غير مستهدفة (PG-13, PG, TV-14…).
- ✅ **تحقق**: typecheck + اختبارات.

---

## المرحلة 4 — TMDB Client + Search Ranking + getMediaRating

مهام:
- `source/core/tmdb/client.ts`:
  - `fetch` مستبدل بحقن (Dependency Injection) لتسهيل Mock.
  - Limiter عالمي (≥400ms بين الطلبات).
  - Retry/Backoff محدود (1s → 2s → 4s ثم توقف) على 429/5xx/timeout/connection.
  - تصنيف أخطاء: AuthError(401/403) | RateLimit(429) | NotFound(404) | ServerError | NetworkError.
  - إخفاء المفتاح في أي استثناء.
- `search.ts`: `searchTV(name, year)` و `searchMovie(name, year)` تستدعيان `/search/tv` و `/search/movie` وتحصران الحقول المطلوبة.
- `ranking.ts`: `scoreCandidate(query, year, candidate)` → تطابق الاسم (تطبيع/يساوى) + السنة + تشابه نصي (مثل bigrams) + ترتيب TMDB؛ و `pickBest(candidates, query, year)` مع عتبة ثقة منخفضة → `null`.
- `media-rating.ts`: `getMediaRating(name, year, apiKey)` — TV أولاً ثم Movie (البند 17-19)، ثم `/tv/{id}/content_ratings` (US أولاً ثم بديل مع تسجيل) أو `/movie/{id}/release_dates` (US certification)، وينتهي بـ `{ rating, mediaType, tmdbId, confidence, state }`.
- اختبارات `tests/tmdb.test.ts` (Mock fetch بالكامل): نجاح، TV→Movie fallback، 401 يوقف، 429 backoff ثم SKIP، 404، 5xx، استجابة تالفة → fail closed، سنة تُمرَّر، US غير موجودة → بديل مسجل.
- اختبارات `tests/ranking.test.ts`.
- ✅ **تحقق**: نوع الاختبار + مكدش؛ يُرفض أي اعتماد على الإنترنت في الاختبارات (البند 40).

---

## المرحلة 5 — FileManager (Scannner + PathGuard + Mover)

مهام:
- `files/types.ts`: امتدادات فيديو + `isVideoFile(name)` (غير حساس للحالة) + `fileHasVideoChildren(dir)`.
- `path-guard.ts`: `isSamePath(a,b)`، `isPathInside(inner, outer)`، `isUnsafeSourceDestination(source, dest)`:
  - الوجهة نفسها = مصدر → منع.
  - المصدر داخل الوجهة أو الوجهة داخل المصدر → منع (البند 31).
  - تطبيع المسارات و UNC-آمنة (لا افتراض Drive، توحيد حالة الأحرف، أشرطة).
- `scanner.ts`: `scanSource(sourcePath, recursive)` يرجع قائمة مجلدات مرشّح «مجلد المحتوى» (يحتوي فيديو مباشرةً). عند recursive غادر درجة أعمق؛ وعند اكتشاف مجلد محتوى لا يُدخل إلى داخله.
- `mover.ts`:
  - فحوصات قبل النقل (البند 36): مصدر موجود ومجلد، وجهة متاحة، أمان المسار، اسم فريد.
  - `uniqueTargetPath(dest, name)` → `Name`, `Name_1`, …
  - نقل Same-Volume عبر `fs.promises.rename`.
  - **Cross-Volume**: لا تنفيذ تلقائي (Copy→Verify→Delete محظور افتراضياً). يُسجل السبب ويُرفض الوضع كـ «غير قابل للنقل تلقائياً». لا إزالة للمصدر إطلاقاً في هذه النسخة.
  - لا حذف صامت؛ لا استبدال موجود.
- اختبارات:
  - `path-guard.test.ts`: UNC وهمية، تطابق/تداخل.
  - `mover.test.ts`: تسمية فريدة، مجلد موجود، مسار غير صالح، فشل محاكى لا يكسر المصدر.
  - `scanner.test.ts`: حالات فيديو/لا فيديو/متكرر/حدود.
- ✅ **تحقق**: بقاء كل الاختبارات على `mkdtemp` بلا لمس ملفات مستخدم.

---

## المرحلة 6 — Pipeline (الحلقة + Stop + Stats + Logger)

مهام:
- `pipeline/decision.ts`: `Decision = { outcome: 'MOVE'|'SKIP'|'ERROR', reason, details? }` + `JobResult`.
- `stop.ts`: علامة ذرية `isStopping()`/`requestStop()` — موجّهة بين المجلدات وبين الملفات أثناء النقل.
- `stats.ts`: processed / moved / skipped / errors + مصادر.
- `logging/logger.ts`: حلقة دائرية للواجهة + ملف اختياري متناوب؛ `safeText()` يطهر المفتاح من أي رسالة؛ واجهة `onLog(listener)`.
- `orchestrator.ts`:
  - `runJob({sources, dest, apiKey, recursive, logger, tmdbStub})`.
  - تحضير → فحص المصادر → لكل مجلد: تحليل الاسم ← TMDB (getMediaRating) ← قرار ← (MOVE → نقل) ← updateStats.
  - AuthError → إيقاف الوظيفة وإخبار المستخدم.
  - الإيقاف الآمن: بعد مجلد جارٍ لا يُجدول جديد؛ يجري «تم الإيقاف» مع ملخص.
  - خطأ مجلد → SKIP/ERROR ويكمل.
  - استدعاءات خارجية عبر مصدر TMDB قابل للحقن (حتى تُفسَّد بوحدة Stub).
- اختبارات `pipeline.test.ts`: TMDB Stub + مجلدات `mkdtemp`، تغطية: Movie A/B، Series A/B مع S01E01، Not Media (لا فيديو) → SKIP، عربي، موجود بالوجهة → تسمية فريدة، فشل نقل → لا مساس، إيقاف أثناء الحلقة → يكمل الحالي ثم يتوقف.
- ✅ **تحقق**: دورة كاملة على بيانات مؤقتة بالخضراء.

---

## المرحلة 7 — واجهة المستخدم (Electron Main + IPC + Renderer)

مهام:
- `source/main/main.ts`: نافذة (العرض/الارتفاع، RTL)، تحميل `dist/renderer/index.html`, حماية `contextIsolation`, `nodeIntegration:false`.
- `preload.ts`: كشف API آمن عبر `contextBridge`: `getSources()`, `addSource`, `removeSource(s)`, `clearSources`, `pickDestination`, `setDestination`, `setApiKey`, `setRecursive`, `startJob()`, `requestStop()`, `onLog`, `onStatus`, `onStats`, `onFinished`, `onCloseRequest`…
- `ipc.ts`: معالج IPC يحوّل لأوامر Core ويبثّ أحداث push للـ Renderer.
- Renderer (`index.html`, `styles.css`, `renderer.ts`):
  - أقسام البند 4 (المصادر + الأزرار الثلاثة + منع التكرار، الوجهة + استعراض + إنشاء تلقائي بعد تحقق، مفتاح مخفي `type=password` + خانة «حفظ المفتاح»).
  - أزرار «بدء الفحص والنقل»/«إيقاف» مع تعطيل/تفعيل مناسبة (البند 5).
  - حالة التشغيل Status + إحصائيات مباشرة (البند 29) + Log فوري (البند 27) + ملخص نهائي + حوار إغلاق أثناء التشغيل (البند 37).
  - عربي RTL كامل، والخطوط/الألوان معاصرة.
- ✅ **تحقق**: تشغيل `npm start` (Electron) وينبثق النافذة؛ اختبار يدوي للتفاعلات؛ لا تجمد أثناء مهمة وهمية بأدلة مؤقتة؛ اختبارات Core ما زالت خضراء بلا Electron.

---

## المرحلة 8 — إعدادات دائمة (Config) + وضع Debug

مهام:
- `core/config/store.ts`: حفظ اختياري للإعدادات غير الحساسة (آخر المصادر، الوجهة، تفضيلات الواجهة، recursive) في `%APPDATA%`؛ لا مفتاح إلا بخانة صريحة، وإذا حُفظ ففي JSON بمدارات آمنة مع تحذير في الواجهة.
- ربط إعدادات الواجهة بالـ ConfigStore.
- فحص Debug خلف flag (لا يظهر للمستخدم العادي) يعرض تفاصيل تقنية عند الخطأ (البند 28).
- اختبارات `tests/config.test.ts` (حفظ/قراءة على مجلد مؤقت).
- ✅ **تحقق**: إبقاء المفتاح خارج Log وملفات الاختبار الذهبي.

---

## المرحلة 9 — التكامل والاختبار الميداني الآمن (Sandbox)

مهام:
- Script `scripts/seed-test-data.mjs`: يجرد `test-data/` ببيانات:
  ```
  Movie A (فيديو), Movie B (فيديو), Series A (S01E01), Series B, Not Media (لا فيديو),
  فيلم عربي, مجلد موجود مسبقاً في وجهة التجربة
  ```
  بملفات فيديو **فارغة/صغيرة** (لا محتوى محمي حقوقاً) (البند 41).
- تشغيل Pipeline من وحدة Sandbox (وجهة مؤقتة بأمان) ضد بيانات معدة — لا أي ملف مستخدم.
- اختبارات يدوية: مجلد بلا فيديو، عربي/إنجليزي، موجود بالوجهة، فشل نقل (ملف مقفول)، إيقاف أثناء العمل (يكمل الحالي).
- ✅ **تحقق**: التقارير والسجلات سالئة؛ لا أي مساس خارج `test-data/` و `dist/`.

---

## المرحلة 10 — التوثيق والقراءة (README + أيقونات)

مهام:
- `assets/icon.png` + تحويل إلى `icon.ico` في إعداد electron-builder.
- `README.md` بالأقسام المطلوبة (البند 43): الوظيفة، المتطلبات، التقنية ولماذا، التثبيت، التشغيل، الحصول على TMDB Key، إضافة مصادر، اختيار الوجهة، تشغيل الفحص، الإيقاف، دعم UNC، صلاحيات Windows، بناء EXE/Installer، استكشاف الأخطاء.
- مراجعة Docstrings (البند 44) وجودة الكود (البند 45).
- ✅ **تحقق**: قراءة سريعة للتوثيق ومقارنة كل بند في Requirements.md.

---

## المرحلة 11 — البناء النهائي والمراجعة الكاملة

مهام:
- `npm run build` (tsc + نسخ assets).
- `npm run dist` → NSIS + Portable EXE عبر electron-builder.
- تشغيل قائمة البند 47 الكاملة يدوياً/آلياً (Syntax, deps, imports, build, GUI, threading, API, error handling, file ops, UNC, Unicode, stop, duplicate dest, logging, tests).
- فحص نهائي: لا secrets/keys في المخرجات، لا TODO/Placeholder/Fake responses، الاختبارات كلها خضراء.
- تقرير إغلاق للمستخدم: التقنية، الملفات، التشغيل، البناء، الاختبارات، القيود.

---

## المبادئ الثابتة طول الخطة

1. **Fail Closed** في كل تبديل قصير.
2. **لا حذف ولا إزالة المصدر تلقائياً**: ننقل عبر `fs.rename` على Same-Volume فقط؛ Cross-Volume يُرفض ويُسجل ولن يُحذف المصدر إطلاقاً في هذه النسخة.
3. **لا استبدال وجهة موجودة** — تسمية فريدة دائماً.
4. **لا تجميد UI** — كل العمل في Main Process غير الحاجب.
5. **إيقاف آمن** — يكمل المجلد الحالي ثم يتوقف.
6. **اختبارات TMDB بلا شبكة** (Mock/Stub).
7. **لا Placeholder يبقى** في النسخة النهائية إلا إذا أُنجز بالكامل.
8. **لا اختبارات على ملفات المستخدم** — مجلدات مؤقتة/معدة فقط.
9. **مفتاح API** محمي: إخفاء، لا سجل، لا حفظ إلا بموافقة صريحة.
10. **checkpoint per phase**: typecheck + tests خضراء قبل الانتقال.

---

## تحديث سلسلة 0.2 — الفحص أولاً (Scan-First)

### 0.2.0 (2026-09-09) — Scan-First Architecture
- انقسام العمل إلى مرحلتين منفصلتين بلا لمس القرص أثناء التصنيف:
  - **المرحلة أ**: `runScanPhase` (فحص + تحليل + TMDB + تصنيف) → `ScanSummary`
    + `knownAdult[]` + `unknown[]`. الحدث `scan-complete` يعرض مودال قرار.
  - **المرحلة ب**: `runExecutePhase(mode: move | copy)` تُشغَّل فقط بعد قرار
    المستخدم الصريح (نقل/نسخ/لاحقاً) على عناصر معلقة.
- مخازن دائمة جديدة في `%APPDATA%` بكتابة ذرية `tmp → rename`:
  `unknown-store.ts`, `pending-store.ts`, `copied-store.ts`.
- واجهة جديدة: تبويبات (السجل النشط / قيد الانتظار / غير المعروف / المنسوخ)
  + مودال قرار + أزرار جماعية. بقاء `startJob`/`runScanJob` كتوافق لاختبارات 0.1.0.
- التحقق: اختبارات Phase-C (`Scan/Execute/Integration`) + `typecheck` +
  الاختبارات كلها خضراء (تم في `d86c5c6` وما بعدها).

### 0.2.1 (2026-09-09)
- إصلاح `executePending` fallback إلى `lastScanResult` عند الضغط «نقل/نسخ» فوراً
  بعد اكتمال الفحص وقبل الحفظ — كانت تنتج «فشل النسخ: empty».

### 0.2.2 (2026-09-09)
- معالجة صريحة لأخطاء النسخ: EACCES/ENOENT/ENAMETOOLONG/ENOSPC → رسائل عربية
  محددة السبب + تحسين سجل `verifyCopy`.

### 0.2.3 (2026-09-09)
- فصل «إيقاف المستخدم» عن «الخطأ الحرج» في الواجهة (الشارة والفئهة)؛
  وتحويل EPERM (رفض صلاحيات Windows/ACL) إلى رسالة صلاحية عربية واضحة
  مع إزالة تكرار بادئة أخطاء النسخ.

### حالة السلسلة
- كلها على `master` مع تاجات v0.2.0 → v0.2.3 (وv1.0.0 للسلسلة القديمة 0.1.0).
- الإصدارات المنشورة على GitHub فقط: **v1.0.0** و**v0.2.3** (0.2.0/0.2.1/0.2.2
  مُصلَّحة لاحقاً لذا لا تُنشر — بقرار المستخدم).
- بناء الإصدارات وتوقيعها ورفعها موثق في `CHANGELOG.md`.