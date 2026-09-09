/**
 * عميل TMDB REST API (البند 15/25/26).
 *
 * - Limiter عالمي: لا يرسل طلباً قبل مضي minDelayMs عن آخر طلب (منع 429).
 * - Retry محدود مع Backoff: 1s ثم 2s ثم 4s على الأخطاء القابلة لإعادة المحاولة.
 * - تصنيف الأخطاء المنفصل لكل حالة (auth / rate-limit / not-found / server / network / validation).
 * - fetch قابل للحقن لتسهيل الاختبارات (Mock بلا إنترنت).
 */

export type ApiErrorKind =
  | "auth"
  | "rate-limit"
  | "not-found"
  | "server"
  | "network"
  | "validation";

/** خطأ مصنّف صادر عن TMDB. */
export class TmdbApiError extends Error {
  constructor(
    readonly kind: ApiErrorKind,
    message: string,
    readonly status: number | undefined = undefined,
    readonly retryable: boolean = false
  ) {
    super(message);
    this.name = "TmdbApiError";
  }
}

/** خيارات إنشاء العميل. */
export interface TmdbClientOptions {
  /** مفتاح API (لا يُسجل ولا يظهر في الأخطاء إطلاقاً). */
  apiKey: string;
  /** دالة fetch (قابلة للحقن للاختبار). */
  fetchImpl?: typeof fetch;
  /** عنوان قاعدة API. */
  baseUrl?: string;
  /** أقل مهلة بين الطلبات (Default 400ms). */
  minDelayMs?: number;
  /** مهلة الطلب الواحد (Default 15000ms). */
  timeoutMs?: number;
  /** فترات الإعادة (Default [1000, 2000, 4000]). */
  retryDelaysMs?: readonly number[];
}

/** نوم مساعد. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** عميل TMDB. */
export class TmdbClient {
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly minDelayMs: number;
  private readonly timeoutMs: number;
  private readonly retryDelaysMs: readonly number[];
  private lastRequestAt = 0;

  constructor(options: TmdbClientOptions) {
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.baseUrl = options.baseUrl ?? "https://api.themoviedb.org/3";
    this.minDelayMs = options.minDelayMs ?? 400;
    this.timeoutMs = options.timeoutMs ?? 15000;
    this.retryDelaysMs = options.retryDelaysMs ?? [1000, 2000, 4000];
  }

  /**
   * تنفيذ طلب GET وتصنيف الأخطاء مع إعادة محدودة.
   * @param path مسار النقطة (مثل /search/tv).
   * @param params معاملات الاستعلام.
   * @returns جسم الاستجابة المُنسَّق.
   */
  async request<T>(
    path: string,
    params: Record<string, string | number | boolean | undefined> = {}
  ): Promise<T> {
    const url = this.buildUrl(path, params);

    let attempt = 0;
    for (;;) {
      await this.waitForPace();
      try {
        return await this.execute<T>(url);
      } catch (error) {
        if (
          error instanceof TmdbApiError &&
          error.retryable &&
          attempt < this.retryDelaysMs.length
        ) {
          const delay = this.retryDelaysMs[attempt] ?? 1000;
          attempt += 1;
          await sleep(delay);
          continue;
        }
        throw error;
      }
    }
  }

  /** بناء عنوان الطلب بإخفاء المفتاح في القيمة وليس في الأخطاء. */
  private buildUrl(
    path: string,
    params: Record<string, string | number | boolean | undefined>
  ): URL {
    const url = new URL(this.baseUrl.replace(/\/+$/, "") + path);
    url.searchParams.set("api_key", this.apiKey);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
    return url;
  }

  /** مهلة الوتيرة العالمية قبل كل طلب. */
  private async waitForPace(): Promise<void> {
    const now = Date.now();
    const wait = this.minDelayMs - (now - this.lastRequestAt);
    if (wait > 0) {
      await sleep(wait);
    }
    this.lastRequestAt = Date.now();
  }

  /** تنفيذ طلب واحد وتصنيف أخطائه. */
  private async execute<T>(url: URL): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(url.toString(), {
        method: "GET",
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new TmdbApiError("network", `Network error: ${message}`, undefined, true);
    }

    if (response.status === 401 || response.status === 403) {
      throw new TmdbApiError(
        "auth",
        `TMDB request failed. Status: ${response.status} (مفتاح API غير صالح أو غير مصرح به)`,
        response.status
      );
    }
    if (response.status === 404) {
      throw new TmdbApiError("not-found", "TMDB request failed. Status: 404", response.status);
    }
    if (response.status === 429) {
      throw new TmdbApiError(
        "rate-limit",
        "TMDB request failed. Status: 429 (Too Many Requests)",
        429,
        true
      );
    }
    if (response.status >= 500) {
      throw new TmdbApiError(
        "server",
        `TMDB request failed. Status: ${response.status}`,
        response.status,
        true
      );
    }
    if (!response.ok) {
      throw new TmdbApiError(
        "validation",
        `TMDB request failed. Status: ${response.status}`,
        response.status
      );
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new TmdbApiError("validation", "Invalid JSON response from TMDB");
    }
    return data as T;
  }
}