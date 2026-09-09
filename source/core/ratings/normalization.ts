/**
 * تطبيع التصنيفات العمرية (البند 21).
 *
 * الهدف: معاملة نفس التصنيف مهما اختلفت صيغته:
 * - tv-ma / TV-MA / " TV-MA" / TVMA  →  tvma
 * - 18+ / 18                          →  18
 * - NC-17 / NC17                      →  nc17
 */

/**
 * يُطبيع تصنيفاً عمرياً إلى شكل قياسي واحد (`tvma`, `r`, `nc17`, `x`, `18`, `adult`...).
 * - يزيل المسافات البادئة/اللاحقة وأي رموز غير أبجدية رقمية.
 * - يحوّل الأحرف إلى صغيرة.
 * @param input التصنيف الخام أو null/فارغ.
 * @returns الصيغة القياسية أو سلسلة فارغة عند غياب التصنيف.
 */
export function normalizeRating(input: string | null | undefined): string {
  if (!input) {
    return "";
  }
  return input.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}