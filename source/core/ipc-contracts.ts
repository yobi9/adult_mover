/**
 * عقود IPC المشتركة بين Main و Preload و Renderer.
 * نوعية فقط (Type-only)؛ لا تحتوي أي منطق.
 */

import type { AppSettings, Decision, JobPhase, Stats } from "./types";
import type { LogLevel } from "./logging/logger";

/** معلومات النظام/التطبيق المرسلة عبر قناة app:probe. */
export interface AppInfo {
  appName: string;
  appVersion: string;
  electronVersion: string;
  chromeVersion: string;
  nodeVersion: string;
  platform: string;
}

/** أسماء قنوات IPC (قائمة بيضاء واحدة لكل معنى). */
export const IpcChannels = {
  probe: "app:probe",
  settingsGet: "settings:get",
  settingsSave: "settings:save",
  pickFolder: "dialog:pickFolder",
  jobStart: "job:start",
  jobStop: "job:stop",
  jobEvent: "job:event",
} as const;

/** إقلاع نافذة اختيار مجلد. */
export interface PickFolderResult {
  canceled: boolean;
  /** المسار المختار أو null عند الإلغاء. */
  path: string | null;
}

/** نتيجة محاولة بدء وظيفة. */
export interface JobStartResult {
  ok: boolean;
  /** سبب الرفض عند !ok. */
  error?: string;
}

/* ---------------------------- أحداث الوظيفة ---------------------------- */

/** إدخال سجل جديد في الواجهة. */
export interface JobLogEvent {
  type: "log";
  time: string;
  level: LogLevel;
  message: string;
}

/** تغير مرحلة التشغيل. */
export interface JobPhaseEvent {
  type: "phase";
  phase: JobPhase;
}

/** تحديث الإحصائيات. */
export interface JobStatsEvent {
  type: "stats";
  stats: Stats;
}

/** قرار مجلد واحد. */
export interface JobDecisionEvent {
  type: "decision";
  folder: string;
  decision: Decision;
}

/** انتهاء فحص مصدر واحد (تقدم بصري). */
export interface JobScanSourceEvent {
  type: "scan-source";
  source: string;
  foldersFound: number;
}

/** انتهاء الوظيفة كاملة. */
export interface JobCompleteEvent {
  type: "complete";
  phase: "complete" | "aborted";
  stopped: boolean;
  stats: Stats;
}

/** كل أحداث الوظيفة المرسلة من Main إلى الاجتماع عبر قناة job:event. */
export type JobEvent =
  | JobLogEvent
  | JobPhaseEvent
  | JobStatsEvent
  | JobDecisionEvent
  | JobScanSourceEvent
  | JobCompleteEvent;

/** صيغة الإعدادات المقبولة عند الحفظ (جميع الحقول اختيارية). */
export interface SaveSettingsPayload {
  sources?: string[];
  destination?: string;
  recursive?: boolean;
  /** صريح: لا يُحفظ المفتاح على القرص إلا عند تفعيل keepApiKey. */
  keepApiKey?: boolean;
  apiKey?: string;
}