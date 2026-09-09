/**
 * الدالة المركزية للتصنيف (المكافئ العملي لـ get_media_rating، البند 16-20).
 *
 * التسلسل:
 * 1. البحث عن مسلسل (/search/tv) مع التحقق من التطابق (البند 17).
 * 2. التصنيف عبر /tv/{id}/content_ratings (أولوية US ثم بديل مُسجَّل) (البند 18).
 * 3. إذا لم يُعثر على مسلسل مناسب → البحث عن فيلم (/search/movie) (البند 19).
 * 4. التصنيف عبر /movie/{id}/release_dates (US certification أولاً) (البند 20).
 *
 * Fail Closed: عند أي غموض نرجع حالة تمنع النقل.
 */

import type { TmdbClient } from "./client";
import { TmdbApiError } from "./client";
import { searchTV, searchMovie, type SearchItem } from "./search";
import { pickBest } from "./ranking";
import type { RatingResult } from "../types";
import type { Logger } from "../logging/logger";

/** سياق استعلام التصنيف. */
export interface MediaRatingContext {
  title: string;
  year: number | null;
  apiKey: string;
  logger: Logger;
}

/** نتيجة التصنيف من نقطة التفاصيل. */
interface RatingLookup {
  rating: string | null;
  sourceCountry: string | null;
}

/** قراءة التصنيفات من استجابة content_ratings للمسلسل. */
interface TvRatingsResponse {
  results?: Array<{ iso_3166_1?: string; rating?: string }>;
}

/** قراءة التصنيف من استجابة release_dates للفيلم. */
interface ReleaseDatesResponse {
  results?: Array<{
    iso_3166_1?: string;
    release_dates?: Array<{ certification?: string }>;
  }>;
}

/** الحصول على أول قيمة غير فارغة (مع أولوية US). */
function firstRating(
  rows: ReadonlyArray<{ country: string; value: string }>,
  logger: Logger
): RatingLookup {
  const usEntry = rows.find((row) => row.country === "US");
  if (usEntry) {
    return { rating: usEntry.value, sourceCountry: "US" };
  }
  const fallback = rows[0];
  if (fallback) {
    logger.info(`التصنيف البديل المستخدم: ${fallback.country} (لا يوجد تصنيف US)`);
    return { rating: fallback.value, sourceCountry: fallback.country };
  }
  logger.warn("المحتوى موجود، لكن التصنيف العمري غير متوفر.");
  return { rating: null, sourceCountry: null };
}

/** تصنيف مسلسل عبر /tv/{id}/content_ratings. */
async function tvCertification(
  client: TmdbClient,
  tmdbId: number,
  logger: Logger
): Promise<RatingLookup> {
  let data: TvRatingsResponse;
  try {
    data = await client.request<TvRatingsResponse>(`/tv/${tmdbId}/content_ratings`);
  } catch (error) {
    if (error instanceof TmdbApiError && error.kind === "not-found") {
      logger.warn("لا توجد بيانات تصنيف للمسلسل (404).");
      return { rating: null, sourceCountry: null };
    }
    throw error;
  }
  const rows = (data.results ?? [])
    .map((r) => ({ country: r.iso_3166_1 ?? "", value: (r.rating ?? "").trim() }))
    .filter((r) => r.country !== "" && r.value !== "");
  return firstRating(rows, logger);
}

/** تصنيف فيلم عبر /movie/{id}/release_dates. */
async function movieCertification(
  client: TmdbClient,
  tmdbId: number,
  logger: Logger
): Promise<RatingLookup> {
  let data: ReleaseDatesResponse;
  try {
    data = await client.request<ReleaseDatesResponse>(`/movie/${tmdbId}/release_dates`);
  } catch (error) {
    if (error instanceof TmdbApiError && error.kind === "not-found") {
      logger.warn("لا توجد بيانات تصنيف للفيلم (404).");
      return { rating: null, sourceCountry: null };
    }
    throw error;
  }
  const rows: Array<{ country: string; value: string }> = [];
  for (const result of data.results ?? []) {
    const country = result.iso_3166_1 ?? "";
    for (const release of result.release_dates ?? []) {
      const value = (release.certification ?? "").trim();
      if (country !== "" && value !== "") {
        rows.push({ country, value });
      }
    }
  }
  return firstRating(rows, logger);
}

/** تحويل نتيجة بحث إلى مصدر RatingsResult عبر التصنيف المناسب. */
function toResult(
  search: SearchItem,
  lookup: RatingLookup,
  confidence: number
): RatingResult {
  return {
    rating: lookup.rating,
    mediaType: search.mediaType === "tv" ? "series" : "movie",
    tmdbId: search.tmdbId,
    confidence,
    state: lookup.rating ? "found" : "no-rating",
  };
}

/**
 * استعلام التصنيف المركزي: TV أولاً ثم Movie.
 * @param client عميل TMDB.
 * @param context سياق الاستعلام (الاسم، السنة، المفتاح، السجل).
 * @returns RatingResult يحدد الإجراء (نقل/تخطي) لاحقاً دون تجاوز Fail Closed.
 */
export async function getMediaRating(
  client: TmdbClient,
  context: MediaRatingContext
): Promise<RatingResult> {
  const { title, logger } = context;

  // 1) بحث عن مسلسل
  const tvResults = await searchTV(client, title, context.year);
  const tvBest = pickBest(title, context.year, tvResults);
  if (tvBest) {
    logger.info("النوع: TV Series");
    const lookup = await tvCertification(client, tvBest.item.tmdbId, logger);
    return toResult(tvBest.item, lookup, tvBest.confidence);
  }

  // 2) بحث عن فيلم
  const movieResults = await searchMovie(client, title, context.year);
  const movieBest = pickBest(title, context.year, movieResults);
  if (movieBest) {
    logger.info("النوع: Movie");
    const lookup = await movieCertification(client, movieBest.item.tmdbId, logger);
    return toResult(movieBest.item, lookup, movieBest.confidence);
  }

  logger.warn(`لم يُعثر على نتيجة موثوقة في TMDB.`);
  return {
    rating: null,
    mediaType: "unknown",
    tmdbId: null,
    confidence: 0,
    state: "not-found",
  };
}