/**
 * طبقة استخراج الاسم الحقيقي للمحتوى من اسم المجلد الخام (البند 12/13/14).
 *
 * أمثلة:
 * - Breaking.Bad.S05.1080p.WEB-DL  →  { title: "Breaking Bad", season: 5 }
 * - The.Matrix.1999.2160p.BluRay   →  { title: "The Matrix", year: 1999 }
 * - Game.of.Thrones.Season.01.1080p → { title: "Game of Thrones", season: 1 }
 * - Pulp.Fiction.(1994).1080p      →  { title: "Pulp Fiction", year: 1994 }
 */

import { TECHNICAL_TOKEN_SET, TECHNICAL_PHRASES, normalizeToken } from "./tokens";

/** نتيجة تحليل اسم مجلد. */
export interface ParsedMedia {
  /** الاسم النظيف الجاهز للبحث في TMDB. */
  title: string;
  /** السنة المستخرجة إن وُجدت (يُحسّن البحث في TMDB). */
  year: number | null;
  /** رقم الموسم إن وُجد (يميّز سلسلة). */
  season: number | null;
  /** نطاق الحلقات [بداية، نهاية] إن وُجد (S01E01-E03). */
  episodes: readonly [number, number] | null;
  /** هل يَلمح الاسم إلى أنه مسلسل (موسم/حلقة)؟ */
  isSeriesHint: boolean;
}

const FULL_YEAR_TOKEN = /^(19|20)\d{2}$/;
const SEASON_TOKEN = /^s(\d{1,2})$/i;
const EPISODE_TOKEN = /^(?:e|ep|episode)(\d{1,2})$/i;

/** خرائط الأعداد الترتيبية العربية (بدون أداة التعريف) إلى أرقام. */
const ARABIC_ORDINALS: ReadonlyMap<string, number> = new Map([
  ["اول", 1],
  ["ثاني", 2],
  ["ثالث", 3],
  ["رابع", 4],
  ["خامس", 5],
  ["سادس", 6],
  ["سابع", 7],
  ["ثامن", 8],
  ["تاسع", 9],
  ["عاشر", 10],
]);

/**
 * يحذف محتوى الأقواس المربعة (وسوم مجموعات التحميل مثل [YTS.AG]).
 * @param raw الاسم الخام.
 * @returns السلسلة بعد إزالة المحتوى.
 */
export function stripBracketContent(raw: string): string {
  return raw.replace(/\[[^\]]*\]/g, " ");
}

/** مجموعة أقواس تحوي سنة كاملة (1994) / {2009} / [2021] تُحوَّل إلى رمز سنة. */
const PAREN_YEAR = /[({\[]\s*((?:19|20)\d{2})\s*[)}\]]/g;

/**
 * تحويل سنة داخل أقواس إلى رمز سنة قائم بذاته مع الإبقاء على الأقواس الأخرى كما هي.
 * الهدف: دعم (1994) و{1994} و[1994] دون المساس بالأقواس التي لا تحوي سنة.
 * @param raw الاسم الخام.
 * @returns السلسلة بعد تطبيع سنوات الأقواس.
 */
export function normalizeParenYear(raw: string): string {
  return raw.replace(PAREN_YEAR, " $1 ");
}

/**
 * يوحّد الفواصل إلى مسافات للتحليل.
 * @param raw الاسم الخام.
 * @returns الرموز المفصولة بمسافات.
 */
export function splitIntoRawTokens(raw: string): string[] {
  const cleaned = raw.replace(/[._~\-–]/g, " ");
  return cleaned.split(/\s+/).filter((t) => t.length > 0);
}

/**
 * استخراج السنة من قائمة رموز: نختار «آخر» رمز مكوّن من 4 أرقام (19xx/20xx).
 * يمنع هذا اختيار 1080/2160 (أحجام الدقة) لأنهما ليستا رموزاً كاملة مستقلة.
 * @param tokens قائمة الرموز الخام.
 * @returns السنة والأرقام المتبقية.
 */
export function extractYear(tokens: readonly string[]): {
  year: number | null;
  rest: string[];
} {
  let year: number | null = null;
  const rest = [...tokens];
  for (let i = rest.length - 1; i >= 0; i--) {
    const token = rest[i] ?? "";
    if (FULL_YEAR_TOKEN.test(token)) {
      year = Number(token);
      rest.splice(i, 1);
      break;
    }
  }
  return { year, rest };
}

/**
 * استخراج الموسم/الحلقة من الرموز (S01E01 / S01 / E01 / Season 1 / موسم 1).
 * @param tokens قائمة الرموز الخام.
 * @returns بيانات الموسم والرموز المتبقية.
 */
