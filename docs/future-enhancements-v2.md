# تقرير تصميم التحسينات المستقبلية — Revision 2 (Scan-First Architecture)

> **حالة التنفيذ:** تصميم ومراجعة فقط — لم يُكتب كود، لم يُعدَّل ملف، لم تُنشأ ملفات، لم يُنفَّذ commit/push.
> **القرار الحاكم الجديد (إلزامي):** لا Toggle نقل/نسخ قبل البدء. التدفق هو **فحص وتصنيف فقط → عرض نتيجة → قرار لاحق (نقل / نسخ / لاحقاً)**. زر البداية الوحيد هو **[ بدء الفحص والتصنيف ]**.

---

## 0) الفارق عن Revision 1

| Revision 1 (ملغى) | Revision 2 (المعتمد الآن) |
|---|---|
| Toggle `Move/Copy` قبل `Start` | **لا Toggle إطلاقاً** |
| `job:startWithMode({mode})` يقرر النقل/النسخ مع الفحص | `scan:start` لا ينقل/ينسخ/يحذف شيئاً أبداً |
| نصوص "ابدأ الفحص والنقل/النسخ" | نص واحد فقط: **"بدء الفحص والتصنيف"** |
| Copied يُسجل أثناء الفحص | Copied يُسجل فقط بعد قرار صريح بعد الفحص |
| لا مفهوم Pending | **PendingAdultItem** حالة محفوظة صراحة لـ "لاحقاً" |

كل الأقسام أدناه أُعيدت كتابتها لتطابق هذا القرار.

---

## 1) ملخص المتطلبات (بعد القرار)

### 1.1 المبدأ العام
1. المستخدم يضغط **[ بدء الفحص والتصنيف ]**.
2. أثناء الفحص والتصنيف: **لا نقل، لا نسخ، لا حذف** — `source/core/pipeline/orchestrator.ts:81` يتوقف عند `determineDecision` فقط.
3. بعد الاكتمال تُعرض خلاصة واضحة: *"تم العثور على N فيلم/مسلسل مصنفة كمحتوى للكبار"* (وفق `TV-MA, R, NC-17, X, 18+, ADULT, 18` في `source/core/ratings/targets.ts:1`).
4. بعد الخلاصة فقط يُخيَّر المستخدم: **[ نقل ] [ نسخ ] [ لاحقاً ]**.

### 1.2 المفاهيم الأربعة — مفصولة تماماً

**1. Unknown Content** (`not-found`, `no-rating`, `low-confidence <0.55`, `TMDB/network error`, `scan error`)
- Fail Closed دائماً. لا يُنقل ولا يُنسخ تلقائياً. يُحفظ في `UnknownItem` للمراجعة اليدوية.

**2. Known Adult Content** (نتيجة حية لآخر فحص)
- عناصر `Decision.outcome === MOVE` بثقة ≥0.55 وتصنيف ضمن قائمة الهدف. هذه **ليست** Pending ولا Copied — هي حالة مؤقتة في ذاكرة `JobController` بعد كل Scan (تُعرض في مودال النتيجة). تختفي بإغلاق المودال إلا إذا اختار المستخدم "لاحقاً".

**3. Pending / Later** (حالة محفوظة)
- Known Adult التي اختار لها المستخدم **"لاحقاً"**. يجب حفظها على القرص فوراً ليتمكن من العودة بعد إغلاق التطبيق وإعادة تنفيذ `Move/Copy` **دون إعادة فحص** (توفير حصة TMDB والتزامات `Rate Limit` في `source/core/tmdb/client.ts:1`).

**4. Copied Items** (سجل تنفيذ فقط)
- ليس قائمة فحص. هو سجل للنسخ التي نُفذت فعلياً ونجحت (`copyFolder` + `verifyCopy`). يُحذف منه فقط عبر حذف نسخة من القرص.

---

## 2) تدفق Pipeline / State Flow الجديد (حجر الزاوية)

### 2.1 الحالتان المنفصلتان

```
Phase A: SCAN & CLASSIFY (لا يمس القرص)
  scanSource() → parseMediaName() → getMediaRating() → determineDecision()
  → يجمع: knownAdult[], unknown[], skippedNonAdult[], errors[]
  → phase: "scanning" → "parsing" → "searching" → "scan-complete"

Phase B: EXECUTE (فقط بعد قرار المستخدم)
  pendingMove() → moveFolder()  (Same-Volume rename فقط)
  pendingCopy() → copyFolder() + verifyCopy()
```

