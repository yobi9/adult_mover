/**
 * قواميس العناصر التقنية التي تُستخرج من أسماء مجلدات الوسائط.
 * كل القيم تُخزَّن بنسخة مُعيَّرة (Normalized): حروف/أرقام فقط وبأحرف صغيرة.
 */

/** دقة/جودة الصورة. */
const RESOLUTIONS = [
  "8k",
  "4k",
  "2160p",
  "1080p",
  "720p",
  "576p",
  "480p",
  "360p",
  "240p",
  "uhd",
  "fhd",
  "qhd",
  "2k",
  "hd",
  "hdr",
  "hdr10",
  "hdr10plus",
  "sdr",
  "dolbyvision",
  "dv",
  "imax",
];

/** مصدر/جودة الإصدار. */
const SOURCES = [
  "web",
  "webrip",
  "bluray",
  "bdrip",
  "brrip",
  "hdtv",
  "hdrip",
  "dvdrip",
  "dvd",
  "remux",
  "p2p",
  "predvd",
  "workprint",
  "retail",
  "screener",
  "dvdscreener",
  "tvrip",
  "hddvd",
  "nf",
  "amzn",
  "dsnp",
  "appletv",
  "hulu",
];

/** الترميز. */
const CODECS = [
  "hevc",
  "h264",
  "h265",
  "x264",
  "x265",
  "avc",
  "av1",
  "vp9",
  "vp8",
  "mpeg2",
  "mpeg4",
  "vc1",
  "divx",
  "xvid",
];

/** الصوت. */
const AUDIO = [
  "aac",
  "ac3",
  "eac3",
  "ddp",
  "dts",
  "dtshd",
  "dtsma",
  "truehd",
  "atmos",
  "flac",
  "opus",
  "mp3",
  "ma",
  "dd51",
  "5ch",
  "7ch",
];

/** وسوم إصدار/حالة خاصة. */
const TAGS = [
  "repack",
  "proper",
  "internal",
  "readnfo",
  "nfo",
  "fixed",
  "multi",
  "dual",
  "preair",
  "extended",
  "unrated",
  "theatrical",
  "remastered",
  "miniseries",
  "minis",
  "limited",
  "complete",
  "boxset",
  "collection",
  "directorscut",
];

/** عبارات من كلمتين/ثلاث يكون «البنية المجزّأة» ضرورية لحذفها. */
const PHRASES: readonly (readonly string[])[] = [
  ["web", "dl"],
  ["web", "rip"],
  ["blu", "ray"],
  ["dvd", "rip"],
  ["hd", "rip"],
  ["director", "s", "cut"],
  ["directors", "cut"],
  ["dolby", "vision"],
  ["hdr", "plus"],
];

/**
 * تطبيع رمز لحجم المقارنة: أحرف صغيرة ومحذوفة كل الرموز غير الأبجدية الرقمية.
 * @param token الرمز الخام.
 * @returns نسخة مُطيَّنة للبحث في القواميس.
 */
export function normalizeToken(token: string): string {
  return token.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** مجموعة موحّدة لكل الرموز التقنية المفردة. */
export const TECHNICAL_TOKEN_SET: ReadonlySet<string> = new Set([
  ...RESOLUTIONS,
  ...SOURCES,
  ...CODECS,
  ...AUDIO,
  ...TAGS,
]);

/** عبارات تقنية متعددة الكلمات للتنظيف. */
export const TECHNICAL_PHRASES: readonly (readonly string[])[] = PHRASES;

/** مجموعة لحماية أسماء لا يجوز حذفها حتى لو بدت تقنية. */
export const PROTECTED_TOKEN_SET: ReadonlySet<string> = new Set(["8", "the", "a"]);