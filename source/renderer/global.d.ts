import type {
  AppInfo,
  JobEvent,
  JobStartResult,
  PickFolderResult,
  SaveSettingsPayload,
} from "../core/ipc-contracts";
import type { AppSettings } from "../core/types";

declare global {
  interface Window {
    /** الجسر الآمن الذي يكشفه preload عبر contextBridge. */
    adultMover: {
      /** استعلام معلومات التطبيق والنظام من Main Process. */
      probe(): Promise<AppInfo>;
      /** الحصول على الإعدادات المحفوظة (مع مفتاح الذاكرة إن وجد). */
      getSettings(): Promise<AppSettings>;
      /** حفظ تصحيح جزئي للإعدادات. */
      saveSettings(payload: SaveSettingsPayload): Promise<AppSettings>;
      /** فتح نافذة اختيار مجلد. */
      pickFolder(): Promise<PickFolderResult>;
      /** بدء وظيفة الفحص والنقل. */
      startJob(): Promise<JobStartResult>;
      /** طلب إيقاف آمن. */
      stopJob(): Promise<void>;
      /** الاشتراك بأحداث الوظيفة. @returns دالة إلغاء الاشتراك. */
      onJobEvent(listener: (event: JobEvent) => void): () => void;
    };
  }
}

export {};