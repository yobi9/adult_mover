/**
 * نقطة بدء تطبيق Electron (Main Process).
 *
 * الأمان:
 * - contextIsolation: true و nodeIntegration: false و sandbox: true
 *   => لا يحصل Renderer على صلاحيات Node.js مباشرة إطلاقاً.
 * - كل التواصل عبر preload + IPC آمن بقائمة بيضاء.
 * - إغلاق النافذة أثناء تشغيل وظيفة → تأكيد صريح + إيقاف آمن قبل الإغلاق.
 */

import { app, BrowserWindow, dialog } from "electron";
import path from "node:path";
import { registerIpcHandlers } from "./ipc";
import { JobController } from "./job-controller";
import { AppConfigStore } from "../core/config/store";
import { UnknownStore } from "../core/config/unknown-store";
import { PendingStore } from "../core/config/pending-store";
import { CopiedStore } from "../core/config/copied-store";
import { Logger } from "../core/logging/logger";
import { IpcChannels, type JobLogEvent, type JobEvent } from "../core/ipc-contracts";

/** وضع فحص سريع (SMOKE_TEST=1) يُغلق التطبيق بعد تحميل النافذة للتحقق الآلي. */
const SMOKE_MODE = process.env.SMOKE_TEST === "1";

/** إنشاء النافذة الرئيسية بإعدادات أمان إلزامية. */
function createMainWindow(controller: JobController): BrowserWindow {
  const win = new BrowserWindow({
    width: 1120,
    height: 780,
    minWidth: 860,
    minHeight: 620,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#111827",
    title: "Adult Media Mover",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  win.once("ready-to-show", () => {
    win.show();
  });

  // تأكيد الإغلاق أثناء التشغيل (البند 33).
  let closeApproved = false;
  win.on("close", (event) => {
    if (closeApproved || !controller.isRunning()) {
      return;
    }
    event.preventDefault();
    const result = dialog.showMessageBox(win, {
      type: "warning",
      buttons: ["إيقاف الوظيفة وإغلاق", "إلغاء"],
      defaultId: 1,
      cancelId: 1,
      title: "وظيفة قيد التشغيل",
      message: "توجد وظيفة قيد التشغيل.",
      detail: "سيتوقف التطبيق بأمان بعد إكمال المجلد الحالي ثم يُغلق.",
      noLink: true,
    });
    void result.then(({ response }) => {
      if (response !== 0) {
        return;
      }
      closeApproved = true;
      controller.requestStop(() => {
        win.close();
      });
    });
  });

  void win.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
  return win;
}

app.whenReady().then(async () => {
  const logger = new Logger(2000);
  const userData = app.getPath("userData");
  const store = new AppConfigStore(path.join(userData, "settings.json"));
  const unknownStore = new UnknownStore(path.join(userData, "unknown.json"));
  const pendingStore = new PendingStore(path.join(userData, "pending.json"));
  const copiedStore = new CopiedStore(path.join(userData, "copied.json"));
  const controller = new JobController(store, logger, (event: JobEvent) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IpcChannels.jobEvent, event);
    }
  }, unknownStore, pendingStore, copiedStore);

  // بثّ سطور السجل إلى الواجهة (رؤية لوج مباشر — البند 25).
  // الرسائل تُنقّى مسبقاً في Logger.log (إخفاء api_key) قبل الوصول إلى هنا.
  logger.onLog((entry) => {
    const logEvent: JobLogEvent = {
      type: "log",
      time: entry.time,
      level: entry.level,
      message: entry.message,
    };
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IpcChannels.jobEvent, logEvent);
    }
  });
  await controller.init();
  registerIpcHandlers(controller);

  const win = createMainWindow(controller);

  win.webContents.once("did-finish-load", () => {
    console.log("[main] window loaded");
    if (SMOKE_MODE) {
      setTimeout(() => {
        void win.webContents
          .executeJavaScript(
            `(() => {
               const logArea = document.getElementById('log-area');
               const badge = document.getElementById('job-badge');
               const sourcesEmpty = document.getElementById('sources-empty');
               return {
                 hasReadyLine: logArea !== null && logArea.textContent.includes('جاهز للبدء'),
                 logText: logArea ? logArea.textContent : null,
                 badge: badge ? badge.textContent : null,
                 sourcesEmptyVisible: sourcesEmpty ? !sourcesEmpty.hidden : null,
               };
             })()`
          )
          .then((state) => {
            console.log("[smoke] renderer-state", JSON.stringify(state));
            if (!state || state.logText === null || !state.logText.includes("جاهز للبدء") || state.badge !== "جاهز") {
              console.error("[smoke] renderer-state unexpected");
              process.exitCode = 1;
            }
          })
          .catch((error) => {
            console.error("[smoke] renderer-check failed", error);
            process.exitCode = 1;
          })
          .finally(() => app.quit());
      }, 1500);
    }
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow(controller);
    }
  });
});

app.on("window-all-closed", () => {
  app.quit();
});