### 2.2 State Machine المقترح (`source/core/types.ts:46`)

```
ready → scanning → parsing → searching → scan-complete
                                         ├─[ نقل ]→ moving → complete
                                         ├─[ نسخ ]→ copying → complete
                                         └─[ لاحقاً ]→ pending-saved → ready
```

- `scan-complete` حالة جديدة (ليست `complete` القديمة). فيها `running=false` لكن `knownAdult.length>0`.
- `moving`/`copying` هما `moving` الحالية مع تفريق لفظي للسجل.
- `pending-saved` لحظية ثم `ready`.

### 2.3 ماذا يحدث في كل Phase

| Phase | يقرأ | يكتب على القرص | يسجل |
|---|---|---|---|
| SCAN | المصادر + TMDB | **لا شيء** (حتى `UnknownStore` يُكتب هنا فقط عند الاكتمال، لا أثناء الحلقة) | `JobScanResult` في الذاكرة |
| MOVE (بعد قرار) | `PendingAdultItem[]` أو `knownAdult` الحي | `fs.rename` عبر `moveFolder` (`source/core/files/mover.ts:107`) | `Copied` لا يُسجل هنا |
| COPY (بعد قرار) | `PendingAdultItem[]` | `copyFolder` + `verify` | `CopiedStore.add()` لكل نجاح |
| LATER | `knownAdult` الحي | **لا نقل/نسخ** | `PendingStore.addMany(knownAdult)` |

---

## 3) تحليل التأثير (Impact Analysis) — بعد القرار

| الطبقة | الملفات | التغيير المطلوب (تصميم فقط) |
|---|---|---|
| **core/types.ts** | `source/core/types.ts:5` | إضافة `UnknownItem`, `PendingAdultItem`, `CopiedItem` + `JobPhase: "scan-complete" \| "copying"` + `ScanSummary { totalScanned, knownAdultCount, unknownCount, skippedCount, errorCount }` + `ScanResult { knownAdult: PendingAdultItem[], unknown: UnknownItem[] }`. توسيع `JobConfig` غير لازم (الوضع لم يعد في Config). |
| **core/config** | `source/core/config/store.ts:43` | **لا تعديل** عليه. إنشاء 3 مخازن جديدة بنفس نمط الكتابة الذرية `tmp→rename`: `unknown-store.ts`, `pending-store.ts`, `copied-store.ts`. كلها `SCHEMA_VERSION=1`. |
| **core/files/mover.ts** | `source/core/files/mover.ts:30` | إضافة `copyFolder()` + `verifyCopy()` (مقارنة `size` + `mtime`، لا hash ثقيل افتراضياً). `moveFolder` يبقى كما هو مع رفض `EXDEV`. `uniqueTargetPath` (`source/core/files/mover.ts:72`) يُعاد استخدامه للاثنين. |
| **core/files/scanner.ts** | `source/core/files/scanner.ts:52` | لا تغيير وظيفي. |
| **core/pipeline/orchestrator.ts** | `source/core/pipeline/orchestrator.ts:81` | **فصل جذري**: `runScanPhase(options): Promise<ScanResult>` (لا `moveFolder` إطلاقاً) + `runExecutePhase({items, mode, destination, ...})`. `runScanJob` الحالي يُستبدل أو يُحتفظ به كـ wrapper قديم مُهمل. |
| **main/job-controller.ts** | `source/main/job-controller.ts:50` | يحقن 3 مخازن. `startScan()` (كان `startJob`) لا يستقبل `mode`. يحتفظ بـ `lastScanResult: ScanResult \| null` في الذاكرة. دوال جديدة: `getScanSummary()`, `executePending({ids, mode})`, `saveAsPending(ids)`, `getPending()`, `clearPending(id)`, `clearAllPending()`. `requestStop` يوقف Scan فقط. |
| **main/ipc.ts** | `source/main/ipc.ts:19` | إزالة `job:startWithMode` من التصميم؛ تسجيل قنوات Scan/Pending الجديدة مع `isTrustedSender` و `sanitize` صارم (UUID فقط). |
| **main/preload.ts** | `source/main/preload.ts:24` | توسيع `CHANNELS` و `bridge` بنفس الأسماء حرفياً (تكرار بسبب sandbox). |
| **renderer/index.html** | `source/renderer/index.html:25` | **حذف كل أثر لـ mode-toggle**. زر واحد: `id="scan-btn" → "بدء الفحص والتصنيف"`. إضافة تبويبات: `[السجل] [قيد الانتظار (n)] [غير المعروف (n)] [المنسوخ (n)]`. مودال نتيجة Scan (`#scan-result-modal`) بثلاثة أزرار. |
| **renderer/renderer.ts** | `source/renderer/renderer.ts:104` | إدارة `lastScanResult` العابر، رندر تبويب Pending/Unknown/Copied، منطق المودال، تعطيل الأزرار أثناء `scanning/searching` فقط. |
| **renderer/styles.css** | `source/renderer/styles.css:97` | أنماط `.tabs`, `.modal-overlay`, `.scan-result-card`. لا كسر لـ RTL/CSP. |

