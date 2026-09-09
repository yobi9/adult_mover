/**
 * النقل الآمن لمجلد (البند 10/11/34/35/36).
 *
 * القواعد الإلزامية:
 * - لا استبدال مجلد موجود (تسمية فريدة _1, _2 ...).
 * - لا حذف أو إزالة المصدر كجزء من سير العمل.
 * - Same-Volume فقط عبر rename؛ Cross-Volume (EXDEV) → رفض تلقائي (لا Copy+Delete).
 * - فشل أي خطوة → إبقاء المصدر كما هو.
 */

import { promises as fsp } from "node:fs";
import path from "node:path";
import { isUnsafeSourceDestination } from "./path-guard";
import type { Logger } from "../logging/logger";

/** أسباب رفض النقل. */
export type MoveFailReason =
  | "source-missing"
  | "source-not-dir"
  | "destination-unavailable"
  | "unsafe-paths"
  | "cross-volume"
  | "io-error"
  | "aborted";

/** نتيجة محاولة النقل. */
export type MoveOutcome =
  | { ok: true; movedTo: string }
  | { ok: false; reason: MoveFailReason; detail?: string };

/** خيارات النقل (قابلة للحقن للاختبار). */
export interface MoveFolderOptions {
  /** دالة rename (افتراضياً fs.promises.rename). */
  rename?: (source: string, destination: string) => Promise<void>;
  /** يُستدعى للتحقق من طلب الإيقاف قبل بدء النقل. */
  isStopping?: () => boolean;
}

/** هل يوجد مسار؟ */
export async function pathExists(target: string): Promise<boolean> {
  try {
    await fsp.access(target);
    return true;
  } catch {
    return false;
  }
}

/** هل المسار مجلد؟ */
export async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await fsp.stat(target)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * إنشاء مجلد الوجهة تلقائياً إذا كانت الوجهة صالحة ولا وجود لها (البند 4).
 * @param dir مسار الوجهة.
 */
export async function ensureDirectoryExists(dir: string): Promise<void> {
  await fsp.mkdir(dir, { recursive: true });
}

/**
 * توليد مسار وجهة فريد: `Name`, `Name_1`, `Name_2` ...
 * لا يستبدل أبداً مساراً موجوداً.
 * @param destination مجلد الوجهة.
 * @param name الاسم المطلوب.
 * @returns المسار الفريد الجاهز.
 */
export async function uniqueTargetPath(destination: string, name: string): Promise<string> {
  const base = path.join(destination, name);
  if (!(await pathExists(base))) {
    return base;
  }
  for (let i = 1; i < 1000; i++) {
    const candidate = path.join(destination, `${name}_${i}`);
    if (!(await pathExists(candidate))) {
      return candidate;
    }
  }
  throw new Error("نطاق التسمية الفريدة استُنفد للاسم المطلوب.");
}

/** خيارات النسخ (قابلة للحقن للاختبار). */
export interface CopyFolderOptions {
  /** دالة نسخ (افتراضياً fs.promises.cp). */
  cp?: (source: string, destination: string, options: { recursive: boolean }) => Promise<void>;
  isStopping?: () => boolean;
  /** مسجل لتوثيق فشل التحقق (اختياري). */
  logger?: Logger;
}

/** نتيجة محاولة النسخ. */
export type CopyOutcome =
  | { ok: true; copiedTo: string }
  | { ok: false; reason: MoveFailReason; detail?: string };

/**
 * حساب الحجم الإجمالي لمجلد (مجموع أحجام الملفات).
 */
async function dirSize(target: string): Promise<number> {
  let total = 0;
  const entries = await fsp.readdir(target, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(target, entry.name);
    if (entry.isDirectory()) {
      total += await dirSize(full);
    } else if (entry.isFile()) {
      try {
        const st = await fsp.stat(full);
        total += st.size;
      } catch {
        /* تجاهل ملف اختفى أثناء الحساب */
      }
    }
  }
  return total;
}

/**
 * تحقق سريع للنسخة: مقارنة الحجم الإجمالي.
 * يعتبر srcSize>0 و dstSize===0 فشلاً صريحاً (وليس مجلداً فارغاً).
 * @returns true إذا تطابق الحجم.
 */
export async function verifyCopy(source: string, copied: string): Promise<boolean> {
  try {
    const [srcSize, dstSize] = await Promise.all([dirSize(source), dirSize(copied)]);
    if (srcSize > 0 && dstSize === 0) return false;
    return srcSize === dstSize;
  } catch {
    return false;
  }
}

/**
 * تحويل خطأ نظامي في النسخ إلى رسالة عربية واضحة.
 */
function copyErrorDetail(error: unknown, target: string): string {
  const code = (error as NodeJS.ErrnoException)?.code;
  const msg = errorMessage(error);
  switch (code) {
    case "EACCES":
    case "EPERM":
      return `فشل النسخ: لا توجد صلاحية كتابة على الوجهة — ${target} (${msg})`;
    case "ENOENT":
      return `فشل النسخ: المصدر أو الوجهة غير موجودة — ${target} (${msg})`;
    case "ENAMETOOLONG":
      return `فشل النسخ: المسار طويل جداً — ${target} (${msg})`;
    case "ENOSPC":
      return `فشل النسخ: لا توجد مساحة كافية على القرص — ${target} (${msg})`;
    default:
      if (code) return `فشل النسخ: خطأ نظامي ${code} — ${target} (${msg})`;
      return `فشل النسخ: ${msg} → ${target}`;
  }
}

