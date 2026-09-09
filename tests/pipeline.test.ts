import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fsp } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runScanJob } from "../source/core/pipeline/orchestrator";
import { createStopSignal } from "../source/core/pipeline/stop";
import { moveFolder, pathExists } from "../source/core/files/mover";
import { scanSource } from "../source/core/files/scanner";
import { Logger } from "../source/core/logging/logger";
import { TmdbApiError } from "../source/core/tmdb/client";
import type { RatingResult } from "../source/core/types";

/** مصدر تصنيف معقول للمجلدات. */
function fakeRating(suffix: "adult" | "pg" | "low" | "none" | "missing"): RatingResult {
  switch (suffix) {
    case "adult":
      return { rating: "R", mediaType: "movie", tmdbId: 1, confidence: 0.95, state: "found" };
    case "pg":
      return { rating: "TV-PG", mediaType: "series", tmdbId: 2, confidence: 0.9, state: "found" };
    case "low":
      return { rating: "R", mediaType: "movie", tmdbId: 3, confidence: 0.3, state: "found" };
    case "none":
      return { rating: null, mediaType: "movie", tmdbId: 4, confidence: 0.9, state: "no-rating" };
    case "missing":
      return { rating: null, mediaType: "movie", tmdbId: null, confidence: 0, state: "not-found" };
  }
}

/** مجلد مؤقت يُصفى تلقائياً. */
async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fsp.mkdtemp(path.join(tmpdir(), "amm-pipe-"));
  try {
    await fn(dir);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

/** إنشاء شجرة مصادر نموذجية. */
async function seedSources(base: string): Promise<string[]> {
  const names = [
    "Movie A",
    "Series A",
    "Family Show",
    "LowConf",
    "NoRating",
    "NotFound",
    "Errored",
    "Already There",
  ];
  for (const name of names) {
    const dir = path.join(base, name);
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, "content.mp4"), "x");
  }
  await fsp.mkdir(path.join(base, "Not Media"), { recursive: true });
  await fsp.writeFile(path.join(base, "Not Media", "readme.txt"), "x");
  return names;
}

/** بناء بوابة تصنيف تكوينية. */
function makeGateway(spec: (title: string) => RatingResult | "throw") {
  return {
    getRating: async (title: string): Promise<RatingResult> => {
      const value = spec(title.toLowerCase());
      if (value === "throw") {
        throw new TmdbApiError("network", "connection reset", undefined, true);
      }
      return value;
    },
  };
}

test("pipeline moves adult titles, skips others, and reports errors", async () => {
  await withTempDir(async (base) => {
    const src = path.join(base, "src");
    const dest = path.join(base, "dest");
    await seedSources(src);

    const logger = new Logger(200);
    const stop = createStopSignal();
    const decisions: Array<{ folder: string; reason: string }> = [];
    const gateway = makeGateway((title) => {
      switch (title) {
        case "movie a":
        case "series a":
          return fakeRating("adult");
        case "family show":
          return fakeRating("pg");
        case "lowconf":
          return fakeRating("low");
        case "norating":
          return fakeRating("none");
        case "notfound":
          return fakeRating("missing");
        case "already there":
          return fakeRating("adult");
        case "errored":
          return "throw";
        default:
          return fakeRating("missing");
      }
    });

    const result = await runScanJob({
      config: { sources: [src], destination: dest, recursive: true },
      stop,
      logger,
      getRating: gateway,
      scanSource,
      moveFolder,
      isAtDestination: async (folder) => folder.endsWith("Already There"),
      callbacks: {
        onDecision: (folder, decision) =>
          decisions.push({ folder: path.basename(folder), reason: decision.reason }),
      },
    });

    assert.equal(result.phase, "complete");
    assert.equal(result.stats.processed, 8);
    assert.equal(result.stats.moved, 2);
    assert.equal(result.stats.skipped, 5);
    assert.equal(result.stats.errors, 1);

    // النقل الفعلي على الوجهة.
    assert.equal(await pathExists(path.join(dest, "Movie A", "content.mp4")), true);
    assert.equal(await pathExists(path.join(dest, "Series A", "content.mp4")), true);

    // المصدر لم يُحذف؛ والبقية بقيت في مكانها.
    assert.equal(await pathExists(path.join(src, "Family Show")), true);
    assert.equal(await pathExists(path.join(src, "Errored")), true);

    // الأسباب المبلّغ عنها.
    const byReason = decisions.map((d) => d.reason);
    assert.ok(byReason.includes("adult"));
    assert.ok(byReason.includes("rating-not-target"));
    assert.ok(byReason.includes("low-confidence"));
    assert.ok(byReason.includes("no-rating"));
    assert.ok(byReason.includes("not-found"));
    assert.ok(byReason.includes("already-at-destination"));
    assert.ok(byReason.includes("tmdb-error"));
  });
});

