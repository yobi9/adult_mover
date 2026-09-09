/**
 * سجل العمليات (Logging).
 *
 * - حلقة دائرية (Ring Buffer) في الذاكرة للعرض الفوري في الواجهة.
 * - قوائم مستمعين تُنبَّه عند كل إدخال جديد.
 * - تحصين تلقائي: أي قيمة api_key داخل النص تُقنَّع قبل التخزين (البند 26/38).
 * - كتابة ملف اختيارية تُضاف لاحقاً في مرحلة Pipeline دون تغيير الواجهة.
 */

export type LogLevel = "info" | "warn" | "error" | "debug";

/** إدخال سجل واحد. */
export interface LogEntry {
  readonly time: string;
  readonly level: LogLevel;
  readonly message: string;
}

/** مطابقة api_key في السلاسل لإخفائها (قيم تُستبدل بـ ***). */
export const API_KEY_PATTERN = /([?&]api_key=)([^&\s]+)/gi;

/**
 * يُقنّع أي مفاتيح API داخل النص قبل التسجيل.
 * @param text النص الخام.
 * @returns النص مع إخفاء قيم api_key.
 */
export function maskSensitive(text: string): string {
  return text.replace(API_KEY_PATTERN, "$1***");
}

/**
 * تنسيق طابع زمني بصيغة YYYY-MM-DD HH:mm:ss.
 * @param date التاريخ المراد تنسيقه.
 * @returns السلسلة المنَسَّقة.
 */
export function formatTimestamp(date: Date): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  const y = date.getFullYear();
  const m = p(date.getMonth() + 1);
  const d = p(date.getDate());
  const h = p(date.getHours());
  const min = p(date.getMinutes());
  const s = p(date.getSeconds());
  return `${y}-${m}-${d} ${h}:${min}:${s}`;
}

/** سجل في الذاكرة بحجم محدد. */
export class Logger {
  private readonly entries_: LogEntry[] = [];
  private readonly listeners: Array<(entry: LogEntry) => void> = [];
  private readonly maxEntries: number;

  /**
   * @param maxEntries الحد الأقصى لعدد الإدخالات المحتفظ بها في الذاكرة.
   */
  constructor(maxEntries = 2000) {
    this.maxEntries = maxEntries;
  }

  /** إدخالات السجل الحالية (لا يمكن تعديلها من الخارج). */
  get entries(): readonly LogEntry[] {
    return this.entries_;
  }

  /**
   * الاشتراك في إدخالات السجل الجديدة.
   * @param listener دالة تُستدعى عند كل إدخال جديد.
   * @returns دالة إلغاء الاشتراك.
   */
  onLog(listener: (entry: LogEntry) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index >= 0) this.listeners.splice(index, 1);
    };
  }

  /**
   * إضافة إدخال إلى السجل مع تطبيق التنقية التلقائية.
   * @param level مستوى الإدخال.
   * @param message نص الإدخال (قد يحتوي مفاتيح تُقنَّع تلقائياً).
   * @returns الإدخال المُنشأ.
   */
  log(level: LogLevel, message: string): LogEntry {
    const entry: LogEntry = {
      time: formatTimestamp(new Date()),
      level,
      message: maskSensitive(message),
    };
    this.entries_.push(entry);
    if (this.entries_.length > this.maxEntries) {
      this.entries_.shift();
    }
    for (const listener of this.listeners) {
      try {
        listener(entry);
      } catch {
        /* أخطاء المستمعين يجب ألا تكسر السجل نفسه. */
      }
    }
    return entry;
  }

  info(message: string): LogEntry {
    return this.log("info", message);
  }

  warn(message: string): LogEntry {
    return this.log("warn", message);
  }

  error(message: string): LogEntry {
    return this.log("error", message);
  }

  debug(message: string): LogEntry {
    return this.log("debug", message);
  }

  /** مسح كل إدخالات الذاكرة. */
  clear(): void {
    this.entries_.length = 0;
  }
}