**لم يعد مطلوباً:** `mode-toggle`, `job:startWithMode`, أي نص "ابدأ الفحص والنقل/النسخ".

---

## 4) تصميم التخزين (Storage Design) — مع Pending

### 4.1 الآلية
ثلاثة ملفات JSON منفصلة في `%APPDATA%/adult-media-mover/` بجوار `settings.json`، كلها بنمط `AppConfigStore` (`source/core/config/store.ts:92`):
- `unknown.json` — Unknown
- `pending.json` — Pending Adult (لاحقاً)
- `copied.json` — Copied

كتابة ذرية `writeFile(tmp) → rename(tmp, file)`، تحميل متسامح (`[]` عند التلف)، `version:1`.

### 4.2 Schemas

```ts
interface UnknownItem {
  id: string;              // uuid v4
  folderName: string;      // basename
  originalPath: string;    // المسار الكامل لحظة الفحص
  reason: string;          // "not-found" | "no-rating" | "low-confidence" | "tmdb-error" | "scan-error"
  details?: string;
  date: string;            // ISO 8601
  source: string;          // المصدر الذي اكتُشف فيه
}

interface PendingAdultItem {
  id: string;
  folderName: string;
  originalPath: string;    // المسار الحالي (قد يتغير إن نُقل المجلد يدوياً — يُتحقق عند التنفيذ)
  destination: string;     // الوجهة التي كانت محددة لحظة الفحص (للتنفيذ لاحقاً)
  rating: string;          // "TV-MA" | "R" ...
  mediaType: MediaType;    // "series" | "movie"
  tmdbId: number | null;
  confidence: number;
  year: number | null;
  title: string;           // العنوان المُحلل
  dateScanned: string;     // ISO
  source: string;
}

interface CopiedItem {
  id: string;
  folderName: string;
  originalPath: string;    // بقي كما هو (النسخ لا يحذف)
  copiedPath: string;      // المسار الفعلي بعد uniqueTargetPath
  destination: string;
  date: string;            // تاريخ النسخ
  sizeBytes?: number;
  pendingId?: string;      // ربط اختياري بالـ Pending الذي نُفذ منه
}
```

```ts
interface PersistedUnknown { version: 1; items: UnknownItem[]; }
interface PersistedPending { version: 1; items: PendingAdultItem[]; }
interface PersistedCopied  { version: 1; items: CopiedItem[]; }
```

### 4.3 دوال كل مخزن (تصميم واجهة فقط)

```ts
class UnknownStore {
  constructor(filePath: string)
  load(): Promise<UnknownItem[]>
  add(item: Omit<UnknownItem,"id"|"date">): Promise<UnknownItem>
  addMany(items: Omit<UnknownItem,"id"|"date">[]): Promise<UnknownItem[]>
  remove(id: string): Promise<boolean> // UUID فقط
  clearAll(): Promise<void>
}
class PendingStore {
  constructor(filePath: string)
  load(): Promise<PendingAdultItem[]>
  add(item: Omit<PendingAdultItem,"id"|"dateScanned">): Promise<PendingAdultItem>
  addMany(items: Omit<PendingAdultItem,"id"|"dateScanned">[]): Promise<PendingAdultItem[]>
  remove(id: string): Promise<boolean>
  clearAll(): Promise<void>
  // عند التنفيذ: يُحذف الناجح من Pending ويُنقل إلى Copied (للنسخ) أو يُحذف فقط (للنقل)
}
class CopiedStore {
  constructor(filePath: string)
  load(): Promise<CopiedItem[]>
  add(item: Omit<CopiedItem,"id"|"date">): Promise<CopiedItem>
  remove(id: string): Promise<{ ok:boolean; error?:string }> // يحذف من القرص بعد isPathInside(copiedPath, destination)
  clearAll(): Promise<{ deleted:number; errors:string[] }>
}
```

