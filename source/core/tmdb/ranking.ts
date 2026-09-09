/**
 * ترتيب نتائج TMDB واختيار الأنسب (البند 24).
 *
 * عوامل الترتيب:
 * 1. تطابق الاسم (تشابه نصي).
 * 2. السنة.
 * 3. تشابه ن-غرام (bigram).
 * 4. ترتيب نتيجة TMDB.
 *
 * إذا كانت الثقة أقل من العتبة → لا يُختار أي نتيجة (Fail Closed).
 */

/** نتيجة مرتّبة. */
export interface RankedCandidate<T> {
  item: T;
  score: number;
  confidence: number;
}

/** تطبيع نصوص المقارنة: أحرف صغيرة + حروف/أرقام فقط (يدعم العربية). */
export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06FF]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** استخراج مجموعة bigrams من نص. */
export function bigrams(text: string): Set<string> {
  const normalized = normalizeForMatch(text);
  const grams = new Set<string>();
  if (!normalized) {
    return grams;
  }
  for (let i = 0; i < normalized.length - 1; i++) {
    grams.add(normalized.slice(i, i + 2));
  }
  return grams;
}

/** معامل Dice بين نصين. */
export function bigramDice(a: string, b: string): number {
  const gramsA = bigrams(a);
  const gramsB = bigrams(b);
  if (gramsA.size === 0 || gramsB.size === 0) {
    return a === b ? 1 : 0;
  }
  let intersection = 0;
  for (const gram of gramsA) {
    if (gramsB.has(gram)) {
      intersection += 1;
    }
  }
  return (2 * intersection) / (gramsA.size + gramsB.size);
}

/**
 * تشابه بين اسم البحث واسم المرشح (0..1).
 * - تطابق تام → 1.
 * - احتواء كامل لأحدهما في الآخر → 0.85.
 * - وإلا نستخدم تغطية رموز الاستعلام + معامل Dice.
 * @param query اسم البحث.
 * @param candidate اسم المرشح.
 * @returns درجة 0..1.
 */
export function titleSimilarity(query: string, candidate: string): number {
  const q = normalizeForMatch(query);
  const c = normalizeForMatch(candidate);
  if (!q || !c) {
    return 0;
  }
  if (q === c) {
    return 1;
  }
  if (q.includes(c) || c.includes(q)) {
    return 0.85;
  }
  const qTokens = new Set(q.split(" "));
  const cTokens = c.split(" ");
  const covered = cTokens.filter((token) => qTokens.has(token) || q.includes(token)).length;
  const coverage = cTokens.length > 0 ? covered / cTokens.length : 0;
  const dice = bigramDice(q, c);
  return Math.max(coverage, dice) * 0.9;
}

/** حساب درجة السنة (0..1). */
function yearScore(queryYear: number | null, candidateYear: number | null): number {
  if (queryYear === null || candidateYear === null) {
    return 0.5;
  }
  const diff = Math.abs(queryYear - candidateYear);
  if (diff === 0) {
    return 1;
  }
  if (diff <= 1) {
    return 0.6;
  }
  return 0.1;
}

/** درجة الشاملة لبند واحد. */
export function scoreCandidate(
  query: string,
  year: number | null,
  candidate: { name: string; year: number | null },
  params: { order: number; total: number }
): number {
  const similarity = titleSimilarity(query, candidate.name);
  const yearPart = yearScore(year, candidate.year);
  const orderPart = params.total > 1 ? 1 - params.order / (params.total + 1) : 1;
  return 0.7 * similarity + 0.2 * yearPart + 0.1 * orderPart;
}

/**
 * اختيار أفضل نتيجة عند تجاوز عتبة الثقة، أو null (لا نقل — Fail Closed).
 * @param query اسم البحث.
 * @param year السنة المستخرجة.
 * @param items نتائج TMDB المرشحة.
 * @param threshold الحد الأدنى للقبول (0..1).
 * @returns أفضل مرشح أو null.
 */
/** عتبة الثقة الدنيا لقبول نتيجة (Fail Closed: دونها لا ينقل). */
export const CONFIDENCE_THRESHOLD = 0.55;

export function pickBest<T extends { name: string; year: number | null }>(
  query: string,
  year: number | null,
  items: readonly T[],
  threshold = CONFIDENCE_THRESHOLD
): RankedCandidate<T> | null {
  if (items.length === 0) {
    return null;
  }
  const ranked = items.map((item, index) => ({
    item,
    score: scoreCandidate(query, year, item, { order: index, total: items.length }),
  }));
  ranked.sort((a, b) => b.score - a.score);
  const best = ranked[0];
  if (!best || best.score < threshold) {
    return null;
  }
  return { item: best.item, score: best.score, confidence: Math.min(1, best.score) };
}