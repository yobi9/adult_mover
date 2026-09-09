/**
 * قرار معالجة مجلد واحد (البند 23-24).
 *
 * Fail Closed: لا ننقل إلا عندما يحسم TMDB أن التصنيف من قائمة الهدف
 * وأن الثقة فوق العتبة. أي حالة أخرى → SKIP أو ERROR.
 */

import type { Decision, Outcome, RatingResult } from "../types";
import { isTargetRating } from "../ratings/targets";
import { CONFIDENCE_THRESHOLD } from "../tmdb/ranking";

/** حقائق المجلد التي تمثلها القرارات (تُفحص في السلسلة قبل/أثناء). */
export interface FolderContext {
  /** هل مجلد المصدر ما زال موجوداً؟ */
  exists: boolean;
  /** هل هو مجلد وليس ملفاً؟ */
  isDirectory: boolean;
  /** هل هو موجود أصلاً داخل الوجهة المستهدفة؟ */
  alreadyAtDestination: boolean;
}

/** تسمية نوع المحتوى للتقارير. */
function typeLabel(state: RatingResult["mediaType"]): string {
  return state === "series" ? "TV Series" : state === "movie" ? "Movie" : "Unknown";
}

/**
 * تحويل نتيجة تصنيف + حال مجلد إلى قرار نهائي.
 * @param rating نتيجة تصنيف TMDB.
 * @param folder حالت مجلد المصدر.
 * @returns قرار MOVE أو SKIP أو ERROR مع السبب وجزء تفاصيل.
 */
export function determineDecision(rating: RatingResult, folder: FolderContext): Decision {
  const base = (outcome: Outcome, reason: string, details?: string): Decision => ({
    outcome,
    reason,
    details,
  });

  if (!folder.exists || !folder.isDirectory) {
    return base("ERROR", "source-missing", "مجلد المصدر غير موجود أو ليس مجلداً.");
  }
  if (folder.alreadyAtDestination) {
    return base("SKIP", "already-at-destination", "المحتوى موجود فعلاً داخل الوجهة.");
  }

  switch (rating.state) {
    case "error":
      return base("ERROR", "tmdb-error", "فشل استعلام التصنيف بعد المحاولات المتكررة.");
    case "not-found":
      return base("SKIP", "not-found", `لم يُعثر على تطابق في ${typeLabel(rating.mediaType)}.`);
    case "no-rating":
      return base("SKIP", "no-rating", `التصنيف العمري غير متوفر (${typeLabel(rating.mediaType)}).`);
    case "found": {
      const value = rating.rating ?? "";
      if (value === "") {
        return base("SKIP", "no-rating", `التصنيف العمري غير متوفر (${typeLabel(rating.mediaType)}).`);
      }
      if (!isTargetRating(value)) {
        return base("SKIP", "rating-not-target", `التصنيف "${value}" خارج القائمة المستهدفة.`);
      }
      if (rating.confidence < CONFIDENCE_THRESHOLD) {
        return base(
          "SKIP",
          "low-confidence",
          `ثقة منخفضة (${rating.confidence.toFixed(2)}) دون العتبة ${CONFIDENCE_THRESHOLD}.`
        );
      }
      return base("MOVE", "adult", `تصنيف "${value}" ضمن القائمة المستهدفة.`);
    }
  }
}