/**
 * نسخ مجلد كامل بأمان (يبقي المصدر).
 * @param source مسار مجلد المصدر.
 * @param destination مجلد الوجهة.
 * @param name اسم الوجهة.
 */
export async function copyFolder(
  source: string,
  destination: string,
  name: string,
  options: CopyFolderOptions = {}
): Promise<CopyOutcome> {
  const isStopping = options.isStopping ?? (() => false);

  if (isStopping()) {
    return { ok: false, reason: "aborted", detail: "تم طلب الإيقاف قبل بدء النسخ." };
  }

  if (!(await pathExists(source))) {
    return { ok: false, reason: "source-missing", detail: source };
  }
  if (!(await isDirectory(source))) {
    return { ok: false, reason: "source-not-dir", detail: source };
  }

  try {
    await ensureDirectoryExists(destination);
  } catch (error) {
    return { ok: false, reason: "destination-unavailable", detail: errorMessage(error) };
  }

  if (isUnsafeSourceDestination(source, destination)) {
    return { ok: false, reason: "unsafe-paths", detail: `${source} ↔ ${destination}` };
  }

  let target: string;
  try {
    target = await uniqueTargetPath(destination, name);
  } catch (error) {
    return { ok: false, reason: "io-error", detail: errorMessage(error) };
  }

  if (isStopping()) {
    return { ok: false, reason: "aborted", detail: "تم طلب الإيقاف قبل بدء النسخ." };
  }

  const cp = options.cp ?? ((s: string, d: string, o: { recursive: boolean }) => fsp.cp(s, d, o));
  try {
    await cp(source, target, { recursive: true });
  } catch (error) {
    return { ok: false, reason: "io-error", detail: copyErrorDetail(error, target) };
  }

  const verified = await verifyCopy(source, target);
  if (!verified) {
    // تسجيل الأحجام للتشخيص
    let srcSize = -1;
    let dstSize = -1;
    try {
      [srcSize, dstSize] = await Promise.all([dirSize(source), dirSize(target)]);
    } catch {}
    options.logger?.error(
      `فشل التحقق من النسخة: srcSize=${srcSize} dstSize=${dstSize} — المصدر: ${source} → الوجهة: ${target}`
    );
    // حالة src ممتلئ و dest فارغ → رسالة أدق
    if (srcSize > 0 && dstSize === 0) {
      return { ok: false, reason: "io-error", detail: `فشل النسخ: اكتملت عملية النسخ لكن الوجهة فارغة (src=${srcSize} dst=${dstSize}) — ${target}` };
    }
    return { ok: false, reason: "io-error", detail: `فشل التحقق من النسخة: src=${srcSize} dst=${dstSize} — ${target}` };
  }

  return { ok: true, copiedTo: target };
}

/** هل الخطأ يشير إلى عبور بين مجلدات مختلفة (EXDEV)؟ */
function isCrossDeviceError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as NodeJS.ErrnoException).code === "EXDEV";
}

/** استخراج رسالة خطأ آمنة. */
function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * نقل مجلد كامل بأمان.
 * @param source مسار مجلد المصدر.
 * @param destination مجلد الوجهة.
 * @param name اسم الوجهة (المجلد النهائي داخل الوجهة).
 * @param options خيارات الحقن.
 * @returns نتيجة النقل.
 */
export async function moveFolder(
  source: string,
  destination: string,
  name: string,
  options: MoveFolderOptions = {}
): Promise<MoveOutcome> {
  const isStopping = options.isStopping ?? (() => false);

  if (isStopping()) {
    return { ok: false, reason: "aborted", detail: "تم طلب الإيقاف قبل بدء النقل." };
  }

  if (!(await pathExists(source))) {
    return { ok: false, reason: "source-missing", detail: source };
  }
  if (!(await isDirectory(source))) {
    return { ok: false, reason: "source-not-dir", detail: source };
  }

  try {
    await ensureDirectoryExists(destination);
  } catch (error) {
    return { ok: false, reason: "destination-unavailable", detail: errorMessage(error) };
  }

  if (isUnsafeSourceDestination(source, destination)) {
    return { ok: false, reason: "unsafe-paths", detail: `${source} ↔ ${destination}` };
  }

  let target: string;
  try {
    target = await uniqueTargetPath(destination, name);
  } catch (error) {
    return { ok: false, reason: "io-error", detail: errorMessage(error) };
  }

  if (isStopping()) {
    return { ok: false, reason: "aborted", detail: "تم طلب الإيقاف قبل بدء النقل." };
  }

  const rename = options.rename ?? fsp.rename;
  try {
    await rename(source, target);
    return { ok: true, movedTo: target };
  } catch (error) {
    if (isCrossDeviceError(error)) {
      return {
        ok: false,
        reason: "cross-volume",
        detail: "النقل بين مجلدات مختلفة يتطلب تأكيداً صريحاً ولا يُنفَّذ تلقائياً.",
      };
    }
    return {
      ok: false,
      reason: "io-error",
      detail: `${errorMessage(error)} → ${target}`,
    };
  }
}