**أمان الحذف:** أي `remove(id)` لا يستقبل مساراً أبداً — Main يقرأ المسار من المخزن ثم يتحقق `isPathInside(copiedPath, destination)` (`source/core/files/path-guard.ts:1`) قبل `fs.rm`.

---

## 5) واجهة المستخدم (UI/UX) — بعد القرار

### 5.1 الشريط العلوي والأزرار

```html
<!-- actions-card: زر واحد فقط -->
<section class="card actions-card">
  <button id="scan-btn" class="btn primary big">بدء الفحص والتصنيف</button>
  <button id="stop-btn" class="btn danger big" disabled>إيقاف</button>
  <div id="scan-error" class="error-text"></div>
</section>
```
- لا Toggle، لا "ابدأ الفحص والنقل". `scan-btn` يُعطَّل أثناء `scanning/searching` فقط.

### 5.2 مودال نتيجة الفحص (يظهر فقط عند `scan-complete` و `knownAdultCount>0`)

```
┌─────────────────────────────────────────┐
│  تم العثور على 147 فيلم/مسلسل مصنفة     │
│  كمحتوى للكبار                          │
│  (من أصل 320 مجلداً مفحوصاً)            │
│                                         │
│  [ نقل ]  [ نسخ ]  [ لاحقاً ]           │
│  ─────────────────────────────────      │
│  تفاصيل: Unknown: 12 · تم تخطيه: 161    │
└─────────────────────────────────────────┘
```
- **نقل:** يستدعي `pending:execute({mode:"move", ids: allKnownIds})` → `moving` → `complete` → يفرغ Pending الحي.
- **نسخ:** نفسها بـ `mode:"copy"` → `copying` → يسجل في `CopiedStore`.
- **لاحقاً:** يستدعي `pending:saveAll` → يحفظ `knownAdult` في `pending.json` → يغلق المودال → `ready`. لا يمس القرص.

### 5.3 التبويبات (Tabs)

```
[ السجل النشط ]  [ قيد الانتظار (n) ]  [ غير المعروف (n) ]  [ المنسوخ (n) ]
```

| تبويب | المحتوى | الإجراءات |
|---|---|---|
| **السجل النشط** | كما هو الآن: مصادر/وجهة/مفتاح + الإحصائيات الحية + `log-area` | لا تغيير |
| **قيد الانتظار** | قائمة `PendingAdultItem` المحفوظة (جدول: الاسم، التصنيف، المصدر، التاريخ) | لكل صف: `[ نقل ] [ نسخ ] [ إزالة ]` + Footer: `[ نقل الكل ] [ نسخ الكل ] [ مسح الكل ]` |
| **غير المعروف** | `UnknownItem` | `[ فتح المجلد ] [ إزالة ]` + `[ مسح الكل ]` |
| **المنسوخ** | `CopiedItem` | `[ فتح النسخة ] [ حذف النسخة ]` + `[ حذف جميع النسخ ]` |

- أثناء `running` تُعرض التبويبات للقراءة فقط (الأزرار معطلة).
- Empty states واضحة لكل تبويب.

### 5.4 التأكيدات (مودالات عامة)

- مودال `confirm-move`: *"سيتم نقل N مجلداً إلى D:\Adult. المصدر سيُفرغ. متأكد؟"*
- مودال `confirm-copy`: *"سيتم نسخ N مجلداً إلى D:\Adult مع إبقاء المصدر. متأكد؟"*
- مودال `confirm-delete-copy`: *"حذف النسخة X نهائياً؟"*
- مودال `confirm-delete-all-copies`: *"حذف M نسخة نهائياً؟ لا يمكن التراجع."* (يتطلب تأكيداً ثانياً).
- كلها `div.modal-overlay` + `confirm-dialog` RTL، التركيز على زر الإلغاء.

---

## 6) عقود IPC الجديدة (تُستبدل Revision 1 بالكامل)

تُضاف إلى `IpcChannels` (`source/core/ipc-contracts.ts:20`) وتُكرر حرفياً في `source/main/preload.ts:24`:

