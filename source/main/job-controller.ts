/**
 * المتحكم المركزي بوظائف الفحص والنقل في Main Process.
 *
 * يملك:
 * - إعدادات التطبيق (ذاكرة + تخزين).
 * - إشارة الإيقاف الآمن وحالة التشغيل.
 * - إعادة توجيه أحداث الوظيفة إلى الواجهة (SCI عبر job:event).
 * - بناء عميل TMDB وبوابة التصنيف لكل وظيفة.
 * - مخازن Unknown / Pending / Copied (Scan-First).
 */

import { createStopSignal, type StopSignal } from "../core/pipeline/stop";
import {
  runScanJob,
  runScanPhase,
  runExecutePhase,
  type RatingGateway,
  type ScanPhaseResult,
} from "../core/pipeline/orchestrator";
import { scanSource } from "../core/files/scanner";
import { moveFolder, copyFolder } from "../core/files/mover";
import { isPathInside } from "../core/files/path-guard";
import { TmdbClient } from "../core/tmdb/client";
import { getMediaRating } from "../core/tmdb/media-rating";
import { AppConfigStore } from "../core/config/store";
import { UnknownStore } from "../core/config/unknown-store";
import { PendingStore } from "../core/config/pending-store";
import { CopiedStore } from "../core/config/copied-store";
import type { AppSettings, JobConfig, JobPhase, Stats, ScanSummary, PendingAdultItem, UnknownItem, CopiedItem } from "../core/types";
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
  "scan-complete": "انتهى الفحص — بانتظار القرار",
  moving: "نقل المحتوى",
  copying: "نسخ المحتوى",
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
  private lastScanResult: ScanPhaseResult | null = null;

  constructor(
    private readonly store: AppConfigStore,
    private readonly logger: Logger,
    private readonly sendEvent: (event: JobEvent) => void,
    private readonly unknownStore?: UnknownStore,
    private readonly pendingStore?: PendingStore,
    private readonly copiedStore?: CopiedStore
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

  // ------------------------------------------------------------------
  // Legacy: startJob (للتوافق مع 0.1.0 والاختبارات القديمة)
  // ------------------------------------------------------------------
  /**
   * بدء وظيفة فحص وتصرف ونقل (legacy — ينقل مباشرة).
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

  // ------------------------------------------------------------------
  // Scan-First: startScan (لا يمس القرص)
  // ------------------------------------------------------------------
  async startScan(): Promise<JobStartResult> {
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

    const runner = runScanPhase({
      config,
      stop: this.stop,
      logger: this.logger,
      getRating: gateway,
      scanSource,
      isAtDestination: (folder) => Promise.resolve(isPathInside(folder, config.destination)),
      callbacks: {
        onPhase: (phase) => this.emitPhase(phase),
        onStats: (stats: Stats) => this.sendEvent({ type: "stats", stats }),
        onDecision: (folder, decision) =>
          this.sendEvent({ type: "decision", folder, decision }),
      },
    });

    void runner
      .then(async (result) => {
        this.lastScanResult = result;
        // حفظ Unknown تلقائياً
        if (this.unknownStore && result.unknown.length > 0) {
          await this.unknownStore.addMany(
            result.unknown.map((u) => ({
              folderName: u.folderName,
              originalPath: u.originalPath,
              reason: u.reason,
              details: u.details,
              source: u.source,
            }))
          );
        }
        this.sendEvent({ type: "scan-complete", summary: result.summary, knownAdult: result.knownAdult, unknown: result.unknown } as JobEvent);
        this.sendEvent({ type: "phase", phase: result.phase });
        // stats نهائية للفحص
        this.sendEvent({ type: "stats", stats: result.stats });
      })
      .catch((error) => {
        this.logger.error(`فشل غير متوقع في الفحص: ${messageOf(error)}`);
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

  getScanSummary(): ScanSummary | null {
    return this.lastScanResult?.summary ?? null;
  }

  getLastScanKnownAdult(): PendingAdultItem[] {
    return this.lastScanResult?.knownAdult ?? [];
  }

  // Pending
  async getPending(): Promise<PendingAdultItem[]> {
    if (!this.pendingStore) return [];
    return this.pendingStore.load();
  }

  async saveAsPending(): Promise<{ saved: number }> {
    if (!this.pendingStore || !this.lastScanResult) return { saved: 0 };
    const items = this.lastScanResult.knownAdult;
    if (items.length === 0) return { saved: 0 };
    await this.pendingStore.addMany(
      items.map((it) => ({
        folderName: it.folderName,
        originalPath: it.originalPath,
        destination: it.destination,
        rating: it.rating,
        mediaType: it.mediaType,
        tmdbId: it.tmdbId,
        confidence: it.confidence,
        year: it.year,
        title: it.title,
        source: it.source,
      }))
    );
    return { saved: items.length };
  }

  async clearPending(id: string): Promise<{ ok: boolean }> {
    if (!this.pendingStore) return { ok: false };
    const ok = await this.pendingStore.remove(id);
    return { ok };
  }

  async clearAllPending(): Promise<{ cleared: number }> {
    if (!this.pendingStore) return { cleared: 0 };
    const before = await this.pendingStore.load();
    await this.pendingStore.clearAll();
    return { cleared: before.length };
  }

  async executePending(mode: "move" | "copy", ids?: string[]): Promise<{ ok: boolean; stats: Stats; errors: string[]; executed: number }> {
    if (!this.pendingStore) return { ok: false, stats: { processed: 0, moved: 0, skipped: 0, errors: 0 }, errors: ["no store"], executed: 0 };
    if (this.running) return { ok: false, stats: { processed: 0, moved: 0, skipped: 0, errors: 0 }, errors: ["running"], executed: 0 };
    let items: PendingAdultItem[] = [];
    // إذا طُلب تنفيذ بدون ids وكان Pending فارغاً، استخدم نتيجة آخر فحص مباشرة (القرار الفوري بعد Scan)
    const pendingLoaded = await this.pendingStore.load();
    if (ids && ids.length > 0) {
      const set = new Set(ids);
      items = pendingLoaded.filter((it) => set.has(it.id));
      // إذا لم يوجد في Pending، ابحث في lastScanResult (حالة: المستخدم ضغط نقل/نسخ فوراً بعد الفحص)
      if (items.length === 0 && this.lastScanResult) {
        items = this.lastScanResult.knownAdult.filter((it) => set.has(it.id));
      }
    } else {
      items = pendingLoaded;
      if (items.length === 0 && this.lastScanResult && this.lastScanResult.knownAdult.length > 0) {
        items = this.lastScanResult.knownAdult;
      }
    }
    if (items.length === 0) return { ok: false, stats: { processed: 0, moved: 0, skipped: 0, errors: 0 }, errors: ["empty"], executed: 0 };

    this.stop.reset();
    this.running = true;
    this.emitPhase(mode === "copy" ? "copying" : "moving");

    const destination = this.settings.destination.trim();
    const runner = runExecutePhase({
      items,
      mode,
      destination,
      stop: this.stop,
      logger: this.logger,
      moveFolder,
      copyFolder,
      callbacks: {
        onPhase: (phase) => this.emitPhase(phase),
        onStats: (stats: Stats) => this.sendEvent({ type: "stats", stats }),
        onDecision: (folder, decision) => this.sendEvent({ type: "decision", folder, decision }),
      },
    });

    const result = await runner;
    // إزالة الناجح من Pending (إن كان فيه)
    const succeededIds = new Set(result.executed.map((e) => e.item.id));
    for (const id of succeededIds) {
      await this.pendingStore.remove(id);
    }
    // إذا كان التنفيذ من lastScanResult مباشرة (Pending كان فارغاً)، امسح نتيجة الفحص لمنع إعادة التنفيذ
    const wasFallback = pendingLoaded.length === 0 && this.lastScanResult !== null;
    if (wasFallback && result.executed.length > 0) {
      this.lastScanResult = null;
    }
    // تسجيل Copied
    if (mode === "copy" && this.copiedStore) {
      for (const exec of result.executed) {
        await this.copiedStore.add({
          folderName: exec.item.folderName,
          originalPath: exec.item.originalPath,
          copiedPath: exec.target,
          destination,
          sizeBytes: undefined,
          pendingId: exec.item.id,
        });
      }
    }

    this.sendEvent({ type: "complete", phase: result.phase, stopped: result.stopped, stats: result.stats });
    this.running = false;
    const after = this.stopAfter;
    this.stopAfter = undefined;
    after?.();

    return {
      ok: result.phase === "complete",
      stats: result.stats,
      errors: result.errors.map((e) => `${e.item.folderName}: ${e.reason}`),
      executed: result.executed.length,
    };
  }

  // Unknown
  async getUnknown(): Promise<UnknownItem[]> {
    if (!this.unknownStore) return [];
    return this.unknownStore.load();
  }

  async clearUnknown(id: string): Promise<{ ok: boolean }> {
    if (!this.unknownStore) return { ok: false };
    const ok = await this.unknownStore.remove(id);
    return { ok };
  }

  async clearAllUnknown(): Promise<{ cleared: number }> {
    if (!this.unknownStore) return { cleared: 0 };
    const before = await this.unknownStore.load();
    await this.unknownStore.clearAll();
    return { cleared: before.length };
  }

  // Copied
  async getCopied(): Promise<CopiedItem[]> {
    if (!this.copiedStore) return [];
    return this.copiedStore.load();
  }

  async deleteCopied(id: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.copiedStore) return { ok: false, error: "no store" };
    const items = await this.copiedStore.load();
    const target = items.find((it) => it.id === id);
    if (!target) return { ok: false, error: "not found" };
    // أمان: تحقق أن المسار داخل الوجهة المعروفة
    const dest = this.settings.destination.trim();
    if (dest && !isPathInside(target.copiedPath, dest)) {
      return { ok: false, error: "unsafe path" };
    }
    // حذف من القرص
    try {
      const { promises: fsp } = await import("node:fs");
      await fsp.rm(target.copiedPath, { recursive: true, force: true });
    } catch (e) {
      return { ok: false, error: String(e) };
    }
    const ok = await this.copiedStore.remove(id);
    return { ok };
  }

  async deleteAllCopied(): Promise<{ deleted: number; errors: string[] }> {
    if (!this.copiedStore) return { deleted: 0, errors: ["no store"] };
    const items = await this.copiedStore.load();
    let deleted = 0;
    const errors: string[] = [];
    for (const it of items) {
      const res = await this.deleteCopied(it.id);
      if (res.ok) deleted++;
      else errors.push(`${it.folderName}: ${res.error}`);
    }
    return { deleted, errors };
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
