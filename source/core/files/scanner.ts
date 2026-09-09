/**
 * فحص مجلدات المصدر وتحديد «مجلدات المحتوى» (البند 9).
 *
 * مجلد المحتوى (Media Root) = مجلد يمثّل عملاً واحداً يُنقل كوحدة كاملة:
 * - مجلد يحتوي مباشرةً على ملف فيديو مستهدف (فيلم / مسلسل مسطّح)، أو
 * - جذر سلسلة: لا فيديو مباشر، لكن أبناءه المباشرون «حاويات مواسم».
 * حاوية الموسم (Season Container) = اسم يحلّ إلى موسم/حلقة دون عنوان باقٍ
 * (الموسم 01 / Season 1 / S02 / S01E01 ...) → تُستثنى ولا يُغاص فيها.
 * عند اكتشاف أي Media Root يُدرج كما هو ولا ندخل إليه (نقل كامل على مستوى المجلد).
 * خطأ في مجلد واحد لا يُسقط الفحص كله.
 */

import { promises as fsp } from "node:fs";
import path from "node:path";
import { parseMediaName } from "../media-parser/parser";
import { isVideoFile } from "./types";

/** خطأ فحص داخل مصدر. */
export interface ScanError {
  dir: string;
  reason: string;
}

/** نتيجة فحص مصدر. */
export interface ScanResult {
  folders: string[];
  errors: ScanError[];
}

/** خيارات الفحص. */
export interface ScanSourceOptions {
  recursive: boolean;
  maxDepth?: number;
}

/** أقصى عمق للدخول المتكرر (حماية من أعماق/حلقات غير متوقعة). */
const DEFAULT_MAX_DEPTH = 20;

/** استخراج رسالة خطأ آمنة. */
function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * هل اسم المجلد «حاوية موسم» (لا عنوان Media حقيقي بعده)؟
 * نعيد استعمال منطق الـ parser ذاته: موسم/حلقة مستخرَجة ولا يتبقّى عنوان.
 * أمثلة: الموسم 01 / Season 1 / S02 / S01E01 → نعم. ما يبقي عنواناً (مثل
 * «Game of Thrones Season 1») → لا.
 */
function isSeasonContainer(folderName: string): boolean {
  const parsed = parseMediaName(folderName);
  return parsed.title === "" && parsed.isSeriesHint;
}

/**
 * فحص مجلد مصدر وإرجاع قائمة مجلدات المحتوى (وأخطاء منفصلة).
 * @param sourcePath مسار المصدر.
 * @param options خيارات الفحص (متكرر/لا).
 * @returns مجلدات المحتوى والأخطاء.
 */
export async function scanSource(
  sourcePath: string,
  options: ScanSourceOptions
): Promise<ScanResult> {
  const folders: string[] = [];
  const errors: ScanError[] = [];
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > maxDepth) {
      return;
    }
    let children: import("node:fs").Dirent[];
    try {
      children = await fsp.readdir(dir, { withFileTypes: true, encoding: "utf8" });
    } catch (error) {
      errors.push({ dir, reason: errorMessage(error) });
      return;
    }

    // 1) حاوية موسم (الموسم 01 / Season 1 / S02 / S01E01 ...):
    //    ليست مرشّحاً ولا نغوص فيها — تُنقل ضمن جذر السلسلة.
    if (depth >= 1 && isSeasonContainer(path.basename(dir))) {
      return;
    }

    const hasVideo = children.some((child) => child.isFile() && isVideoFile(child.name));
    if (hasVideo) {
      folders.push(dir);
      return; // محتوى كامل: لا نغوص داخل مجلدات المحتوى.
    }

    // 2) جذر سلسلة: لا فيديو مباشر، لكن الأبناء المباشرون حاويات مواسم
    //    (فحص الأسماء فقط دون الدخول فيهم). لا نضمّن المواسم كمرشّحين.
    const hasSeasonChild =
      depth >= 1 &&
      children.some((child) => child.isDirectory() && isSeasonContainer(child.name));
    if (hasSeasonChild) {
      folders.push(dir);
      return; // لا ندخل المواسم: الجذر يُنقل كوحدة كاملة.
    }

    // 3) الفحص غير المتكرر: نغوص مستوىً واحداً فقط عن المصدر لفحص المرشحين المباشرين.
    if (!options.recursive && depth >= 1) {
      return;
    }

    for (const child of children) {
      if (child.isDirectory()) {
        await walk(path.join(dir, child.name), depth + 1);
      }
    }
  };

  await walk(sourcePath, 0);
  return { folders, errors };
}