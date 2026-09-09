/**
 * تسجيل معالجات IPC في Main Process.
 *
 * المبدأ: كل معالج يتحقق من أن الطلب قادم من نافذتي (file://) قبل تنفيذ أي شيء،
 * ولا يقبل مدخلات غير موثوقة إلا بعد تحقق لاحق في مراحل التنفيذ.
 */

import { app, ipcMain, BrowserWindow, type IpcMainInvokeEvent } from "electron";
import type { AppInfo, PickFolderResult, SaveSettingsPayload } from "../core/ipc-contracts";
import { IpcChannels } from "../core/ipc-contracts";
import type { JobController } from "./job-controller";

/** التحقق من أن المتصل هو صفحتي المحملة من ملف محلي (وليس أي مصدر خارجي). */
function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url ?? "";
  return url.startsWith("file://");
}

/** معلومات التطبيق ونظام التشغيل المرسلة للواجهة. */
export function probeAppInfo(): AppInfo {
  return {
    appName: "Adult Media Mover",
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron,
    chromeVersion: process.versions.chrome,
    nodeVersion: process.versions.node,
    platform: process.platform,
  };
}

/** تحقق من أن القيمة المسموح بها مصفوفة سلاسل أو undefined. */
function normalizeSources(value: unknown): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.filter((v): v is string => typeof v === "string");
}

/** التحقق الجزئي من صيغة الحفظ. */
function sanitizeSavePayload(raw: unknown): SaveSettingsPayload | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const payload: SaveSettingsPayload = {};
  const sources = normalizeSources(record.sources);
  if (sources !== undefined) {
    payload.sources = sources;
  }
  if (typeof record.destination === "string") {
    payload.destination = record.destination;
  }
  if (typeof record.recursive === "boolean") {
    payload.recursive = record.recursive;
  }
  if (typeof record.keepApiKey === "boolean") {
    payload.keepApiKey = record.keepApiKey;
  }
  if (typeof record.apiKey === "string") {
    payload.apiKey = record.apiKey;
  }
  return payload;
}

/** تسجيل كل قنوات IPC المتاحة. */
export function registerIpcHandlers(controller: JobController): void {
  ipcMain.handle(IpcChannels.probe, (event): AppInfo => {
    if (!isTrustedSender(event)) {
      throw new Error("Untrusted IPC caller");
    }
    return probeAppInfo();
  });

  ipcMain.handle(IpcChannels.settingsGet, (event) => {
    if (!isTrustedSender(event)) {
      throw new Error("Untrusted IPC caller");
    }
    return controller.getSettings();
  });

  ipcMain.handle(IpcChannels.settingsSave, async (event, raw: unknown) => {
    if (!isTrustedSender(event)) {
      throw new Error("Untrusted IPC caller");
    }
    const payload = sanitizeSavePayload(raw);
    if (!payload) {
      return controller.getSettings();
    }
    return controller.saveSettings(payload);
  });

  ipcMain.handle(IpcChannels.pickFolder, async (event): Promise<PickFolderResult> => {
    if (!isTrustedSender(event)) {
      throw new Error("Untrusted IPC caller");
    }
    const win = BrowserWindow.fromWebContents(event.sender);
    return controller.pickFolder(win);
  });

  ipcMain.handle(IpcChannels.jobStart, async (event) => {
    if (!isTrustedSender(event)) {
      throw new Error("Untrusted IPC caller");
    }
    return controller.startJob();
  });

  ipcMain.handle(IpcChannels.jobStop, (event): void => {
    if (!isTrustedSender(event)) {
      throw new Error("Untrusted IPC caller");
    }
    controller.requestStop();
  });
}