/**
 * المتحكم المركزي بوظائف الفحص والنقل في Main Process.
 *
 * يملك:
 * - إعدادات التطبيق (ذاكرة + تخزين).
 * - إشارة الإيقاف الآمن وحالة التشغيل.
 * - إعادة توجيه أحداث الوظيفة إلى الواجهة (SCI عبر job:event).
 * - بناء عميل TMDB وبوابة التصنيف لكل وظيفة.
 */

import { createStopSignal, type StopSignal } from "../core/pipeline/stop";
import { runScanJob, type RatingGateway } from "../core/pipeline/orchestrator";
import { scanSource } from "../core/files/scanner";
import { moveFolder } from "../core/files/mover";
import { isPathInside } from "../core/files/path-guard";
import { TmdbClient } from "../core/tmdb/client";
import { getMediaRating } from "../core/tmdb/media-rating";
import { AppConfigStore } from "../core/config/store";
import type { AppSettings, JobConfig, JobPhase, Stats } from "../core/types";
import type { JobEvent, JobStartResult, PickFolderResult, SaveSettingsPayload } from "../core/ipc-contracts";
import type { Logger } from "../core/logging/logger";
import { dialog, type BrowserWindow } from "electron";

/** رسائل حالة الوظيفة. */
const PHASE_LABELS: Record<JobPhase, string> = {
  ready: "جاهز",
  preparing: "تحضير",
  scanning: "فحص المصادر",
  parsing: "تحليل الأسماء",
  searching: "الاستعلام عن التصنيفات",
  moving: "نقل المحتوى",
  stopping: "إيقاف آمن",
  stopped: "متوقف",
  complete: "مكتمل",
  aborted: "متوقف (خطأ حرج)",
};

/** برمجة عميل TMDB وبوابة التصنيف. */
function createTmdbGateway(
  client: TmdbClient,
  apiKey: string,
  logger: Logger
): RatingGateway {
  return {
    getRating: (title, year) =>
      getMediaRating(client, { title, year, apiKey, logger }),
  };
}

export class JobController {
  private settings: AppSettings;
  private readonly stop: StopSignal = createStopSignal();
  private running = false;
  private stopAfter: (() => void) | undefined;

  constructor(
    private readonly store: AppConfigStore,
    private readonly logger: Logger,
    private readonly sendEvent: (event: JobEvent) => void
  ) {
    this.settings = {
      sources: [],
      destination: "",
      recursive: true,
      keepApiKey: false,
      apiKey: "",
    };
  }

  /** تحميل الإعدادات المحفوظة عند الإقلاع. */
  async init(): Promise<void> {
    this.settings = await this.store.load();
  }

  /** لقطة الإعدادات الحالية. */
  getSettings(): AppSettings {
    return { ...this.settings };
  }

  /**
   * دمج تصحيحات جزئية مع التحقق من الأنواع ثم الحفظ.
   * @param payload الحقول المراد تحديثها.
   * @returns الإعدادات بعد التطبيق.
   */
  async saveSettings(payload: SaveSettingsPayload): Promise<AppSettings> {
    const next: AppSettings = { ...this.settings };
    if (Array.isArray(payload.sources)) {
      next.sources = payload.sources.filter((s) => typeof s === "string");
    }
    if (typeof payload.destination === "string") {
      next.destination = payload.destination;
    }
    if (typeof payload.recursive === "boolean") {
      next.recursive = payload.recursive;
    }
    if (typeof payload.keepApiKey === "boolean") {
      next.keepApiKey = payload.keepApiKey;
    }
    if (typeof payload.apiKey === "string") {
      next.apiKey = payload.apiKey;
    }
    this.settings = next;
    await this.store.save(next);
    return this.getSettings();
  }

  /** هل وظيفة قيد التشغيل الآن؟ */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * طلب إيقاف آمن (يكمل المجلد الحالي ثم يتوقف).
   * @param after رد إضافي يُستدعى بعد اكتمال التوقف (اختياري).
   */
  requestStop(after?: () => void): void {
    if (after) {
      this.stopAfter = after;
    }
    this.stop.requestStop();
    if (!this.running && this.stopAfter) {
      const cb = this.stopAfter;
      this.stopAfter = undefined;
      cb();
    }
  }

  /**
   * بدء وظيفة فحص وتصرف ونقل.
   * @returns نتيجة البدء (رفض مبكر عند نقص الإعدادات).
   */
  async startJob(): Promise<JobStartResult> {
    if (this.running) {
      return { ok: false, error: "وظيفة قيد التشغيل." };
    }
    const { sources, destination, recursive, apiKey } = this.settings;
    if (sources.length === 0) {
      return { ok: false, error: "أضف مصدراً واحداً على الأقل." };
    }
    if (!destination.trim()) {
      return { ok: false, error: "حدد مجلد الوجهة." };
    }
    if (!apiKey.trim()) {
      return { ok: false, error: "أدخل مفتاح TMDB API." };
    }

    this.stop.reset();
    this.running = true;
    this.emitPhase("preparing");

    const config: JobConfig = {
      sources: sources.slice(),
      destination: destination.trim(),
      recursive,
    };
    const client = new TmdbClient({ apiKey, timeoutMs: 15000 });
    const gateway = createTmdbGateway(client, apiKey, this.logger);

    const runner = runScanJob({
      config,
      stop: this.stop,
      logger: this.logger,
      getRating: gateway,
      scanSource,
      moveFolder,
      isAtDestination: (folder) => Promise.resolve(isPathInside(folder, config.destination)),
      callbacks: {
        onPhase: (phase) => this.emitPhase(phase),
        onStats: (stats: Stats) => this.sendEvent({ type: "stats", stats }),
        onDecision: (folder, decision) =>
          this.sendEvent({ type: "decision", folder, decision }),
      },
    });

    void runner
      .then((result) => {
        this.sendEvent({
          type: "complete",
          phase: result.phase,
          stopped: result.stopped,
          stats: result.stats,
        });
      })
      .catch((error) => {
        this.logger.error(`فشل غير متوقع في الوظيفة: ${messageOf(error)}`);
        this.sendEvent({ type: "phase", phase: "aborted" });
        this.sendEvent({
          type: "complete",
          phase: "aborted",
          stopped: false,
          stats: { processed: 0, moved: 0, skipped: 0, errors: 1 },
        });
      })
      .finally(() => {
        this.running = false;
        const after = this.stopAfter;
        this.stopAfter = undefined;
        after?.();
      });

    return { ok: true };
  }

  /** فتح نافذة اختيار مجلد مرتبطة بالإطار. @param win النافذة الأب. */
  async pickFolder(win: BrowserWindow | null): Promise<PickFolderResult> {
    const options: Electron.OpenDialogOptions = {
      properties: ["openDirectory", "createDirectory"],
      title: "اختر مجلداً",
    };
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true, path: null };
    }
    return { canceled: false, path: result.filePaths[0] ?? null };
  }

  /** الحصول على تسمية عربية لمرحلة. */
  phaseLabel(phase: JobPhase): string {
    return PHASE_LABELS[phase] ?? phase;
  }

  private emitPhase(phase: JobPhase): void {
    this.sendEvent({ type: "phase", phase });
  }
}

/** متوافق: رسالة آمنة للخطأ. */
function messageOf(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}