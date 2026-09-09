import { test } from "node:test";
import assert from "node:assert/strict";
import { TmdbClient, TmdbApiError } from "../source/core/tmdb/client";
import { searchTV, searchMovie } from "../source/core/tmdb/search";
import { getMediaRating } from "../source/core/tmdb/media-rating";
import { Logger } from "../source/core/logging/logger";

/** استجابة JSON للاختبار. */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** إنشاء عميل مع fetch مُعاد لاختبارات بلا إنترنت. */
function makeClient(
  handler: (url: string, calls: number) => Response | Promise<Response>,
  retryDelaysMs: readonly number[] = [5, 10]
): { client: TmdbClient; calls: number[] } {
  const calls: number[] = [];
  const client = new TmdbClient({
    apiKey: "TEST_KEY_123",
    fetchImpl: (async (url: string): Promise<Response> => {
      calls.push(Date.now());
      return await handler(url, calls.length);
    }) as typeof fetch,
    baseUrl: "https://api.example.test/3",
    minDelayMs: 0,
    timeoutMs: 5000,
    retryDelaysMs,
  });
  return { client, calls };
}

function context(logger: Logger, title: string, year: number | null = null) {
  return { title, year, logger, apiKey: "TEST_KEY_123" };
}

function collectLogs(logger: Logger): string[] {
  const lines: string[] = [];
  logger.onLog((entry) => lines.push(entry.message));
  return lines;
}

test("searchTV maps TMDB rows correctly", async () => {
  const { client } = makeClient((url) => {
    assert.match(url, /\/search\/tv/);
    assert.match(url, /api_key=TEST_KEY_123/);
    return jsonResponse({
      results: [
        { id: 1399, name: "Breaking Bad", first_air_date: "2008-01-20", popularity: 100 },
        { id: 42, original_name: "No English Name" },
        { id: 0, name: "" },
      ],
    });
  });
  const items = await searchTV(client, "Breaking Bad", 2008);
  assert.equal(items.length, 2);
  assert.equal(items[0]?.tmdbId, 1399);
  assert.equal(items[0]?.year, 2008);
  assert.equal(items[0]?.mediaType, "tv");
});

test("searchMovie passes year and include_adult", async () => {
  const { client } = makeClient((url) => {
    assert.match(url, /\/search\/movie/);
    assert.match(url, /year=2004/);
    assert.match(url, /include_adult=true/);
    return jsonResponse({ results: [{ id: 620, title: "Ghostbusters", release_date: "1984-06-08" }] });
  });
  const items = await searchMovie(client, "Ghostbusters", 2004);
  assert.equal(items.length, 1);
  assert.equal(items[0]?.tmdbId, 620);
  assert.equal(items[0]?.year, 1984);
});

test("getMediaRating: series found with US rating", async () => {
  const logger = new Logger();
  const { client } = makeClient((url) => {
    if (url.includes("/search/tv")) {
      return jsonResponse({ results: [{ id: 1399, name: "Breaking Bad", first_air_date: "2008-01-20" }] });
    }
    if (url.includes("/content_ratings")) {
      return jsonResponse({
        results: [
          { iso_3166_1: "US", rating: "TV-MA" },
          { iso_3166_1: "GB", rating: "18" },
        ],
      });
    }
    assert.fail(`unexpected url: ${url}`);
  });
  const result = await getMediaRating(client, context(logger, "Breaking Bad", 2008));
  assert.equal(result.state, "found");
  assert.equal(result.rating, "TV-MA");
  assert.equal(result.mediaType, "series");
  assert.equal(result.tmdbId, 1399);
});

test("getMediaRating: non-US fallback rating is logged", async () => {
  const logger = new Logger();
  logger.onLog(() => undefined);
  const lines = collectLogs(logger);
  const { client } = makeClient((url) => {
    if (url.includes("/search/tv")) {
      return jsonResponse({ results: [{ id: 111, name: "Some Show", first_air_date: "2010-01-01" }] });
    }
    if (url.includes("/content_ratings")) {
      return jsonResponse({ results: [{ iso_3166_1: "US", rating: "" }, { iso_3166_1: "FR", rating: "18" }] });
    }
    return jsonResponse({ results: [] });
  });
  const result = await getMediaRating(client, context(logger, "Some Show"));
  assert.equal(result.rating, "18");
  assert.equal(result.state, "found");
  assert.ok(lines.some((line) => line.includes("بديل")));
});

test("getMediaRating: series found but no rating at all → no-rating", async () => {
  const logger = new Logger();
  const { client } = makeClient((url) => {
    if (url.includes("/search/tv")) {
      return jsonResponse({ results: [{ id: 222, name: "No Ratings Show" }] });
    }
    if (url.includes("/content_ratings")) {
      return jsonResponse({ results: [] });
    }
    return jsonResponse({ results: [] });
  });
  const result = await getMediaRating(client, context(logger, "No Ratings Show"));
  assert.equal(result.state, "no-rating");
  assert.equal(result.rating, null);
  assert.equal(result.mediaType, "series");
});