| القناة | المعاملات | الإرجاع | الملاحظة |
|---|---|---|---|
| `scan:start` | `void` | `JobStartResult` | يبدأ Phase A فقط؛ يرفض إن كان `running` |
| `scan:getSummary` | `void` | `ScanSummary \| null` | للواجهة بعد `scan-complete` |
| `unknown:list` | `void` | `UnknownItem[]` | |
| `unknown:clearOne` | `{ id: string }` | `{ ok:boolean }` | UUID فقط |
| `unknown:clearAll` | `void` | `{ cleared:number }` | |
| `pending:list` | `void` | `PendingAdultItem[]` | |
| `pending:saveAll` | `void` | `{ saved:number }` | يحفظ `lastScanResult.knownAdult` الحالي |
| `pending:execute` | `{ ids: string[], mode:"move"\|"copy" }` | `{ ok:boolean; stats:Stats; errors:string[] }` | يتحقق `mode` صراحة، و `ids` ضمن Pending فقط |
| `pending:clearOne` | `{ id: string }` | `{ ok:boolean }` | |
| `pending:clearAll` | `void` | `{ cleared:number }` | |
| `copied:list` | `void` | `CopiedItem[]` | |
| `copied:deleteOne` | `{ id: string }` | `{ ok:boolean; error?:string }` | يقرأ المسار من المخزن + `isPathInside` |
| `copied:deleteAll` | `void` | `{ deleted:number; errors:string[] }` | |

**المحذوف من Revision 1:** `job:startWithMode`, `mode-toggle`, أي قناة تستقبل `mode` مع `scan`.

**الأحداث:** `job:event` (`source/core/ipc-contracts.ts:89`) يبقى، لكن يُضاف `type:"scan-complete"` يحمل `ScanSummary` (بدل إعادة استخدام `complete`).

---

## 7) خطة الاختبارات (مقترحة، غير منفذة)

### 7.1 وحدة (Unit — `node --test` + `tsx`, بلا شبكة)

| الملف | الحالات |
|---|---|
| `tests/unknown-store.test.ts` | add/addMany/load/remove/clearAll، كتابة ذرية، تحميل تالف→`[]`، حظر id غير UUID |
| `tests/pending-store.test.ts` | addMany من ScanResult، remove واحد، clearAll، تحميل تالف، عدم قبول مسار حر |
| `tests/copied-store.test.ts` | add بعد copy ناجح، remove يحذف من القرص فقط إذا `isPathInside`، رفض مسار خارجي، clearAll |
| `tests/mover-copy.test.ts` | `copyFolder` ينشئ `uniqueTargetPath`، `verifyCopy` يطابق الحجم، يرفض `unsafe-paths`، يترك المصدر، يحترم `isStopping` |
| `tests/orchestrator-scan.test.ts` | `runScanPhase` مع stub TMDB: يجمع `knownAdult` (R/TV-MA) دون استدعاء `moveFolder/copyFolder`، يسجل `unknown`، يحترم `stop` |
| `tests/orchestrator-execute.test.ts` | `runExecutePhase` على `PendingAdultItem[]`: `mode=move` يستدعي `moveFolder` ويفرغ Pending، `mode=copy` يستدعي `copyFolder` ويسجل Copied، يفشل بأمان عند مصدر مفقود |
| `tests/ipc-scan.test.ts` | `sanitize` يرفض `mode` غير `move/copy`، يرفض `ids` غير مصفوفة UUID، `isTrustedSender` يحجب `http://` |

### 7.2 تكامل (Integration — `mkdtemp` حقيقي)

- **Scan-only:** مصدران (أفلام R + مجلد وهمي) → `scan:start` → `scan-complete` مع `knownAdult=3, unknown=1`, لا مجلد نُقل/نُسخ على القرص, `pending:list` فارغة قبل "لاحقاً".
- **Later:** بعد Scan → `pending:saveAll` → `pending:list` =3, إغلاق التطبيق وإعادة فتحه → القائمة باقية, `pending:execute({mode:"copy"})` → 3 نسخ في الوجهة + `copied:list`=3, المصدر بقي.
- **Move بعد Later:** `pending:execute({mode:"move"})` على pending جديد → المصدر فُرغ, الوجهة ازدادت, `pending:list` فُرغت.
- **Unknown:** مجلد `GarbageNonExistent` → يظهر في `unknown:list` بعد Scan, `clearOne` يحذفه.
- **أمان الحذف:** `copied:deleteOne` لمسار خارجي مُختلق → مرفوض (ليس في المخزن).
- **تعبئة حقيقية (dist-release):** Scan لـ 11 مجلداً (نفس `P3-FILE`) → خلاصة `knownAdult=5, unknown=3` (Garbage/الفيل الأزرق/The Crown) بلا نقل، ثم نسخ الـ5 → `copied:list`=5.

