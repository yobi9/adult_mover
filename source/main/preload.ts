/**
 * جسر IPC آمن بين Renderer و Main.
 *
 * contextBridge يكشف صراحةً API مصغّرة فقط (قنوات بيضاء)، ولا يكشف أي صلاحيات
 * Node.js. Renderer لا يملك nodeIntegration ولا دورات sandbox.
 *
 * ملاحظة شاملة: هذا الملف خود-contained (بلا require لملفات نسبية) لأن Preload
 * في وضع sandbox تسمح فقط بتحميل 'electron' ومجموعة صغيرة من Node modules.
 * لذلك تُكرَّر أسماء القنوات حرفياً هنا؛ حافظ على تطابقها مع
 * IpcChannels في ../core/ipc-contracts.
 */

import { contextBridge, ipcRenderer } from "electron";
import type {
  AppInfo,
  JobEvent,
  JobStartResult,
  PickFolderResult,
  SaveSettingsPayload,
} from "../core/ipc-contracts";
import type { AppSettings } from "../core/types";

/** أسماء القنوات (تطابق IpcChannels في ipc-contracts.ts). */
const CHANNELS = {
  probe: "app:probe",
  settingsGet: "settings:get",
  settingsSave: "settings:save",
  pickFolder: "dialog:pickFolder",
  jobStart: "job:start",
  jobStop: "job:stop",
  jobEvent: "job:event",
} as const;

const bridge = {
  /** استعلام معلومات التطبيق والنظام من Main Process. */
  probe: (): Promise<AppInfo> => ipcRenderer.invoke(CHANNELS.probe),

  /** الحصول على الإعدادات المحفوظة (مع مفتاح الذاكرة إن وجد). */
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke(CHANNELS.settingsGet),

  /** حفظ تصحيح جزئي للإعدادات. @returns الإعدادات بعد التطبيق. */
  saveSettings: (payload: SaveSettingsPayload): Promise<AppSettings> =>
    ipcRenderer.invoke(CHANNELS.settingsSave, payload),

  /** فتح نافذة اختيار مجلد. */
  pickFolder: (): Promise<PickFolderResult> => ipcRenderer.invoke(CHANNELS.pickFolder),

  /** بدء وظيفة الفحص والنقل. */
  startJob: (): Promise<JobStartResult> => ipcRenderer.invoke(CHANNELS.jobStart),

  /** طلب إيقاف آمن. */
  stopJob: (): Promise<void> => ipcRenderer.invoke(CHANNELS.jobStop),

  /**
   * الاشتراك بأحداث الوظيفة.
   * @param listener مستمع يُصدّره Main.
   * @returns دالة إلغاء الاشتراك.
   */
  onJobEvent: (listener: (event: JobEvent) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, event: JobEvent): void => {
      listener(event);
    };
    ipcRenderer.on(CHANNELS.jobEvent, handler);
    return () => {
      ipcRenderer.removeListener(CHANNELS.jobEvent, handler);
    };
  },
};

contextBridge.exposeInMainWorld("adultMover", bridge);