test("getMediaRating: movie fallback when TV not found", async () => {
  const logger = new Logger();
  const { client } = makeClient((url) => {
    if (url.includes("/search/tv")) {
      return jsonResponse({ results: [] });
    }
    if (url.includes("/search/movie")) {
      return jsonResponse({ results: [{ id: 862, title: "Toy Story", release_date: "1995-11-22" }] });
    }
    if (url.includes("/release_dates")) {
      return jsonResponse({
        results: [{ iso_3166_1: "US", release_dates: [{ certification: "G" }] }],
      });
    }
    return jsonResponse({ results: [] });
  });
  const result = await getMediaRating(client, context(logger, "Toy Story", 1995));
  assert.equal(result.state, "found");
  assert.equal(result.rating, "G");
  assert.equal(result.mediaType, "movie");
  assert.equal(result.tmdbId, 862);
});

test("getMediaRating: content_ratings 404 treated as no-rating", async () => {
  const logger = new Logger();
  const { client } = makeClient((url) => {
    if (url.includes("/search/tv")) {
      return jsonResponse({ results: [{ id: 333, name: "Ghost Rating Show" }] });
    }
    if (url.includes("/content_ratings")) {
      return jsonResponse({ error: "not found" }, 404);
    }
    return jsonResponse({ results: [] });
  });
  const result = await getMediaRating(client, context(logger, "Ghost Rating Show"));
  assert.equal(result.state, "no-rating");
});

test("getMediaRating: not found on both searches → not-found", async () => {
  const logger = new Logger();
  const { client } = makeClient((url) => {
    if (url.includes("/search/tv") || url.includes("/search/movie")) {
      return jsonResponse({ results: [] });
    }
    return jsonResponse({ results: [] });
  });
  const result = await getMediaRating(client, context(logger, "مرجتن بشدة غير موجودة"));
  assert.equal(result.state, "not-found");
  assert.equal(result.mediaType, "unknown");
  assert.equal(result.tmdbId, null);
  assert.equal(result.rating, null);
});

test("rate limit 429 is retried then succeeds", async () => {
  const logger = new Logger();
  const { client, calls } = makeClient((url) => {
    if (url.includes("/search/tv")) {
      if (calls.length === 1) {
        return jsonResponse({ status_message: "Too many" }, 429);
      }
      return jsonResponse({ results: [{ id: 1399, name: "Breaking Bad" }] });
    }
    if (url.includes("/content_ratings")) {
      return jsonResponse({ results: [{ iso_3166_1: "US", rating: "TV-MA" }] });
    }
    return jsonResponse({ results: [] });
  });
  const result = await getMediaRating(client, context(logger, "Breaking Bad", 2008));
  assert.equal(result.state, "found");
  assert.ok(calls.length >= 2, `expected at least 2 calls, got ${calls.length}`);
});

test("401 auth error stops immediately with kind=auth and no retry", async () => {
  const logger = new Logger();
  const { client, calls } = makeClient(() => jsonResponse({ error: "unauthorized" }, 401));
  await assert.rejects(
    getMediaRating(client, context(logger, "Breaking Bad")),
    (err: unknown) => err instanceof TmdbApiError && err.kind === "auth"
  );
  assert.equal(calls.length, 1);
});

test("500 server error retries twice then throws server", async () => {
  const logger = new Logger();
  const { client, calls } = makeClient(() => jsonResponse({ error: "boom" }, 500));
  await assert.rejects(
    getMediaRating(client, context(logger, "Breaking Bad")),
    (err: unknown) => err instanceof TmdbApiError && err.kind === "server"
  );
  assert.equal(calls.length, 3);
});

test("network error is classified and retried", async () => {
  const logger = new Logger();
  const { client, calls } = makeClient(() => {
    throw new TypeError("fetch failed");
  });
  await assert.rejects(
    getMediaRating(client, context(logger, "Breaking Bad")),
    (err: unknown) => err instanceof TmdbApiError && err.kind === "network"
  );
  assert.equal(calls.length, 3);
});

test("invalid JSON body raises validation error", async () => {
  const logger = new Logger();
  const { client } = makeClient(() => new Response("not-json", { status: 200 }));
  await assert.rejects(
    getMediaRating(client, context(logger, "Breaking Bad")),
    (err: unknown) => err instanceof TmdbApiError && err.kind === "validation"
  );
});

test("malformed search response (no results key) → not-found safely", async () => {
  const logger = new Logger();
  const { client } = makeClient((url) => {
    if (url.includes("/search/tv") || url.includes("/search/movie")) {
      return jsonResponse({ totally: "unexpected" });
    }
    return jsonResponse({ results: [] });
  });
  const result = await getMediaRating(client, context(logger, "Something"));
  assert.equal(result.state, "not-found");
});

test("api key never appears in error messages or logs", async () => {
  const logger = new Logger();
  const logs = collectLogs(logger);
  const { client } = makeClient(() => jsonResponse({ error: "nope" }, 401));
  await assert.rejects(getMediaRating(client, context(logger, "Breaking Bad", 2008)));
  for (const line of logs) {
    assert.ok(!line.includes("TEST_KEY_123"), `leak in log: ${line}`);
  }
});