export function extractSeasonTokens(tokens: readonly string[]): {
  season: number | null;
  episodes: readonly [number, number] | null;
  isSeries: boolean;
  rest: string[];
} {
  let season: number | null = null;
  let episodes: readonly [number, number] | null = null;
  let isSeries = false;
  const rest: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] ?? "";
    const combo = token.match(/^s(\d{1,2})((?:e\d{1,2})+)$/i);
    if (combo) {
      season = season ?? Number(combo[1]);
      const episodeNumbers = (combo[2]?.match(/\d{1,2}/g) ?? []).map((n) => Number(n));
      const first = Math.min(...episodeNumbers);
      const last = Math.max(...episodeNumbers);
      episodes =
        episodes === null
          ? [first, last]
          : [Math.min(first, episodes[0]), Math.max(last, episodes[1])];
      isSeries = true;
      continue;
    }
    const sToken = token.match(SEASON_TOKEN);
    if (sToken) {
      season = season ?? Number(sToken[1]);
      isSeries = true;
      continue;
    }
    const eToken = token.match(EPISODE_TOKEN);
    if (eToken) {
      const ep = Number(eToken[1]);
      episodes =
        episodes === null || ep < episodes[0]
          ? [ep, episodes === null ? ep : Math.max(ep, episodes[1])]
          : [Math.min(ep, episodes[0]), Math.max(ep, episodes[1])];
      isSeries = true;
      continue;
    }
    const word = token.toLowerCase();
    if (word === "season" || word === "موسم" || word === "الموسم") {
      const next = tokens[i + 1];
      if (next && /^\d{1,2}$/.test(next)) {
        season = season ?? Number(next);
        isSeries = true;
        i += 1; // استهلاك الرقم الذي يلي كلمة Season
        continue;
      }
      const nextWord = (next?.toLowerCase() ?? "").replace(/^ال/, "");
      const ordinalNext = next ? ARABIC_ORDINALS.get(nextWord) : undefined;
      if (next && ordinalNext !== undefined) {
        season = season ?? ordinalNext;
        isSeries = true;
        i += 1; // استهلاك الكلمة الرقمية العربية التي تلي كلمة الموسم
        continue;
      }
    }
    rest.push(token);
  }

  return { season, episodes, isSeries, rest };
}

/**
 * حذف الرموز التقنية المفردة من قائمة الرموز.
 * @param tokens الرموز المتبقية بعد الخطوات السابقة.
 * @returns الرموز النظيفة (بدون عناصر تقنية).
 */
export function removeTechnicalTokens(tokens: readonly string[]): string[] {
  const kept: string[] = [];
  for (const token of tokens) {
    const normalized = normalizeToken(token);
    const isTechnical = normalized.length > 0 && TECHNICAL_TOKEN_SET.has(normalized);
    if (!isTechnical) {
      kept.push(token);
    }
  }
  return kept;
}

/**
 * حذف العبارات التقنية متعددة الكلمات المتجاورة (web dl, blu ray, director's cut...).
 * @param tokens الرموز المرشحة.
 * @returns الرموز بعد حذف العبارات.
 */
export function removeTechnicalPhrases(tokens: readonly string[]): string[] {
  let working = [...tokens];
  let changed = true;
  while (changed) {
    changed = false;
    for (const phrase of TECHNICAL_PHRASES) {
      const phraseLength = phrase.length;
      const normalizedPhrase = phrase.map(normalizeToken);
      for (let i = 0; i + phraseLength <= working.length; i++) {
        let matches = true;
        for (let j = 0; j < phraseLength; j++) {
          if (normalizeToken(working[i + j] ?? "") !== normalizedPhrase[j]) {
            matches = false;
            break;
          }
        }
        if (matches) {
          working.splice(i, phraseLength);
          changed = true;
          break;
        }
      }
      if (changed) {
        break;
      }
    }
  }
  return working;
}

/** بقايا تُحذف فقط لو وردت في نهاية الاسم (خفض احتمال أكل كلمات العناوين). */
const TRAILING_LEFTOVER_TOKEN_SET: ReadonlySet<string> = new Set(["dl", "rip"]);

/**
 * حذف بقايا تقنية لو وردت كآخر رمز (مثل DL أو RIP بعد WEB).
 * @param tokens الرموز بعد التنظيف الكامل.
 * @returns الرموز بعد حذف البقايا الطرفية.
 */
export function removeTrailingLeftovers(tokens: readonly string[]): string[] {
  const working = [...tokens];
  while (working.length > 0) {
    const last = working[working.length - 1] ?? "";
    if (TRAILING_LEFTOVER_TOKEN_SET.has(normalizeToken(last))) {
      working.pop();
      continue;
    }
    break;
  }
  return working;
}

/**
 * تحويل اسم مجلد إلى اسم بحث نظيف (البند 12/13/14).
 * @param folderName اسم المجلد الخام.
 * @returns بيانات الاسم والسنن والموسم.
 */
export function parseMediaName(folderName: string): ParsedMedia {
  const withoutBrackets = stripBracketContent(folderName.trim());
  const rawTokens = splitIntoRawTokens(normalizeParenYear(withoutBrackets));

  // احمِ الفيلم الذي اسمه بالسنة فقط (مثل «1917»): لا نعتبره سنة.
  if (rawTokens.length === 1 && FULL_YEAR_TOKEN.test(rawTokens[0] ?? "")) {
    return {
      title: rawTokens[0] ?? "",
      year: null,
      season: null,
      episodes: null,
      isSeriesHint: false,
    };
  }

  const { year, rest: withoutYear } = extractYear(rawTokens);
  const { season, episodes, isSeries, rest: withoutSeason } = extractSeasonTokens(withoutYear);
  const withoutTech = removeTechnicalTokens(withoutSeason);
  const withPhrases = removeTechnicalPhrases(withoutTech);
  const cleanedTokens = removeTechnicalTokens(withPhrases);
  const finalTokens = removeTrailingLeftovers(cleanedTokens);

  const title = finalTokens.join(" ").replace(/\s+/g, " ").trim();

  return {
    title,
    year,
    season,
    episodes,
    isSeriesHint: isSeries,
  };
}