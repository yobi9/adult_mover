/**
 * تعريف امتدادات الفيديو المستهدفة وأدوات التحقق (البند 8).
 */

import path from "node:path";

/** امتدادات الفيديو المستهدفة (الصيغة الأصلية بحسب البند 8). */
export const VIDEO_EXTENSIONS: readonly string[] = [
  ".mp4",
  ".mkv",
  ".avi",
  ".mov",
  ".wmv",
  ".flv",
  ".webm",
];

/** مجموعة الامتدادات غير الحساسة لحالة الأحرف. */
export const VIDEO_EXTENSION_SET: ReadonlySet<string> = new Set(VIDEO_EXTENSIONS);

/**
 * هل اسم الملف ملف فيديو مستهدف؟ (غير حساس لحالة الأحرف).
 * @param name اسم الملف.
 * @returns true إذا كان الامتداد مضموماً في القائمة.
 */
export function isVideoFile(name: string): boolean {
  return VIDEO_EXTENSION_SET.has(path.extname(name).toLowerCase());
}