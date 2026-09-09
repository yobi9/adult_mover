/**
 * منسّق وظيفة الفحص والتصنيف والنقل (خط المعالجة الكامل، البند 23).
 *
 * المسؤوليات:
 * - فحص المصادر وتسجيل الأخطاء دون إسقاط الوظيفة.
 * - لكل مجلد: تحليل الاسم → تصنيف TMDB → قرار → نقل (إن كان MOVE).
 * - إيقاف آمن (يكمل المجلد الحالي ثم يتوقف).
 * - رصد أخطاء مفتاح API (401/403) لإيقاف الوظيفة كاملة (البند 26).
 * - إحصاءات اللحظة وإشعارات الحالة للمستمع.
 */

import { TmdbApiError } from "../tmdb/client";
import { parseMediaName } from "../media-parser/parser";
import { determineDecision, type FolderContext } from "./decision";
import { createStatsTracker, type StatsTracker } from "./stats";
import type { StopSignal } from "./stop";
import type { Decision, JobConfig, JobPhase, RatingResult, Stats } from "../types";
import type { Logger } from "../logging/logger";
import type { ScanResult } from "../files/scanner";
import type { MoveOutcome, MoveFolderOptions } from "../files/mover";
import path from "node:path";

/** بوابة التصنيف القابلة للحقن للاختبار. */
export interface RatingGateway {
  getRating: (title: string, year: number | null) => Promise<RatingResult>;
}

/** توقيع فحص المصدر (متوافق مع scanSource). */
export type ScanSourceFn = (source: string, options: { recursive: boolean }) => Promise<ScanResult>;

/** توقيع نقل المجلد (متوافق مع moveFolder). */
export type MoveFolderFn = (
  source: string,
  destination: string,
  name: string,
  options?: MoveFolderOptions
) => Promise<MoveOutcome>;

/** خيارات التحقق من الوجود في الوجهة (تُحسب بمستوى أعلى). */
export type IsAtDestinationFn = (folderPath: string) => Promise<boolean>;

/** مستمعا أحداث السلسلة. */
export interface PipelineCallbacks {
  onPhase?: (phase: JobPhase) => void;
  onStats?: (stats: Stats) => void;
  onDecision?: (folder: string, decision: Decision) => void;
}

/** خيارات تشغيل الوظيفة. */
export interface PipelineOptions {
  config: JobConfig;
  stop: StopSignal;
  logger: Logger;
  getRating: RatingGateway;
  scanSource: ScanSourceFn;
  moveFolder: MoveFolderFn;
  isAtDestination?: IsAtDestinationFn;
  callbacks?: PipelineCallbacks;
}

/** نتيجة تشغيل الوظيفة. */
export interface PipelineResult {
  phase: "complete" | "aborted";
  stats: Stats;
  stopped: boolean;
}

/** حقائق مجلد المصدر (تُفحص قبل استعلام الشبكة). */
async function folderFacts(folderPath: string): Promise<FolderContext> {
  const { pathExists, isDirectory } = await import("../files/mover");
  const exists = await pathExists(folderPath);
  const isDir = await isDirectory(folderPath);
  return { exists, isDirectory: isDir, alreadyAtDestination: false };
}

/**
 * تشغيل وظيفة كاملة.
 * @param options خيارات الوظيفة.
 * @returns النتيجة النهائية.
 */
