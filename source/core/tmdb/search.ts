/**
 * استعلامات البحث عن الأفلام والمسلسلات عبر TMDB (البند 19/17).
 */

import type { TmdbClient } from "./client";

/** نتيجة بحث واحدة (شكل موحّد للفيلم/المسلسل). */
export interface SearchItem {
  tmdbId: number;
  name: string;
  originalName: string;
  year: number | null;
  popularity: number;
  mediaType: "movie" | "tv";
}

interface TmdbResultRow {
  id?: number;
  name?: string;
  original_name?: string;
  title?: string;
  original_title?: string;
  first_air_date?: string;
  release_date?: string;
  popularity?: number;
}

interface TmdbSearchResponse {
  results?: TmdbResultRow[];
}

/** استخراج السنة من سلسلة تاريخ (yyyy-mm-dd). */
function yearOfDate(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const match = /(?:19|20)\d{2}/.exec(value);
  return match ? Number(match[0]) : null;
}

/** تحويل صف استجابة إلى SearchItem موحّد. */
function toSearchItem(
  row: TmdbResultRow,
  mediaType: "movie" | "tv"
): SearchItem | null {
  const name = (row.name ?? row.title ?? row.original_name ?? row.original_title ?? "").trim();
  if (!name) {
    return null;
  }
  const id = row.id;
  if (!id) {
    return null;
  }
  return {
    tmdbId: id,
    name,
    originalName: (row.original_name ?? row.original_title ?? name).trim(),
    year: yearOfDate(row.first_air_date ?? row.release_date),
    popularity: row.popularity ?? 0,
    mediaType,
  };
}

/**
 * البحث عن مسلسل عبر /search/tv (البند 17).
 * @param client عميل TMDB.
 * @param title اسم البحث.
 * @param year السنة المستخرجة إن وجدت (تحسين التطابق).
 * @returns قائمة نتائج غير فارغة.
 */
export async function searchTV(
  client: TmdbClient,
  title: string,
  year: number | null
): Promise<SearchItem[]> {
  const data = await client.request<TmdbSearchResponse>("/search/tv", {
    query: title,
    first_air_date_year: year ?? undefined,
    language: "en-US",
  });
  return (data.results ?? []).map((row) => toSearchItem(row, "tv")).filter((r) => r !== null);
}

/**
 * البحث عن فيلم عبر /search/movie (البند 19).
 * @param client عميل TMDB.
 * @param title اسم البحث.
 * @param year السنة المستخرجة إن وجدت.
 * @returns قائمة نتائج غير فارغة.
 */
export async function searchMovie(
  client: TmdbClient,
  title: string,
  year: number | null
): Promise<SearchItem[]> {
  const data = await client.request<TmdbSearchResponse>("/search/movie", {
    query: title,
    year: year ?? undefined,
    include_adult: true,
    language: "en-US",
  });
  return (data.results ?? [])
    .map((row) => toSearchItem(row, "movie"))
    .filter((r) => r !== null);
}