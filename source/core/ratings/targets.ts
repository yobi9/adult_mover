/**
 * التصنيفات العمرية المستهدفة (البند 21) وقرارات النقل.
 */

import { normalizeRating } from "./normalization";

/** التصنيفات المستهدفة بالشكل القياسي (بعد التطبيع). */
export const TARGET_RATINGS: readonly string[] = ["tvma", "r", "nc17", "x", "18", "adult"];

/**
 * هل التصنيف مدرج في قائمة التصنيفات المستهدفة للكبار؟
 * القرار يعتمد على التصنيف من TMDB فقط، ولا ينظر لاسم المجلد إطلاقاً (Fail Closed).
 * @param rating التصنيف القياسي أو الخام أو null.
 * @returns true إذا كان التصنيف مستهدفاً.
 */
export function isTargetRating(rating: string | null | undefined): boolean {
  if (!rating) {
    return false;
  }
  return TARGET_RATINGS.includes(normalizeRating(rating));
}