export async function runScanJob(options: PipelineOptions): Promise<PipelineResult> {
  const { config, stop, logger, getRating, scanSource, moveFolder } = options;
  const callbacks = options.callbacks ?? {};
  const tracker: StatsTracker = createStatsTracker(callbacks.onStats);
  const setPhase = (phase: JobPhase): void => callbacks.onPhase?.(phase);
  const markDecision = (folder: string, decision: Decision): void =>
    callbacks.onDecision?.(folder, decision);
  const isAtDestination = options.isAtDestination ?? (async () => false);

  if (stop.stopRequested()) {
    setPhase("stopped");
    return { phase: "aborted", stats: tracker.snapshot(), stopped: true };
  }

  setPhase("scanning");

  // 1) فحص المصادر وتسجيل المجلدات المرشحة.
  const folders: string[] = [];
  for (const source of config.sources) {
    if (stop.stopRequested()) {
      break;
    }
    const result = await scanSource(source, { recursive: config.recursive });
    for (const error of result.errors) {
      logger.warn(`خطأ في الفحص عند [${error.dir}]: ${error.reason}`);
      tracker.incErrors();
      callbacks.onStats?.(tracker.snapshot());
    }
    for (const folder of result.folders) {
      if (!folders.includes(folder)) {
        folders.push(folder);
      }
    }
    logger.info(`تم فحص المصدر [${source}] → ${result.folders.length} مجلداً مرشحاً.`);
  }

  setPhase("parsing");

  // 2) معالجة كل مجلد مرشح.
  for (const folder of folders) {
    if (stop.stopRequested()) {
      logger.warn("تم إيقاف الوظيفة عند طلب المستخدم (بعد اكتمال المجلد الحالي).");
      setPhase("stopped");
      return { phase: "aborted", stats: tracker.snapshot(), stopped: true };
    }

    tracker.incProcessed();
    callbacks.onStats?.(tracker.snapshot());

    const folderName = path.basename(folder);
    const parsed = parseMediaName(folderName);
    logger.info(`- المجلد [${folderName}] → الاسم: "${parsed.title}" (${parsed.year ?? "-"})`);

    // 2أ) فحص وجود المصدر قبل الإنفاق على شبكة.
    const facts = await folderFacts(folder);
    if (!facts.exists || !facts.isDirectory) {
      const decision = determineDecision(
        { rating: null, mediaType: "unknown", tmdbId: null, confidence: 0, state: "error" },
        { ...facts, alreadyAtDestination: false }
      );
      tracker.incErrors();
      markDecision(folder, decision);
      logger.error(`[${folderName}] ${decision.reason}: ${decision.details ?? ""}`);
      continue;
    }

    // 2ب) الاستعلام عن التصنيف (TV ثم Movie).
    let rating: RatingResult;
    try {
      setPhase("searching");
      rating = await getRating.getRating(parsed.title, parsed.year);
    } catch (error) {
      if (isAuthError(error)) {
        logger.error(`خطأ مصادقة TMDB — إيقاف الوظيفة كاملة: ${safeMessage(error)}`);
        setPhase("aborted");
        return { phase: "aborted", stats: tracker.snapshot(), stopped: false };
      }
      tracker.incErrors();
      const decision = determineDecision(
        { rating: null, mediaType: "unknown", tmdbId: null, confidence: 0, state: "error" },
        facts
      );
      markDecision(folder, decision);
      logger.error(`[${folderName}] فشل تصنيف TMDB: ${safeMessage(error)}`);
      continue;
    }

    // 2ج) قرار Fail Closed.
    const already = await isAtDestination(folder);
    const decision = determineDecision(rating, { ...facts, alreadyAtDestination: already });
    markDecision(folder, decision);

    if (decision.outcome === "MOVE") {
      setPhase("moving");
      const moveOutcome = await moveFolder(folder, config.destination, folderName, {
        isStopping: stop.stopRequested,
      });
      if (moveOutcome.ok) {
        tracker.incMoved();
        logger.info(`نُقل إلى: ${moveOutcome.movedTo}`);
      } else {
        tracker.incErrors();
        const fail = decisionForMoveFailure(moveOutcome);
        markDecision(folder, fail);
        logger.error(`[${folderName}] فشل النقل: ${moveOutcome.detail ?? moveOutcome.reason}`);
      }
    } else if (decision.outcome === "SKIP") {
      tracker.incSkipped();
      logger.info(`[${folderName}] تُجُوِّز: ${decision.details ?? decision.reason}`);
    } else {
      tracker.incErrors();
      logger.error(`[${folderName}] ${decision.details ?? decision.reason}`);
    }

    callbacks.onStats?.(tracker.snapshot());
  }

  setPhase("complete");
  logger.info(`اكتملت الوظيفة: ${tracker.snapshot().processed} مجلداً تمت معالجتها.`);
  return { phase: "complete", stats: tracker.snapshot(), stopped: false };
}

/** تحويل فشل النقل إلى قرار ERROR بوصفه دقيقاً. */
function decisionForMoveFailure(outcome: MoveOutcome & { ok: false }): Decision {
  return {
    outcome: "ERROR",
    reason: outcome.reason === "cross-volume" ? "move-cross-volume" : "move-failed",
    details: outcome.detail,
  };
}

/** هل الخطأ خطأ مصادقة (401/403) يستوجب إيقاف الوظيفة؟ (البند 26). */
function isAuthError(error: unknown): boolean {
  return error instanceof TmdbApiError && error.kind === "auth";
}

/** رسالة خطأ آمنة الضبابية (لا تسريب لمفتاح). */
function safeMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}