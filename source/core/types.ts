/**
 * أنواع أساسية مشتركة بين كل طبقات المشروع (Core / Main / Renderer).
 */

/** نوع المحتوى الذي حدده TMDB. */
export type MediaType = "series" | "movie" | "unknown";

/** حالة استعلام التصنيف عبر TMDB. */
export type RatingState = "found" | "not-found" | "no-rating" | "error";

/** نتيجة استعلام التصنيف المركزي (المكافئ لـ get_media_rating). */
export interface RatingResult {
  /** التصنيف العمري المُطبع (مثل TV-MA أو R) أو null عند غيابه. */
  rating: string | null;
  mediaType: MediaType;
  tmdbId: number | null;
  /** درجة الثقة بين 0 و 1؛ أقل من العتبة تعني عدم النقل (Fail Closed). */
  confidence: number;
  state: RatingState;
}

/** النتيجة النهائية لمجلد واحد في خط المعالجة. */
export type Outcome = "MOVE" | "SKIP" | "ERROR";

/** قرار مُعالَج لأحد المجلدات مع السبب. */
export interface Decision {
  outcome: Outcome;
  reason: string;
  details?: string;
}

/** إحصائيات الوظيفة الجارية. */
export interface Stats {
  processed: number;
  moved: number;
  skipped: number;
  errors: number;
}

/** إنشاء إحصائيات صفرية. */
export function emptyStats(): Stats {
  return { processed: 0, moved: 0, skipped: 0, errors: 0 };
}

/** حالات التشغيل المعروضة في الواجهة (البند 30). */
export type JobPhase =
  | "ready"
  | "preparing"
  | "scanning"
  | "parsing"
  | "searching"
  | "scan-complete"
  | "moving"
  | "copying"
  | "stopping"
  | "stopped"
  | "complete"
  | "aborted";

/** إعدادات وظيفة الفحص والنقل. */
export interface JobConfig {
  readonly sources: readonly string[];
  readonly destination: string;
  readonly recursive: boolean;
}

/** عنصر غير معروف (Fail Closed — لا يُنقل/يُنسخ تلقائياً). */
export interface UnknownItem {
  id: string;
  folderName: string;
  originalPath: string;
  reason: string;
  details?: string;
  date: string;
  source: string;
}

/** عنصر مصنف كمحتوى للكبار بانتظار قرار (حالة "لاحقاً" المحفوظة). */
export interface PendingAdultItem {
  id: string;
  folderName: string;
  originalPath: string;
  destination: string;
  rating: string;
  mediaType: MediaType;
  tmdbId: number | null;
  confidence: number;
  year: number | null;
  title: string;
  dateScanned: string;
  source: string;
}

/** سجل نسخة نُفذت فعلياً (Copy Mode). */
export interface CopiedItem {
  id: string;
  folderName: string;
  originalPath: string;
  copiedPath: string;
  destination: string;
  date: string;
  sizeBytes?: number;
  pendingId?: string;
}

/** ملخص فحص وتصنيف (Phase A — لا يمس القرص). */
export interface ScanSummary {
  totalScanned: number;
  knownAdultCount: number;
  unknownCount: number;
  skippedCount: number;
  errorCount: number;
}

/** نتيجة مرحلة الفحص والتصنيف (Scan-First — لا يمس القرص). */
export interface ScanResult {
  summary: ScanSummary;
  knownAdult: PendingAdultItem[];
  unknown: UnknownItem[];
  skippedNonAdult: number;
}

/** إعدادات التطبيق الكاملة المُحمَّلة/المحفوظة (البند 37-41). */
export interface AppSettings {
  /** مجلدات المصادر. */
  sources: string[];
  /** مجلد الوجهة. */
  destination: string;
  /** هل الفحص متكرر داخل المصادر؟ (افتراضي نعم). */
  recursive: boolean;
  /** هل عُلّم المستخدم على حفظ المفتاح؟ (لا يُحفظ المفتاح إلا عند الصراحة). */
  keepApiKey: boolean;
  /** مفتاح API في الذاكرة (لا يُسجل؛ يُحفظ فقط عند keepApiKey). */
  apiKey: string;
}