---

## 8) تقدير الوقت (محدث)

| المرحلة | المدة | يتضمن |
|---|---|---|
| **A. فصل Pipeline إلى Scan/Execute + أنواع جديدة + ScanSummary** | 3–4 أيام | `runScanPhase`/`runExecutePhase`, `scan-complete` |
| **B. PendingStore + UnknownStore (ذري) + CopiedStore** | 3 أيام | 3 مخازن + اختبارات وحدة |
| **C. Copy Logic (copyFolder/verifyCopy)** | 2–3 أيام | نسخ + تحقق + `uniqueTargetPath` |
| **D. IPC الجديد + JobController (lastScanResult + pending)** | 2–3 أيام | 12 قناة + sanitize + isTrustedSender |
| **E. واجهة: زر Scan + مودال النتيجة + 3 تبويبات + مودالات تأكيد** | 4–5 أيام | HTML/CSS/Renderer + حالات `running` |
| **F. تلميع + سيناريوهات تعبئة حقيقية + توثيق USER_GUIDE/CHANGELOG** | 2 أيام | Portable/Setup + دليل محدث |
| **الإجمالي** | **~16–20 يوم عمل** (≈ 3–4 أسابيع) | إصدار `0.2.0` |

الزيادة عن Revision 1 (~+4 أيام) سببها فصل الـ Pipeline وحالة `Pending` المحفوظة.

---

## 9) توصية Tab الـ Pending — القرار المعماري

### الخيارات المقيَّمة

| الخيار | الوصف | الإيجابيات | السلبيات |
|---|---|---|---|
| **A. Tab مستقل للـ Pending (محفوظ)** | تبويب دائم يقرأ `pending.json` | عودة بعد إعادة التشغيل بلا إعادة فحص (توفير TMDB)، تراكم عبر فحوصات متعددة، فصل واضح عن Unknown/Copied | تبويب إضافي |
| **B. دمجه مع "نتائج آخر Scan" (مؤقت)** | لا تخزين؛ النتيجة في ذاكرة `lastScanResult` فقط | أبسط كوداً | يُفقد بالإغلاق → إعادة فحص + استهلاك TMDB + فقدان قرار "لاحقاً" (يكسر المتطلب) |
| **C. Hybrid (آخر Scan + Pending)** | عرضان منفصلان في نفس التبويب | يوفر تبويباً | خلط مفهومين (مؤقت vs محفوظ) يربك المستخدم |

### القرار: **الخيار A — Tab مستقل للـ Pending (موصى به بقوة)**

**التبرير المعماري:**
1. **المتطلب يفرض الحفظ:** "لاحقاً... حفظ نتائج التصنيف... دون إعادة الفحص" — هذا لا يتحقق إلا بتخزين دائم. الخيار B يكسره.
2. **فصل المسؤوليات:** Unknown (Fail Closed، لا يُنفذ) ≠ Pending (Known Adult بانتظار قرار) ≠ Copied (سجل تنفيذ). دمج Pending مع آخر Scan يخلط "حالة مؤقتة" بـ "حالة محفوظة" ويصعّب الاختبار.
3. **توفير الموارد:** كل Scan يستهلك `search/tv + search/movie + content_ratings/release_dates` مع `Rate Limit ~2.5 req/s` (`source/core/tmdb/client.ts:1`). حفظ Pending يتجنب إعادة استهلاك الحصة.
4. **قابلية الاختبار:** مخزن منفصل `pending.json` يُختبر وحدة بمعزل عن Orchestrator، ويُحاكى بسهولة في `tests/pending-store.test.ts`.

**التنفيذ المقترح:** تبويب **"قيد الانتظار"** دائم، يُحدَّث فور `pending:saveAll` ويُقرأ عند إقلاع التطبيق. مودال نتيجة Scan يبقى للقرار الفوري، لكنه ليس بديلاً عن التبويب.

---

> **التالي:** بانتظار اعتمادك لهذه Revision 2 قبل أي تنفيذ.