test("pipeline honours a stop request between folders and finishes the current one", async () => {
  await withTempDir(async (base) => {
    const srcA = path.join(base, "srcA");
    const srcB = path.join(base, "srcB");
    for (const dir of [srcA, srcB]) {
      await fsp.mkdir(dir, { recursive: true });
    }
    await fsp.mkdir(path.join(srcA, "Movie X"), { recursive: true });
    await fsp.writeFile(path.join(srcA, "Movie X", "a.mp4"), "x");
    await fsp.mkdir(path.join(srcB, "Movie Y"), { recursive: true });
    await fsp.writeFile(path.join(srcB, "Movie Y", "b.mp4"), "x");
    const dest = path.join(base, "dest");
    const logger = new Logger(50);

    const stop = createStopSignal();
    const gateway = makeGateway(() => fakeRating("adult"));
    const moveAndRequestStop = async (
      s: string,
      d: string,
      n: string,
      o?: Parameters<typeof moveFolder>[3]
    ) => {
      const outcome = await moveFolder(s, d, n, o);
      if (outcome.ok) {
        stop.requestStop(); // بعد اكتمال مجلد السلسلة الحالي.
      }
      return outcome;
    };

    const result = await runScanJob({
      config: { sources: [srcA, srcB], destination: dest, recursive: true },
      stop,
      logger,
      getRating: gateway,
      scanSource,
      moveFolder: moveAndRequestStop,
    });

    // المجلد الأول اكتمل (نُقل)، والثاني توقف قبله.
    assert.equal(result.stopped, true);
    assert.equal(result.phase, "aborted");
    assert.equal(result.stats.processed, 1);
    assert.equal(result.stats.moved, 1);
    assert.equal(await pathExists(path.join(dest, "Movie X", "a.mp4")), true);
    assert.equal(await pathExists(path.join(srcB, "Movie Y", "b.mp4")), true);
  });
});

test("pipeline aborts the whole job on authentication errors", async () => {
  await withTempDir(async (base) => {
    const src = path.join(base, "src");
    await fsp.mkdir(src, { recursive: true });
    await fsp.writeFile(path.join(src, "episode.mp4"), "x"); // محتوى مباشر.
    const dest = path.join(base, "dest");
    const logger = new Logger(50);

    const result = await runScanJob({
      config: { sources: [src], destination: dest, recursive: true },
      stop: createStopSignal(),
      logger,
      getRating: {
        getRating: async () => {
          throw new TmdbApiError("auth", "Invalid API key (401)");
        },
      },
      scanSource,
      moveFolder,
    });

    assert.equal(result.phase, "aborted");
    assert.equal(result.stopped, false);
    assert.equal(result.stats.moved, 0);
    assert.equal(await pathExists(path.join(src, "episode.mp4")), true);
    // لا شأن للتسجيل؛ الاكتفاء بتحقق الخطأ في السجل.
    assert.ok(logger.entries.some((e) => e.message.includes("مصادقة TMDB")));
  });
});

test("pipeline reports scan errors without aborting", async () => {
  await withTempDir(async (base) => {
    const src = path.join(base, "src");
    await fsp.mkdir(path.join(src, "Movie A"), { recursive: true });
    await fsp.writeFile(path.join(src, "Movie A", "a.mp4"), "x");
    await fsp.mkdir(path.join(src, "broken"), { recursive: true });
    const dest = path.join(base, "dest");
    const logger = new Logger(50);

    const result = await runScanJob({
      config: { sources: [path.join(base, "src"), path.join(base, "missing-source-xyz")], destination: dest, recursive: true },
      stop: createStopSignal(),
      logger,
      getRating: makeGateway(() => fakeRating("adult")),
      scanSource,
      moveFolder,
    });

    assert.equal(result.phase, "complete");
    assert.equal(result.stats.moved, 1);
    assert.equal(result.stats.errors, 1);
    assert.ok(logger.entries.some((e) => e.level === "warn" && e.message.includes("خطأ في الفحص")));
  });
});

test("a pre-stopped job returns immediately", async () => {
  const stop = createStopSignal();
  stop.requestStop();
  const result = await runScanJob({
    config: { sources: [], destination: "unused", recursive: true },
    stop,
    logger: new Logger(10),
    getRating: makeGateway(() => fakeRating("adult")),
    scanSource,
    moveFolder,
  });
  assert.equal(result.phase, "aborted");
  assert.equal(result.stopped, true);
});

test("pipeline E2E: a series root is one candidate, seasons never candidates (ON and OFF)", async () => {
  await withTempDir(async (base) => {
    const src = path.join(base, "src");
    const dest = path.join(base, "dest");
    const seed = async (): Promise<void> => {
      await fsp.mkdir(src, { recursive: true });
      const series = path.join(src, "Station 19");
      for (const season of ["الموسم 01", "الموسم 02"]) {
        const seasonDir = path.join(series, season);
        await fsp.mkdir(seasonDir, { recursive: true });
        await fsp.writeFile(path.join(seasonDir, "episode.mkv"), "x");
      }
    };

    for (const recursive of [true, false]) {
      await seed();
      const queries: string[] = [];
      const decisions: Array<{ folder: string; reason: string }> = [];
      const logger = new Logger(50);
      const result = await runScanJob({
        config: { sources: [src], destination: dest, recursive },
        stop: createStopSignal(),
        logger,
        getRating: {
          getRating: async (title: string) => {
            queries.push(title);
            return { rating: "TV-MA", mediaType: "series", tmdbId: 9, confidence: 0.95, state: "found" };
          },
        },
        scanSource,
        moveFolder,
        callbacks: {
          onDecision: (folder, decision) =>
            decisions.push({ folder: path.basename(folder), reason: decision.reason }),
        },
      });

      assert.equal(result.phase, "complete", `phase recursive=${recursive}`);
      assert.equal(result.stats.processed, 1, `processed recursive=${recursive}`);
      assert.equal(result.stats.moved, 1, `moved recursive=${recursive}`);
      assert.deepEqual(queries, ["Station 19"], `TMDB title recursive=${recursive}`);
      assert.deepEqual(
        decisions.map((d) => d.folder),
        ["Station 19"],
        `decisions recursive=${recursive}`
      );
      assert.equal(
        await pathExists(path.join(dest, "Station 19", "الموسم 01", "episode.mkv")),
        true,
        `season dir moved within root recursive=${recursive}`
      );

      await fsp.rm(src, { recursive: true, force: true });
      await fsp.rm(dest, { recursive: true, force: true });
    }
  });
});