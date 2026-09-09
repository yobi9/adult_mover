/**
 * حماية المسارات: كشف المصادر الخطرة ومنع النقل غير الآمن (البند 31/36/32).
 *
 * كل المقارنات:
 * - غير حساسة لحالة الأحرف (Windows).
 * - متعادلة البنية عبر path.win32 (دعم UNC دون افتراض حرف Drive).
 * - لا تتعامل مع نسبية/مطلقة إلا بعد تطبيع.
 */

import path from "node:path";

/**
 * تطبيع مسار للمقارنة: شرطة موحّدة، أحرف صغيرة، إزالة أشرطة زائدة.
 * يُحافظ على البادئة المزدوجة في UNC (//server/share).
 * @param input المسار الخام.
 * @returns المسار المُطيَّن للمقارنة أو "" عند الفراغ.
 */
export function normalizePath(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return "";
  }
  let normalized = path.win32.normalize(trimmed).replace(/\\/g, "/");
  if (normalized.length > 3) {
    normalized = normalized.replace(/\/+$/, "");
  }
  return normalized.toLowerCase();
}

/** تقسيم المسار المُطيَّن إلى مقطع. */
function segments(input: string): string[] {
  const normalized = normalizePath(input);
  if (!normalized) {
    return [];
  }
  const isUnc = normalized.startsWith("/");
  let body = normalized;
  if (isUnc) {
    body = body.replace(/^\/+/, "");
  }
  return body.split("/").filter((s) => s.length > 0);
}

/**
 * هل المساران متطابقان (نفس الموقع)؟
 * @param a المسار الأول.
 * @param b المسار الثاني.
 * @returns true عند التطابق.
 */
export function isSamePath(a: string, b: string): boolean {
  return segments(a).join("/") === segments(b).join("/");
}

/**
 * هل «inner» يقع داخل «outer» (وليس مساوياً له)؟
 * @param inner المسار الداخلي المحتمل.
 * @param outer الجذر الخارجي المحتمل.
 * @returns true إذا كان inner بادئة كاملة أطول من outer.
 */
export function isPathInside(inner: string, outer: string): boolean {
  const outerSegments = segments(outer);
  const innerSegments = segments(inner);
  if (outerSegments.length === 0 || innerSegments.length <= outerSegments.length) {
    return false;
  }
  return outerSegments.every((part, index) => part === innerSegments[index]);
}

/**
 * كشف تكوين خطير بين المصدر والوجهة:
 * - الوجهة نفسها هي المصدر.
 * - المصدر داخل الوجهة.
 * - الوجهة داخل المصدر.
 * @param source مسار المصدر.
 * @param destination مسار الوجهة.
 * @returns true إذا كان التكوين غير آمن (يُمنع النقل).
 */
export function isUnsafeSourceDestination(source: string, destination: string): boolean {
  if (!source.trim() || !destination.trim()) {
    return false; // لا يمكن الحكم على مسار فارغ من هنا (يُتحقق منه في مواضع أخرى).
  }
  if (isSamePath(source, destination)) {
    return true;
  }
  if (isPathInside(source, destination)) {
    return true;
  }
  if (isPathInside(destination, source)) {
    return true;
  }
  return false;
}