import type {
  AppInfo,
  JobEvent,
  JobStartResult,
  PickFolderResult,
  SaveSettingsPayload,
} from "../core/ipc-contracts";
import type { AppSettings, ScanSummary, PendingAdultItem, UnknownItem, CopiedItem, Stats } from "../core/types";

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
      /** بدء وظيفة الفحص والنقل (legacy). */
      startJob(): Promise<JobStartResult>;
      /** بدء الفحص والتصنيف فقط (Scan-First). */
      startScan(): Promise<JobStartResult>;
      getScanSummary(): Promise<ScanSummary | null>;
      getUnknown(): Promise<UnknownItem[]>;
      clearUnknown(id: string): Promise<{ ok: boolean }>;
      clearAllUnknown(): Promise<{ cleared: number }>;
      getPending(): Promise<PendingAdultItem[]>;
      saveAsPending(): Promise<{ saved: number }>;
      executePending(mode: "move" | "copy", ids?: string[]): Promise<{ ok: boolean; stats: Stats; errors: string[]; executed: number }>;
      clearPending(id: string): Promise<{ ok: boolean }>;
      clearAllPending(): Promise<{ cleared: number }>;
      getCopied(): Promise<CopiedItem[]>;
      deleteCopied(id: string): Promise<{ ok: boolean; error?: string }>;
      deleteAllCopied(): Promise<{ deleted: number; errors: string[] }>;
      /** طلب إيقاف آمن. */
      stopJob(): Promise<void>;
      /** الاشتراك بأحداث الوظيفة. @returns دالة إلغاء الاشتراك. */
      onJobEvent(listener: (event: JobEvent) => void): () => void;
    };
  }
}

export {};